/**
 * Debug Launcher Module
 *
 * Provides comprehensive debug configuration and quick launch functionality
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

interface ProjectInfo {
  name: string;
  path: string;
  outputType: 'exe' | 'library' | 'web';
  targetFramework: string;
  isWeb: boolean;
  hasLaunchSettings: boolean;
  launchProfiles?: any;
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
    };
  } catch {
    return null;
  }
}

/**
 * Clean a project using dotnet clean
 */
export async function cleanProject(
  project: ProjectInfo,
  autoClose: boolean = false,
): Promise<void> {
  const projectDir = path.dirname(project.path);

  return new Promise<void>((resolve, reject) => {
    const terminal = vscode.window.createTerminal({
      name: `Clean ${project.name}`,
      cwd: projectDir,
      hideFromUser: false,
    });

    vscode.window.showInformationMessage(`Cleaning ${project.name}...`);

    // Show the terminal briefly
    terminal.show(true);

    // Use dotnet clean command - PowerShell compatible
    const closeCommand = autoClose ? '; exit $LASTEXITCODE' : '';
    terminal.sendText(`dotnet clean "${project.path}"${closeCommand}`, true);

    // Timeout after 60 seconds
    const timeoutId = setTimeout(() => {
      disposable.dispose();
      vscode.window.showWarningMessage(`Clean timeout: ${project.name}`);
      resolve(); // Continue anyway
    }, 60000);

    // Wait for terminal to close (clean complete)
    const disposable = vscode.window.onDidCloseTerminal(async closedTerminal => {
      if (closedTerminal === terminal) {
        clearTimeout(timeoutId);
        disposable.dispose();

        // Check if clean succeeded by looking at exit code
        if (closedTerminal.exitStatus?.code === 0) {
          vscode.window.showInformationMessage(`✓ Clean succeeded: ${project.name}`);
          resolve();
        } else {
          vscode.window.showErrorMessage(`Clean failed: ${project.name}`);
          reject(new Error('Clean failed'));
        }
      }
    });
  });
}

/**
 * Build a project using dotnet build
 */
export async function buildProject(
  project: ProjectInfo,
  autoClose: boolean = false,
): Promise<void> {
  const projectDir = path.dirname(project.path);

  return new Promise<void>((resolve, reject) => {
    const terminal = vscode.window.createTerminal({
      name: `Build ${project.name}`,
      cwd: projectDir,
      hideFromUser: false,
    });

    vscode.window.showInformationMessage(`Building ${project.name}...`);

    // Show the terminal briefly
    terminal.show(true);

    // Use dotnet build command - PowerShell compatible
    const closeCommand = autoClose ? '; exit $LASTEXITCODE' : '';
    terminal.sendText(`dotnet build "${project.path}"${closeCommand}`, true);

    // Timeout after 60 seconds
    const timeoutId = setTimeout(() => {
      disposable.dispose();
      vscode.window.showWarningMessage(`Build timeout: ${project.name}`);
      resolve(); // Continue anyway
    }, 60000);

    // Wait for terminal to close (build complete)
    const disposable = vscode.window.onDidCloseTerminal(async closedTerminal => {
      if (closedTerminal === terminal) {
        clearTimeout(timeoutId);
        disposable.dispose();

        // Check if build succeeded by looking at exit code
        if (closedTerminal.exitStatus?.code === 0) {
          vscode.window.showInformationMessage(`✓ Build succeeded: ${project.name}`);
          resolve();
        } else {
          vscode.window.showErrorMessage(`Build failed: ${project.name}`);
          reject(new Error('Build failed'));
        }
      }
    });
  });
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
    programPath = path.relative(workspaceRoot, dllPath).replace(/\\/g, '/');
  } else {
    const relativeProjectPath = path.relative(workspaceRoot, project.path).replace(/\\/g, '/');
    const relativeProjectDir = path.dirname(relativeProjectPath);
    const dllName = `${project.name}.dll`;
    programPath = `${relativeProjectDir}/bin/Debug/${project.targetFramework}/${dllName}`;
  }

  const relativeProjectDir = path.relative(workspaceRoot, projectDir).replace(/\\/g, '/');

  const config: vscode.DebugConfiguration = {
    name: profileName ? `${project.name} (${profileName})` : project.name,
    type: 'coreclr',
    request: 'launch',
    program: '${workspaceFolder}/' + programPath,
    args: [],
    cwd: '${workspaceFolder}/' + relativeProjectDir,
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

    if (profile?.launchBrowser !== false) {
      config.launchBrowser = {
        enabled: true,
        args: '${auto-detect-url}',
        windows: {
          command: 'cmd.exe',
          args: '/C start ${auto-detect-url}',
        },
      };
    }
  }

  return config;
}

