/**
 * Debug Launcher Module
 *
 * Provides comprehensive debug configuration and quick launch functionality
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as child_process from 'child_process';
import {
  clearDiagnostics,
  parseBuildOutput,
  parseTestOutput,
  updateDiagnostics,
} from './diagnostics';

// Store the last used project/solution path for quick access
let lastUsedItemPath: string | undefined;

// Store the last launched project path for quick re-launch
let lastLaunchedProjectPath: string | undefined;

interface ProjectInfo {
  name: string;
  path: string;
  outputType: 'exe' | 'library' | 'web';
  targetFramework: string;
  isWeb: boolean;
  hasLaunchSettings: boolean;
  launchProfiles?: any;
  assemblyName?: string;
}

interface SolutionInfo {
  name: string;
  path: string;
  projectCount: number;
}

type BuildableItem = ProjectInfo | SolutionInfo;

function isSolution(item: BuildableItem): item is SolutionInfo {
  return 'projectCount' in item;
}

// ─── Build Output Channel ────────────────────────────────────────────

let buildOutputChannel: vscode.OutputChannel | undefined;

function getBuildOutputChannel(): vscode.OutputChannel {
  if (!buildOutputChannel) {
    buildOutputChannel = vscode.window.createOutputChannel('C# Build');
  }
  return buildOutputChannel;
}

/**
 * Run a shell command, streaming output to the C# Build output channel.
 * Replaces the old terminal+exec dual-execution approach so each command runs only once.
 */
function runDotnetVisual(
  command: string,
  cwd: string,
  label: string,
): Promise<{ success: boolean; output: string }> {
  return new Promise(resolve => {
    const channel = getBuildOutputChannel();
    channel.show(true);
    channel.appendLine(`▶ ${label}`);
    channel.appendLine(`> ${command}`);
    channel.appendLine('');

    const proc = child_process.spawn(command, { cwd, shell: true });
    let output = '';

    proc.stdout.on('data', (d: Buffer) => {
      const s = d.toString();
      output += s;
      channel.append(s);
    });
    proc.stderr.on('data', (d: Buffer) => {
      const s = d.toString();
      output += s;
      channel.append(s);
    });

    proc.on('close', code => {
      channel.appendLine(code === 0 ? '✓ Done' : '✗ Failed');
      channel.appendLine('');
      resolve({ success: code === 0, output });
    });
    proc.on('error', err => {
      channel.appendLine(`Error: ${err.message}`);
      channel.appendLine('');
      resolve({ success: false, output: err.message });
    });
  });
}

/**
 * Find all runnable C# projects in the workspace
 */
export async function findRunnableProjects(): Promise<ProjectInfo[]> {
  const projects: ProjectInfo[] = [];
  const csprojFiles = await vscode.workspace.findFiles('**/*.csproj', '**/node_modules/**');

  for (const uri of csprojFiles) {
    const projectPath = uri.fsPath;
    const projectInfo = await analyzeProject(projectPath);
    if (projectInfo && projectInfo.outputType === 'exe') {
      projects.push(projectInfo);
    }
  }

  return projects;
}

/**
 * Find all C# projects in the workspace (including libraries)
 */
export async function findAllProjects(): Promise<ProjectInfo[]> {
  const projects: ProjectInfo[] = [];
  const csprojFiles = await vscode.workspace.findFiles('**/*.csproj', '**/node_modules/**');

  for (const uri of csprojFiles) {
    const projectPath = uri.fsPath;
    const projectInfo = await analyzeProject(projectPath);
    if (projectInfo) {
      projects.push(projectInfo);
    }
  }

  return projects;
}

/**
 * Find all solution files in the workspace (including .sln, .slnx, and .slnf)
 */
