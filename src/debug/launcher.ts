/**
 * Debug Launcher Module
 *
 * Provides comprehensive debug configuration and quick launch functionality
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// Store the last used project/solution path for quick access
let lastUsedItemPath: string | undefined;

interface ProjectInfo {
  name: string;
  path: string;
  outputType: 'exe' | 'library' | 'web';
  targetFramework: string;
  isWeb: boolean;
  hasLaunchSettings: boolean;
  launchProfiles?: any;
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
 * Find all solution files in the workspace
 */
export async function findSolutionFiles(): Promise<SolutionInfo[]> {
  const solutions: SolutionInfo[] = [];
  const slnFiles = await vscode.workspace.findFiles('**/*.sln', '**/node_modules/**');

  for (const uri of slnFiles) {
    const solutionPath = uri.fsPath;
    const solutionName = path.basename(solutionPath, '.sln');

    // Count projects in the solution
    try {
      const content = fs.readFileSync(solutionPath, 'utf8');
      const projectMatches = content.match(/Project\("{[^}]+}"\)/g);
      const projectCount = projectMatches ? projectMatches.length : 0;

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
 * Build a solution using dotnet build
 */
export async function buildSolution(
  solution: SolutionInfo,
  autoClose: boolean = false,
): Promise<void> {
  const solutionDir = path.dirname(solution.path);

  return new Promise<void>((resolve, reject) => {
    const terminal = vscode.window.createTerminal({
      name: `Build ${solution.name}`,
      cwd: solutionDir,
      hideFromUser: false,
    });

    vscode.window.showInformationMessage(`Building solution ${solution.name}...`);

    // Show the terminal briefly
    terminal.show(true);

    // Use dotnet build command - PowerShell compatible
    const closeCommand = autoClose ? '; exit $LASTEXITCODE' : '';
    terminal.sendText(`dotnet build "${solution.path}"${closeCommand}`, true);

    // Timeout after 120 seconds (solutions may take longer)
    const timeoutId = setTimeout(() => {
      disposable.dispose();
      vscode.window.showWarningMessage(`Build timeout: ${solution.name}`);
      resolve(); // Continue anyway
    }, 120000);

    // Wait for terminal to close (build complete)
    const disposable = vscode.window.onDidCloseTerminal(async closedTerminal => {
      if (closedTerminal === terminal) {
        clearTimeout(timeoutId);
        disposable.dispose();

        // Check if build succeeded by looking at exit code
        if (closedTerminal.exitStatus?.code === 0) {
          vscode.window.showInformationMessage(`✓ Build succeeded: ${solution.name}`);
          resolve();
        } else {
          vscode.window.showErrorMessage(`Build failed: ${solution.name}`);
          reject(new Error('Build failed'));
        }
      }
    });
  });
}

/**
 * Clean a solution using dotnet clean
 */
export async function cleanSolution(
  solution: SolutionInfo,
  autoClose: boolean = false,
): Promise<void> {
  const solutionDir = path.dirname(solution.path);

  return new Promise<void>((resolve, reject) => {
    const terminal = vscode.window.createTerminal({
      name: `Clean ${solution.name}`,
      cwd: solutionDir,
      hideFromUser: false,
    });

    vscode.window.showInformationMessage(`Cleaning solution ${solution.name}...`);

    // Show the terminal briefly
    terminal.show(true);

    // Use dotnet clean command - PowerShell compatible
    const closeCommand = autoClose ? '; exit $LASTEXITCODE' : '';
    terminal.sendText(`dotnet clean "${solution.path}"${closeCommand}`, true);

    // Timeout after 60 seconds
    const timeoutId = setTimeout(() => {
      disposable.dispose();
      vscode.window.showWarningMessage(`Clean timeout: ${solution.name}`);
      resolve(); // Continue anyway
    }, 60000);

    // Wait for terminal to close (clean complete)
    const disposable = vscode.window.onDidCloseTerminal(async closedTerminal => {
      if (closedTerminal === terminal) {
        clearTimeout(timeoutId);
        disposable.dispose();

        // Check if clean succeeded by looking at exit code
        if (closedTerminal.exitStatus?.code === 0) {
          vscode.window.showInformationMessage(`✓ Clean succeeded: ${solution.name}`);
          resolve();
        } else {
          vscode.window.showErrorMessage(`Clean failed: ${solution.name}`);
          reject(new Error('Clean failed'));
        }
      }
    });
  });
}

/**
 * Test a project using dotnet test
 */
export async function testProject(project: ProjectInfo, autoClose: boolean = false): Promise<void> {
  const projectDir = path.dirname(project.path);

  return new Promise<void>((resolve, reject) => {
    const terminal = vscode.window.createTerminal({
      name: `Test ${project.name}`,
      cwd: projectDir,
      hideFromUser: false,
    });

    vscode.window.showInformationMessage(`Testing ${project.name}...`);

    // Show the terminal briefly
    terminal.show(true);

    // Use dotnet test command - PowerShell compatible
    const closeCommand = autoClose ? '; exit $LASTEXITCODE' : '';
    terminal.sendText(`dotnet test "${project.path}"${closeCommand}`, true);

    // Timeout after 120 seconds (tests may take longer)
    const timeoutId = setTimeout(() => {
      disposable.dispose();
      vscode.window.showWarningMessage(`Test timeout: ${project.name}`);
      resolve(); // Continue anyway
    }, 120000);

    // Wait for terminal to close (test complete)
    const disposable = vscode.window.onDidCloseTerminal(async closedTerminal => {
      if (closedTerminal === terminal) {
        clearTimeout(timeoutId);
        disposable.dispose();

        // Check if test succeeded by looking at exit code
        if (closedTerminal.exitStatus?.code === 0) {
          vscode.window.showInformationMessage(`✓ Tests passed: ${project.name}`);
          resolve();
        } else {
          vscode.window.showErrorMessage(`Tests failed: ${project.name}`);
          reject(new Error('Tests failed'));
        }
      }
    });
  });
}

/**
 * Test a solution using dotnet test
 */
export async function testSolution(
  solution: SolutionInfo,
  autoClose: boolean = false,
): Promise<void> {
  const solutionDir = path.dirname(solution.path);

  return new Promise<void>((resolve, reject) => {
    const terminal = vscode.window.createTerminal({
      name: `Test ${solution.name}`,
      cwd: solutionDir,
      hideFromUser: false,
    });

    vscode.window.showInformationMessage(`Testing solution ${solution.name}...`);

    // Show the terminal briefly
    terminal.show(true);

    // Use dotnet test command - PowerShell compatible
    const closeCommand = autoClose ? '; exit $LASTEXITCODE' : '';
    terminal.sendText(`dotnet test "${solution.path}"${closeCommand}`, true);

    // Timeout after 120 seconds (tests may take longer)
    const timeoutId = setTimeout(() => {
      disposable.dispose();
      vscode.window.showWarningMessage(`Test timeout: ${solution.name}`);
      resolve(); // Continue anyway
    }, 120000);

    // Wait for terminal to close (test complete)
    const disposable = vscode.window.onDidCloseTerminal(async closedTerminal => {
      if (closedTerminal === terminal) {
        clearTimeout(timeoutId);
        disposable.dispose();

        // Check if test succeeded by looking at exit code
        if (closedTerminal.exitStatus?.code === 0) {
          vscode.window.showInformationMessage(`✓ Tests passed: ${solution.name}`);
          resolve();
        } else {
          vscode.window.showErrorMessage(`Tests failed: ${solution.name}`);
          reject(new Error('Tests failed'));
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
    matchOnDetail: true,
  });

  if (!selectedProject) {
    return;
  }

  const project = selectedProject.project;
  lastUsedItemPath = project.path;
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
    matchOnDetail: true,
  });

  if (!selected) {
    return;
  }

  lastUsedItemPath = selected.item.path;

  // Build based on type
  if (isSolution(selected.item)) {
    await buildSolution(selected.item);
  } else {
    await buildProject(selected.item);
  }
}

/**
 * Quick clean: Show project picker and clean
 */
export async function quickClean(): Promise<void> {
  const projects = await findRunnableProjects();
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
    matchOnDetail: true,
  });

  if (!selected) {
    return;
  }

  lastUsedItemPath = selected.item.path;

  // Clean based on type
  if (isSolution(selected.item)) {
    await cleanSolution(selected.item);
  } else {
    await cleanProject(selected.item);
  }
}

/**
 * Quick rebuild: Show project picker and rebuild (clean + build)
 */
export async function quickRebuild(): Promise<void> {
  const projects = await findRunnableProjects();
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
    matchOnDetail: true,
  });

  if (!selected) {
    return;
  }

  const item = selected.item;
  lastUsedItemPath = item.path;
  const itemPath = item.path;
  const itemDir = path.dirname(itemPath);
  const itemName = item.name;

  // Chain clean and build in one terminal (keep terminal open)
  const terminal = vscode.window.createTerminal({
    name: `Rebuild ${itemName}`,
    cwd: itemDir,
    hideFromUser: false,
  });

  vscode.window.showInformationMessage(`Rebuilding ${itemName}...`);
  terminal.show(true);

  // Chain the commands together (terminal stays open)
  terminal.sendText(`dotnet clean "${itemPath}"; dotnet build "${itemPath}"`);
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
    matchOnDetail: true,
  });

  if (!selected) {
    return;
  }

  lastUsedItemPath = selected.item.path;

  // Test based on type
  if (isSolution(selected.item)) {
    await testSolution(selected.item);
  } else {
    await testProject(selected.item);
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