/**
 * Quick launch: Show project picker and debug
 */
export async function quickLaunch(): Promise<void> {
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

  const selectedProject = await vscode.window.showQuickPick(projectItems, {
    placeHolder: 'Select a project to debug',
    matchOnDescription: true,
    matchOnDetail: true,
  });

  if (!selectedProject) {
    return;
  }

  const project = selectedProject.project;
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
        matchOnDetail: true,
      });

      if (!selectedProfile) {
        return;
      }

      profileName = selectedProfile.profileName;
    }
  }

  // Build the project first (auto-close terminal for seamless launch)
  await buildProject(project, true);

  // Find the actual DLL path after build
  const dllPath = findBuiltDllPath(project);
  if (!dllPath) {
    vscode.window.showErrorMessage(
      `Could not find built DLL for ${project.name}. Build may have failed.`,
    );
    return;
  }

  const config = generateDebugConfig(project, profileName, dllPath);

  // Start debugging
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(project.path));
  await vscode.debug.startDebugging(workspaceFolder, config);
}

/**
 * Quick build: Show project picker and build without running
 */
export async function quickBuild(): Promise<void> {
  const projects = await findRunnableProjects();

  if (projects.length === 0) {
    vscode.window.showWarningMessage('No runnable C# projects found in workspace');
    return;
  }

  // Show project picker
  interface ProjectQuickPickItem extends vscode.QuickPickItem {
    project: ProjectInfo;
  }

  const projectItems: ProjectQuickPickItem[] = projects.map(project => ({
    label: `$(tools) ${project.name}`,
    description: project.isWeb ? 'Web Application' : 'Console Application',
    detail: `${project.targetFramework} • ${path.dirname(project.path)}`,
    project,
  }));

  const selectedProject = await vscode.window.showQuickPick(projectItems, {
    placeHolder: 'Select a project to build',
    matchOnDescription: true,
    matchOnDetail: true,
  });

  if (!selectedProject) {
    return;
  }

  // Build the project
  await buildProject(selectedProject.project);
}

/**
 * Quick clean: Show project picker and clean
 */
export async function quickClean(): Promise<void> {
  const projects = await findRunnableProjects();

  if (projects.length === 0) {
    vscode.window.showWarningMessage('No runnable C# projects found in workspace');
    return;
  }

  // Show project picker
  interface ProjectQuickPickItem extends vscode.QuickPickItem {
    project: ProjectInfo;
  }

  const projectItems: ProjectQuickPickItem[] = projects.map(project => ({
    label: `$(trash) ${project.name}`,
    description: project.isWeb ? 'Web Application' : 'Console Application',
    detail: `${project.targetFramework} • ${path.dirname(project.path)}`,
    project,
  }));

  const selectedProject = await vscode.window.showQuickPick(projectItems, {
    placeHolder: 'Select a project to clean',
    matchOnDescription: true,
    matchOnDetail: true,
  });

  if (!selectedProject) {
    return;
  }

  // Clean the project
  await cleanProject(selectedProject.project);
}

/**
 * Quick rebuild: Show project picker and rebuild (clean + build)
 */
export async function quickRebuild(): Promise<void> {
  const projects = await findRunnableProjects();

  if (projects.length === 0) {
    vscode.window.showWarningMessage('No runnable C# projects found in workspace');
    return;
  }

  // Show project picker
  interface ProjectQuickPickItem extends vscode.QuickPickItem {
    project: ProjectInfo;
  }

  const projectItems: ProjectQuickPickItem[] = projects.map(project => ({
    label: `$(sync) ${project.name}`,
    description: project.isWeb ? 'Web Application' : 'Console Application',
    detail: `${project.targetFramework} • ${path.dirname(project.path)}`,
    project,
  }));

  const selectedProject = await vscode.window.showQuickPick(projectItems, {
    placeHolder: 'Select a project to rebuild',
    matchOnDescription: true,
    matchOnDetail: true,
  });

  if (!selectedProject) {
    return;
  }

  const project = selectedProject.project;
  const projectDir = path.dirname(project.path);

  // Chain clean and build in one terminal (keep terminal open)
  const terminal = vscode.window.createTerminal({
    name: `Rebuild ${project.name}`,
    cwd: projectDir,
    hideFromUser: false,
  });

  vscode.window.showInformationMessage(`Rebuilding ${project.name}...`);
  terminal.show(true);

  // Chain the commands together (terminal stays open)
  terminal.sendText(`dotnet clean "${project.path}"; dotnet build "${project.path}"`);
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