export async function findSolutionFiles(): Promise<SolutionInfo[]> {
  const solutions: SolutionInfo[] = [];
  const slnFiles = await vscode.workspace.findFiles('**/*.{sln,slnx,slnf}', '**/node_modules/**');

  for (const uri of slnFiles) {
    const solutionPath = uri.fsPath;
    const ext = path.extname(solutionPath);
    const solutionName = path.basename(solutionPath, ext);

    // Count projects in the solution
    try {
      const content = fs.readFileSync(solutionPath, 'utf8');
      let projectCount = 0;

      if (ext === '.sln') {
        // Traditional .sln format
        const projectMatches = content.match(/Project\("{[^}]+}"\)/g);
        projectCount = projectMatches ? projectMatches.length : 0;
      } else if (ext === '.slnf') {
        // Solution filter is JSON format
        try {
          const slnfJson = JSON.parse(content);
          if (slnfJson.solution?.projects) {
            projectCount = slnfJson.solution.projects.length;
          }
        } catch {
          projectCount = 0;
        }
      } else if (ext === '.slnx') {
        // XML-based solution format
        const projectMatches = content.match(/<Project\s+Path="[^"]+"/g);
        projectCount = projectMatches ? projectMatches.length : 0;
      }

      solutions.push({
        name: solutionName,
        path: solutionPath,
        projectCount,
      });
    } catch {
      // Skip if we can't read the solution file
    }
  }

  return solutions;
}

/**
 * Find all test projects in the workspace
 */
export async function findTestProjects(): Promise<ProjectInfo[]> {
  const testProjects: ProjectInfo[] = [];
  const csprojFiles = await vscode.workspace.findFiles('**/*.csproj', '**/node_modules/**');

  for (const uri of csprojFiles) {
    const projectPath = uri.fsPath;
    const projectInfo = await analyzeProject(projectPath);

    if (projectInfo) {
      // Check if project has test framework references
      try {
        const content = fs.readFileSync(projectPath, 'utf8');
        const hasTestFramework =
          content.includes('Microsoft.NET.Test.Sdk') ||
          content.includes('xunit') ||
          content.includes('NUnit') ||
          content.includes('MSTest') ||
          content.includes('nunit') ||
          content.includes('MSTest.TestFramework') ||
          content.includes('MSTest.TestAdapter');

        if (hasTestFramework) {
          testProjects.push(projectInfo);
        }
      } catch {
        // Skip if we can't read the file
      }
    }
  }

  return testProjects;
}

/**
 * Analyze a .csproj file to determine project type and configuration
 */
async function analyzeProject(projectPath: string): Promise<ProjectInfo | null> {
  try {
    const content = fs.readFileSync(projectPath, 'utf8');
    const projectDir = path.dirname(projectPath);
    const projectName = path.basename(projectPath, '.csproj');

    // Determine output type
    let outputType: 'exe' | 'library' | 'web' = 'library';
    const outputTypeMatch = content.match(/<OutputType>([^<]+)<\/OutputType>/i);
    if (outputTypeMatch) {
      outputType = outputTypeMatch[1].toLowerCase() === 'exe' ? 'exe' : 'library';
    }

    // Check for SDK attribute (default is Exe for console apps)
    const sdkMatch = content.match(/<Project\s+Sdk="([^"]+)"/);
    if (sdkMatch && sdkMatch[1].includes('Microsoft.NET.Sdk.Web')) {
      outputType = 'exe';
    }

    // Get target framework
    let targetFramework = 'net8.0';
    const tfmMatch = content.match(/<TargetFramework>([^<]+)<\/TargetFramework>/);
    if (tfmMatch) {
      targetFramework = tfmMatch[1];
    }

    // Get assembly name (if different from project name)
    let assemblyName: string | undefined;
    const assemblyNameMatch = content.match(/<AssemblyName>([^<]+)<\/AssemblyName>/);
    if (assemblyNameMatch) {
      assemblyName = assemblyNameMatch[1];
    }

    // Check if it's a web project
    const isWeb =
      content.includes('Microsoft.NET.Sdk.Web') || content.includes('Microsoft.AspNetCore');

    // Check for launchSettings.json
    const launchSettingsPath = path.join(projectDir, 'Properties', 'launchSettings.json');
    let hasLaunchSettings = false;
    let launchProfiles: any = null;

    if (fs.existsSync(launchSettingsPath)) {
      hasLaunchSettings = true;
      try {
        let launchContent = fs.readFileSync(launchSettingsPath, 'utf8');

        // Remove UTF-8 BOM if present
        if (launchContent.charCodeAt(0) === 0xfeff) {
          launchContent = launchContent.slice(1);
        }

        launchProfiles = JSON.parse(launchContent);
      } catch (e) {
        // Failed to parse launchSettings.json, continue without profiles
      }
    }

    return {
      name: projectName,
      path: projectPath,
      outputType,
      targetFramework,
      isWeb,
      hasLaunchSettings,
      launchProfiles,
      assemblyName,
    };
  } catch {
    return null;
  }
}

