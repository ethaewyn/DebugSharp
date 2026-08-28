/**
 * Launch Commands
 *
 * Quick Launch and Launch Project: pick a project, build it, resolve the
 * built assembly, and start a debug session with the right launch profile.
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { runVerb, setLastUsedItem, getLastUsedItem } from '../build/actions';
import { findOutputAssembly } from '../build/upToDate';
import { generateDebugConfig } from './debugConfig';
import { getProjects, findProjectForFile, ProjectInfo } from '../shared/projectIndex';

// Store the last launched project path for quick re-launch
let lastLaunchedProjectPath: string | undefined;

/**
 * Launch profile last chosen for each project, keyed by project path.
 *
 * Per-project on purpose: a single global would apply one project's profile
 * name to a different project that Quick Launch inferred from the active file.
 */
const lastProfileByProject = new Map<string, string>();

/**
 * The profile to launch a project with: the one last chosen for *this* project,
 * otherwise the project's own default.
 */
function resolveProfileName(project: ProjectInfo): string | undefined {
  return lastProfileByProject.get(project.path) ?? defaultProfileName(project);
}

/**
 * A project's default launch profile, matching `dotnet run`: the first profile
 * that launches the project itself, falling back to the first profile declared.
 */
function defaultProfileName(project: ProjectInfo): string | undefined {
  const profiles = project.launchProfiles?.profiles;
  if (!profiles) {
    return undefined;
  }

  const entries = Object.entries(profiles);
  const runnable = entries.find(([, profile]) => (profile as any)?.commandName === 'Project');

  return (runnable ?? entries[0])?.[0];
}

// ─── Build helpers for the launch flow ───────────────────────────────

/**
 * Pull the built assembly path out of dotnet build output, which names it on
 * a line like `MyApp -> C:\...\bin\Debug\net8.0\MyApp.dll`.
 */
function extractDllPath(output: string, project: ProjectInfo): string | null {
  const dllBaseName = project.assemblyName || project.name;
  const dllRegex = new RegExp(
    `->\\s*([^\\r\\n]*${dllBaseName.replace(/[.*+?^${}()|[\]\\\\]/g, '\\$&')}\\.dll)`,
    'i',
  );
  const dllMatch = output.match(dllRegex);

  if (!dllMatch) {
    return null;
  }

  let extractedPath = dllMatch[1].trim();
  if (!path.isAbsolute(extractedPath)) {
    extractedPath = path.join(path.dirname(project.path), extractedPath);
  }
  return path.normalize(extractedPath);
}

/**
 * Build a project and resolve the DLL to launch, falling back to a disk
 * search when the build output doesn't name it.
 */
async function buildAndResolveDll(project: ProjectInfo): Promise<string | null> {
  const result = await runVerb('build', project);

  if (!result.skipped) {
    // Small delay to ensure DLL is fully written (especially important for ASP.NET Core apps)
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  const finalDllPath =
    extractDllPath(result.output, project) ?? findOutputAssembly(project) ?? null;

  if (!finalDllPath) {
    vscode.window.showErrorMessage(
      `Could not find built DLL for ${project.name}. Build may have failed.`,
    );
  }

  return finalDllPath;
}

/**
 * Find the project that contains the currently open file
 */
async function findProjectForActiveFile(): Promise<ProjectInfo | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== 'file') {
    return undefined;
  }

  const filePath = editor.document.uri.fsPath;
  if (!filePath.endsWith('.cs')) {
    return undefined;
  }

  return findProjectForFile(filePath);
}

/**
 * Launch a project (build + debug) using the profile chosen for that project.
 */
async function launchProjectDirect(project: ProjectInfo): Promise<void> {
  const finalDllPath = await buildAndResolveDll(project);
  if (!finalDllPath) {
    return;
  }

  const config = generateDebugConfig(project, resolveProfileName(project), finalDllPath);
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(project.path));
  setLastUsedItem(project.path);
  lastLaunchedProjectPath = project.path;
  await vscode.debug.startDebugging(workspaceFolder, config);
}

/**
 * Quick launch: Re-run last project or infer from active editor
 */