/**
 * Clean a project using dotnet clean
 */
export async function cleanProject(project: ProjectInfo): Promise<void> {
  const projectDir = path.dirname(project.path);
  clearDiagnostics();

  const result = await runDotnetVisual(
    `dotnet clean "${project.path}"`,
    projectDir,
    `Clean ${project.name}`,
  );

  if (!result.success) {
    if (result.output) {
      const diagnosticMap = parseBuildOutput(result.output, projectDir);
      updateDiagnostics(diagnosticMap);
    }
    vscode.window.showErrorMessage(`Clean failed: ${project.name}`);
    throw new Error('Clean failed');
  }

  clearDiagnostics();
  vscode.window.showInformationMessage(`✓ Clean succeeded: ${project.name}`);
}

/**
 * Build a project using dotnet build
 */
export async function buildProject(project: ProjectInfo): Promise<string | null> {
  const projectDir = path.dirname(project.path);
  clearDiagnostics();

  const result = await runDotnetVisual(
    `dotnet build "${project.path}"`,
    projectDir,
    `Build ${project.name}`,
  );

  if (result.output) {
    const diagnosticMap = parseBuildOutput(result.output, projectDir);
    updateDiagnostics(diagnosticMap);
  }

  if (!result.success) {
    vscode.window.showErrorMessage(`Build failed: ${project.name}`);
    throw new Error('Build failed');
  }

  // Extract DLL path from build output
  let dllPath: string | null = null;
  const dllBaseName = project.assemblyName || project.name;
  const dllRegex = new RegExp(
    `->\\s*([^\\r\\n]*${dllBaseName.replace(/[.*+?^${}()|[\]\\\\]/g, '\\$&')}\\.dll)`,
    'i',
  );
  const dllMatch = result.output.match(dllRegex);

  if (dllMatch) {
    let extractedPath = dllMatch[1].trim();
    if (!path.isAbsolute(extractedPath)) {
      extractedPath = path.join(projectDir, extractedPath);
    }
    dllPath = path.normalize(extractedPath);
  }

  vscode.window.showInformationMessage(`✓ Build succeeded: ${project.name}`);
  return dllPath;
}

/**
 * Build a solution using dotnet build
 */
export async function buildSolution(solution: SolutionInfo): Promise<void> {
  const solutionDir = path.dirname(solution.path);
  clearDiagnostics();

  const result = await runDotnetVisual(
    `dotnet build "${solution.path}"`,
    solutionDir,
    `Build ${solution.name}`,
  );

  if (result.output) {
    const diagnosticMap = parseBuildOutput(result.output, solutionDir);
    updateDiagnostics(diagnosticMap);
  }

  if (!result.success) {
    vscode.window.showErrorMessage(`Build failed: ${solution.name}`);
    throw new Error('Build failed');
  }

  vscode.window.showInformationMessage(`✓ Build succeeded: ${solution.name}`);
}

/**
 * Clean a solution using dotnet clean
 */
export async function cleanSolution(solution: SolutionInfo): Promise<void> {
  const solutionDir = path.dirname(solution.path);
  clearDiagnostics();

  const result = await runDotnetVisual(
    `dotnet clean "${solution.path}"`,
    solutionDir,
    `Clean ${solution.name}`,
  );

  if (!result.success) {
    if (result.output) {
      const diagnosticMap = parseBuildOutput(result.output, solutionDir);
      updateDiagnostics(diagnosticMap);
    }
    vscode.window.showErrorMessage(`Clean failed: ${solution.name}`);
    throw new Error('Clean failed');
  }

  clearDiagnostics();
  vscode.window.showInformationMessage(`✓ Clean succeeded: ${solution.name}`);
}

/**
 * Test a project using dotnet test
 */
export async function testProject(project: ProjectInfo): Promise<void> {
  const projectDir = path.dirname(project.path);
  clearDiagnostics();

  const result = await runDotnetVisual(
    `dotnet test "${project.path}"`,
    projectDir,
    `Test ${project.name}`,
  );

  if (result.output) {
    const buildDiags = parseBuildOutput(result.output, projectDir);
    const testDiags = parseTestOutput(result.output, projectDir);
    // Merge diagnostics: combine arrays for the same file path
    const merged = new Map(buildDiags);
    for (const [file, diags] of testDiags) {
      const existing = merged.get(file);
      merged.set(file, existing ? [...existing, ...diags] : diags);
    }
    updateDiagnostics(merged);
  }

  if (!result.success) {
    vscode.window.showErrorMessage(`Tests failed: ${project.name}`);
    throw new Error('Tests failed');
  }

  vscode.window.showInformationMessage(`✓ Tests passed: ${project.name}`);
}

/**
 * Test a solution using dotnet test
 */
export async function testSolution(solution: SolutionInfo): Promise<void> {
  const solutionDir = path.dirname(solution.path);
  clearDiagnostics();

  const result = await runDotnetVisual(
    `dotnet test "${solution.path}"`,
    solutionDir,
    `Test ${solution.name}`,
  );

  if (result.output) {
    const buildDiags = parseBuildOutput(result.output, solutionDir);
    const testDiags = parseTestOutput(result.output, solutionDir);
    // Merge diagnostics: combine arrays for the same file path
    const merged = new Map(buildDiags);
    for (const [file, diags] of testDiags) {
      const existing = merged.get(file);
      merged.set(file, existing ? [...existing, ...diags] : diags);
    }
    updateDiagnostics(merged);
  }

  if (!result.success) {
    vscode.window.showErrorMessage(`Tests failed: ${solution.name}`);
    throw new Error('Tests failed');
  }

  vscode.window.showInformationMessage(`✓ Tests passed: ${solution.name}`);
}

/**
 * Find the actual DLL path after build
 */
function findBuiltDllPath(project: ProjectInfo): string | null {
  const projectDir = path.dirname(project.path);
  const dllName = `${project.name}.dll`;

  // Common output paths to check
  const possiblePaths = [
    path.join(projectDir, 'bin', 'Debug', project.targetFramework, dllName),
    path.join(projectDir, 'bin', 'Debug', `${project.targetFramework}.0`, dllName),
    path.join(projectDir, 'bin', 'Release', project.targetFramework, dllName),
    path.join(projectDir, 'bin', 'Release', `${project.targetFramework}.0`, dllName),
  ];

  // Also check for runtime identifiers (e.g., win-x64)
  try {
    const debugDir = path.join(projectDir, 'bin', 'Debug');
    if (fs.existsSync(debugDir)) {
      const tfmDirs = fs.readdirSync(debugDir);
      for (const tfmDir of tfmDirs) {
        if (tfmDir.startsWith('net')) {
          possiblePaths.push(path.join(debugDir, tfmDir, dllName));
          // Check for RID folders
          const tfmPath = path.join(debugDir, tfmDir);
          if (fs.existsSync(tfmPath) && fs.statSync(tfmPath).isDirectory()) {
            const ridDirs = fs.readdirSync(tfmPath);
            for (const ridDir of ridDirs) {
              possiblePaths.push(path.join(tfmPath, ridDir, dllName));
            }
          }
        }
      }
    }
  } catch {
    // Ignore errors
  }

  // Find first existing DLL
  for (const dllPath of possiblePaths) {
    if (fs.existsSync(dllPath)) {
      return dllPath;
    }
  }

  return null;
}