export async function quickLaunch(): Promise<void> {
  const projects = await getProjects('runnable');

  if (projects.length === 0) {
    vscode.window.showWarningMessage('No runnable C# projects found in workspace');
    return;
  }

  const activeProject = await findProjectForActiveFile();
  const lastProject = lastLaunchedProjectPath
    ? projects.find(p => p.path === lastLaunchedProjectPath)
    : undefined;

  // If active file belongs to the last launched project, just run it
  if (lastProject && activeProject && activeProject.path === lastProject.path) {
    await launchProjectDirect(lastProject);
    return;
  }

  // If there's a last launched project (but active file is from a different project or no file open)
  if (lastProject) {
    const choice = await vscode.window.showQuickPick(
      [
        {
          label: `$(debug-start) ${lastProject.name}`,
          description: 'Last launched',
          value: 'last' as const,
        },
        { label: '$(folder-opened) Choose another project...', value: 'other' as const },
      ],
      { placeHolder: `Run ${lastProject.name} again?` },
    );

    if (!choice) {
      return;
    }

    if (choice.value === 'last') {
      await launchProjectDirect(lastProject);
      return;
    }

    // User chose "other" — fall through to active file check, then full picker
  }

  // Try to launch the project associated with the active file
  if (activeProject) {
    await launchProjectDirect(activeProject);
    return;
  }

  // No last project and no active file match — fall back to full project picker
  await launchProject();
}

/**
 * Launch project: Show project picker and debug
 */
export async function launchProject(): Promise<void> {
  const projects = await getProjects('runnable');

  if (projects.length === 0) {
    vscode.window.showWarningMessage('No runnable C# projects found in workspace');
    return;
  }

  // Step 1: Show project picker
  interface ProjectQuickPickItem extends vscode.QuickPickItem {
    project: ProjectInfo;
  }

  const projectItems: ProjectQuickPickItem[] = projects.map(project => ({
    label: `$(debug-start) ${project.name}`,
    description: project.isWeb ? 'Web Application' : 'Console Application',
    detail: `${project.targetFramework} • ${path.dirname(project.path)}`,
    project,
  }));

  // Sort items to show last used project first
  const lastUsed = getLastUsedItem();
  if (lastUsed) {
    projectItems.sort((a, b) => {
      if (a.project.path === lastUsed) return -1;
      if (b.project.path === lastUsed) return 1;
      return 0;
    });
  }

  const selectedProject = await vscode.window.showQuickPick(projectItems, {
    placeHolder: 'Select a project to debug',
    matchOnDescription: true,
  });

  if (!selectedProject) {
    return;
  }

  const project = selectedProject.project;
  setLastUsedItem(project.path);
  lastLaunchedProjectPath = project.path;
  let profileName: string | undefined;

  // Step 2: If the project has launch profiles, show profile picker
  if (project.hasLaunchSettings && project.launchProfiles?.profiles) {
    const profileEntries = Object.entries(project.launchProfiles.profiles);

    if (profileEntries.length > 0) {
      interface ProfileQuickPickItem extends vscode.QuickPickItem {
        profileName: string;
      }

      const previous = resolveProfileName(project);

      const profileItems: ProfileQuickPickItem[] = profileEntries.map(([name, profile]) => {
        const commandName = (profile as any).commandName || '';
        const appUrl = (profile as any).applicationUrl || '';
        return {
          label: `$(rocket) ${name}`,
          description: name === previous ? `${commandName} • Last used`.trim() : commandName,
          detail: appUrl,
          profileName: name,
        };
      });

      // Offer the profile this project last ran with first
      profileItems.sort((a, b) => {
        if (a.profileName === previous) return -1;
        if (b.profileName === previous) return 1;
        return 0;
      });

      const selectedProfile = await vscode.window.showQuickPick(profileItems, {
        placeHolder: `Select a launch profile for ${project.name}`,
        matchOnDescription: true,
      });

      if (!selectedProfile) {
        return;
      }

      profileName = selectedProfile.profileName;
      lastProfileByProject.set(project.path, profileName);
    }
  }

  const finalDllPath = await buildAndResolveDll(project);
  if (!finalDllPath) {
    return;
  }

  const config = generateDebugConfig(project, profileName, finalDllPath);

  // Start debugging
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(project.path));
  await vscode.debug.startDebugging(workspaceFolder, config);
}