/**
 * Generate debug configuration for a project
 */
function generateDebugConfig(
  project: ProjectInfo,
  profileName?: string,
  dllPath?: string,
): vscode.DebugConfiguration {
  const projectDir = path.dirname(project.path);
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(project.path));
  const workspaceRoot = workspaceFolder?.uri.fsPath || projectDir;

  // Use provided DLL path or calculate default
  let programPath: string;
  if (dllPath) {
    let relativePath = path.relative(workspaceRoot, dllPath).replace(/\\/g, '/');
    // Handle edge cases: empty path, ".", or "./"
    if (!relativePath || relativePath === '.') {
      relativePath = path.basename(dllPath);
    }
    programPath = relativePath;
  } else {
    const relativeProjectPath = path.relative(workspaceRoot, project.path).replace(/\\/g, '/');
    let relativeProjectDir = path.dirname(relativeProjectPath);
    // Handle edge cases: empty path, ".", or "./"
    if (!relativeProjectDir || relativeProjectDir === '.') {
      relativeProjectDir = '';
    }
    const dllName = `${project.name}.dll`;
    programPath = relativeProjectDir
      ? `${relativeProjectDir}/bin/Debug/${project.targetFramework}/${dllName}`
      : `bin/Debug/${project.targetFramework}/${dllName}`;
  }

  let relativeProjectDir = path.relative(workspaceRoot, projectDir).replace(/\\/g, '/');
  // Handle edge cases for cwd
  if (!relativeProjectDir || relativeProjectDir === '.') {
    relativeProjectDir = '';
  }

  const config: vscode.DebugConfiguration = {
    name: profileName ? `${project.name} (${profileName})` : project.name,
    type: 'coreclr',
    request: 'launch',
    program: `\${workspaceFolder}/${programPath}`,
    args: [],
    cwd: relativeProjectDir ? `\${workspaceFolder}/${relativeProjectDir}` : '${workspaceFolder}',
    stopAtEntry: false,
    console: project.isWeb ? 'internalConsole' : 'integratedTerminal',
  };

  // Add web-specific configuration
  if (project.isWeb) {
    const profile = profileName && project.launchProfiles?.profiles?.[profileName];
    const applicationUrl = profile?.applicationUrl || 'http://localhost:5000';

    config.env = {
      ASPNETCORE_ENVIRONMENT:
        profile?.environmentVariables?.ASPNETCORE_ENVIRONMENT || 'Development',
      ...(profile?.environmentVariables || {}),
    };

    // Set the ASPNETCORE_URLS to match the selected profile
    if (applicationUrl) {
      config.env.ASPNETCORE_URLS = applicationUrl;
    }

    config.serverReadyAction = {
      action: 'openExternally',
      pattern: '\\bNow listening on:\\s+(https?://\\S+)',
      uriFormat: '%s',
    };
  }

  return config;
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

  const projects = await findRunnableProjects();
  // Find the project whose directory is an ancestor of the open file
  // Pick the deepest match (most specific project)
  let bestMatch: ProjectInfo | undefined;
  let bestDepth = -1;

  for (const project of projects) {
    const projectDir = path.dirname(project.path);
    if (filePath.startsWith(projectDir + path.sep) || filePath.startsWith(projectDir + '/')) {
      const depth = projectDir.split(path.sep).length;
      if (depth > bestDepth) {
        bestDepth = depth;
        bestMatch = project;
      }
    }
  }

  return bestMatch;
}

/**
 * Launch a project (build + debug), reusing last profile if available
 */
async function launchProjectDirect(project: ProjectInfo): Promise<void> {
  const dllPath = await buildProject(project);
  await new Promise(resolve => setTimeout(resolve, 500));

  let finalDllPath = dllPath;
  if (!finalDllPath) {
    finalDllPath = findBuiltDllPath(project);
  }

  if (!finalDllPath) {
    vscode.window.showErrorMessage(
      `Could not find built DLL for ${project.name}. Build may have failed.`,
    );
    return;
  }

  const config = generateDebugConfig(project, undefined, finalDllPath);
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(project.path));
  lastUsedItemPath = project.path;
  lastLaunchedProjectPath = project.path;
  await vscode.debug.startDebugging(workspaceFolder, config);
}

/**
 * Quick launch: Re-run last project or infer from active editor
 */
export async function quickLaunch(): Promise<void> {
  const projects = await findRunnableProjects();

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
  const projects = await findRunnableProjects();

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
  if (lastUsedItemPath) {
    projectItems.sort((a, b) => {
      if (a.project.path === lastUsedItemPath) return -1;
      if (b.project.path === lastUsedItemPath) return 1;
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
  lastUsedItemPath = project.path;
  lastLaunchedProjectPath = project.path;
  let profileName: string | undefined;

  // Step 2: If the project has launch profiles, show profile picker
  if (project.hasLaunchSettings && project.launchProfiles?.profiles) {
    const profileEntries = Object.entries(project.launchProfiles.profiles);

    if (profileEntries.length > 0) {
      interface ProfileQuickPickItem extends vscode.QuickPickItem {
        profileName: string;
      }

      const profileItems: ProfileQuickPickItem[] = profileEntries.map(([name, profile]) => {
        const commandName = (profile as any).commandName || '';
        const appUrl = (profile as any).applicationUrl || '';
        return {
          label: `$(rocket) ${name}`,
          description: commandName,
          detail: appUrl,
          profileName: name,
        };
      });

      const selectedProfile = await vscode.window.showQuickPick(profileItems, {
        placeHolder: `Select a launch profile for ${project.name}`,
        matchOnDescription: true,
      });

      if (!selectedProfile) {
        return;
      }

      profileName = selectedProfile.profileName;
    }
  }

  // Build the project first
  const dllPath = await buildProject(project);

  // Small delay to ensure DLL is fully written (especially important for ASP.NET Core apps)
  await new Promise(resolve => setTimeout(resolve, 500));

  // Use DLL path from build output, or fall back to searching
  let finalDllPath = dllPath;
  if (!finalDllPath) {
    finalDllPath = findBuiltDllPath(project);
  }

  if (!finalDllPath) {
    vscode.window.showErrorMessage(
      `Could not find built DLL for ${project.name}. Build may have failed.`,
    );
    return;
  }

  const config = generateDebugConfig(project, profileName, finalDllPath);

  // Start debugging
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(project.path));
  await vscode.debug.startDebugging(workspaceFolder, config);
}

/**
 * Quick build: Show project picker and build without running
 */
export async function quickBuild(): Promise<void> {
  const projects = await findAllProjects();
  const solutions = await findSolutionFiles();

  if (projects.length === 0 && solutions.length === 0) {
    vscode.window.showWarningMessage('No C# projects or solutions found in workspace');
    return;
  }

  // Show picker with both projects and solutions
  interface BuildableQuickPickItem extends vscode.QuickPickItem {
    item: BuildableItem;
  }

  const items: BuildableQuickPickItem[] = [];

  // Add solutions first
  for (const solution of solutions) {
    items.push({
      label: `$(folder) ${solution.name}`,
      description: 'Solution',
      detail: `${solution.projectCount} project(s) • ${path.dirname(solution.path)}`,
      item: solution,
    });
  }

  // Add projects
  for (const project of projects) {
    items.push({
      label: `$(tools) ${project.name}`,
      description: project.isWeb ? 'Web Application' : 'Console Application',
      detail: `${project.targetFramework} • ${path.dirname(project.path)}`,
      item: project,
    });
  }

  // Sort items to show last used item first
  if (lastUsedItemPath) {
    items.sort((a, b) => {
      if (a.item.path === lastUsedItemPath) return -1;
      if (b.item.path === lastUsedItemPath) return 1;
      return 0;
    });
  }

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a project or solution to build',
    matchOnDescription: true,
  });

  if (!selected) {
    return;
  }

  lastUsedItemPath = selected.item.path;

  // Build based on type
  try {
    if (isSolution(selected.item)) {
      await buildSolution(selected.item);
    } else {
      await buildProject(selected.item);
    }
  } catch {
    // Error messages already shown by build functions
  }
}

/**
 * Quick clean: Show project picker and clean
 */
export async function quickClean(): Promise<void> {
  const projects = await findAllProjects();
  const solutions = await findSolutionFiles();

  if (projects.length === 0 && solutions.length === 0) {
    vscode.window.showWarningMessage('No C# projects or solutions found in workspace');
    return;
  }

  // Show picker with both projects and solutions
  interface BuildableQuickPickItem extends vscode.QuickPickItem {
    item: BuildableItem;
  }

  const items: BuildableQuickPickItem[] = [];

  // Add solutions first
  for (const solution of solutions) {
    items.push({
      label: `$(folder) ${solution.name}`,
      description: 'Solution',
      detail: `${solution.projectCount} project(s) • ${path.dirname(solution.path)}`,
      item: solution,
    });
  }

  // Add projects
  for (const project of projects) {
    items.push({
      label: `$(trash) ${project.name}`,
      description: project.isWeb ? 'Web Application' : 'Console Application',
      detail: `${project.targetFramework} • ${path.dirname(project.path)}`,
      item: project,
    });
  }

  // Sort items to show last used item first
  if (lastUsedItemPath) {
    items.sort((a, b) => {
      if (a.item.path === lastUsedItemPath) return -1;
      if (b.item.path === lastUsedItemPath) return 1;
      return 0;
    });
  }

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a project or solution to clean',
    matchOnDescription: true,
  });

  if (!selected) {
    return;
  }

  lastUsedItemPath = selected.item.path;

  // Clean based on type
  try {
    if (isSolution(selected.item)) {
      await cleanSolution(selected.item);
    } else {
      await cleanProject(selected.item);
    }
  } catch {
    // Error messages already shown by clean functions
  }
}

/**
 * Quick rebuild: Show project picker and rebuild (clean + build)
 */
export async function quickRebuild(): Promise<void> {
  const projects = await findAllProjects();
  const solutions = await findSolutionFiles();

  if (projects.length === 0 && solutions.length === 0) {
    vscode.window.showWarningMessage('No C# projects or solutions found in workspace');
    return;
  }

  // Show picker with both projects and solutions
  interface BuildableQuickPickItem extends vscode.QuickPickItem {
    item: BuildableItem;
  }

  const items: BuildableQuickPickItem[] = [];

  // Add solutions first
  for (const solution of solutions) {
    items.push({
      label: `$(folder) ${solution.name}`,
      description: 'Solution',
      detail: `${solution.projectCount} project(s) • ${path.dirname(solution.path)}`,
      item: solution,
    });
  }

  // Add projects
  for (const project of projects) {
    items.push({
      label: `$(sync) ${project.name}`,
      description: project.isWeb ? 'Web Application' : 'Console Application',
      detail: `${project.targetFramework} • ${path.dirname(project.path)}`,
      item: project,
    });
  }

  // Sort items to show last used item first
  if (lastUsedItemPath) {
    items.sort((a, b) => {
      if (a.item.path === lastUsedItemPath) return -1;
      if (b.item.path === lastUsedItemPath) return 1;
      return 0;
    });
  }

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a project or solution to rebuild',
    matchOnDescription: true,
  });

  if (!selected) {
    return;
  }

  const item = selected.item;
  lastUsedItemPath = item.path;

  // Perform clean and build sequentially with diagnostic support
  try {
    if (isSolution(item)) {
      await cleanSolution(item);
      await buildSolution(item);
    } else {
      await cleanProject(item);
      await buildProject(item);
    }
  } catch (error) {
    // Error messages already shown by individual functions
  }
}

/**
 * Quick test: Show project picker and run tests
 */
export async function quickTest(): Promise<void> {
  const projects = await findTestProjects();
  const solutions = await findSolutionFiles();

  if (projects.length === 0 && solutions.length === 0) {
    vscode.window.showWarningMessage('No test projects or solutions found in workspace');
    return;
  }

  // Show picker with both projects and solutions
  interface BuildableQuickPickItem extends vscode.QuickPickItem {
    item: BuildableItem;
  }

  const items: BuildableQuickPickItem[] = [];

  // Add solutions first
  for (const solution of solutions) {
    items.push({
      label: `$(folder) ${solution.name}`,
      description: 'Solution',
      detail: `${solution.projectCount} project(s) • ${path.dirname(solution.path)}`,
      item: solution,
    });
  }

  // Add test projects
  for (const project of projects) {
    items.push({
      label: `$(beaker) ${project.name}`,
      description: 'Test Project',
      detail: `${project.targetFramework} • ${path.dirname(project.path)}`,
      item: project,
    });
  }

  // Sort items to show last used item first
  if (lastUsedItemPath) {
    items.sort((a, b) => {
      if (a.item.path === lastUsedItemPath) return -1;
      if (b.item.path === lastUsedItemPath) return 1;
      return 0;
    });
  }

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a project or solution to test',
    matchOnDescription: true,
  });

  if (!selected) {
    return;
  }

  lastUsedItemPath = selected.item.path;

  // Test based on type
  try {
    if (isSolution(selected.item)) {
      await testSolution(selected.item);
    } else {
      await testProject(selected.item);
    }
  } catch {
    // Error messages already shown by test functions
  }
}

/**
 * Generate launch.json configurations for all projects
 */
export async function generateLaunchConfigurations(): Promise<void> {
  const projects = await findRunnableProjects();

  if (projects.length === 0) {
    vscode.window.showInformationMessage('No runnable C# projects found');
    return;
  }

  const configurations: vscode.DebugConfiguration[] = [];

  for (const project of projects) {
    if (project.hasLaunchSettings && project.launchProfiles?.profiles) {
      // Generate config for each profile
      for (const profileName of Object.keys(project.launchProfiles.profiles)) {
        configurations.push(generateDebugConfig(project, profileName));
      }
    } else {
      configurations.push(generateDebugConfig(project));
    }
  }

  // Read or create launch.json
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('No workspace folder open');
    return;
  }

  const vscodeDir = path.join(workspaceFolder.uri.fsPath, '.vscode');
  if (!fs.existsSync(vscodeDir)) {
    fs.mkdirSync(vscodeDir);
  }

  const launchJsonPath = path.join(vscodeDir, 'launch.json');
  let launchConfig: any = {
    version: '0.2.0',
    configurations: [],
  };

  if (fs.existsSync(launchJsonPath)) {
    try {
      const content = fs.readFileSync(launchJsonPath, 'utf8');
      launchConfig = JSON.parse(content);
    } catch {
      // Use default if parse fails
    }
  }

  // Merge configurations (avoid duplicates by name)
  const existingNames = new Set(launchConfig.configurations.map((c: any) => c.name));
  for (const config of configurations) {
    if (!existingNames.has(config.name)) {
      launchConfig.configurations.push(config);
    }
  }

  // Write launch.json
  fs.writeFileSync(launchJsonPath, JSON.stringify(launchConfig, null, 2), 'utf8');

  vscode.window.showInformationMessage(
    `Generated ${configurations.length} debug configuration(s) in launch.json`,
  );

  // Open launch.json
  const doc = await vscode.workspace.openTextDocument(launchJsonPath);
  await vscode.window.showTextDocument(doc);
}
