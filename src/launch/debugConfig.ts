/**
 * Debug Configuration
 *
 * Builds the `coreclr` launch configuration for a project, and writes the same
 * configurations into .vscode/launch.json on request.
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getProjects, ProjectInfo } from '../shared/projectIndex';
import { BUILD_CONFIGURATION } from '../build/constants';

/**
 * Generate debug configuration for a project
 */
export function generateDebugConfig(
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
    const dllName = `${project.assemblyName || project.name}.dll`;
    const outputDir = `bin/${BUILD_CONFIGURATION}/${project.targetFramework}`;
    programPath = relativeProjectDir
      ? `${relativeProjectDir}/${outputDir}/${dllName}`
      : `${outputDir}/${dllName}`;
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

    const openBrowser = vscode.workspace
      .getConfiguration('debugSharp')
      .get<boolean>('openBrowserOnLaunch', true);

    if (openBrowser) {
      config.serverReadyAction = {
        action: 'openExternally',
        pattern: '\\bNow listening on:\\s+(https?://\\S+)',
        uriFormat: '%s',
      };
    }
  }

  // Suppress framework noise if enabled (similar to Rider's default behavior)
  const suppressFrameworkLogs = vscode.workspace
    .getConfiguration('debugSharp')
    .get<boolean>('suppressFrameworkLogs', true);

  if (suppressFrameworkLogs) {
    config.logging = { moduleLoad: false };
    config.env = {
      ...config.env,
      Logging__Debug__LogLevel__Default: 'None',
    };
  }

  return config;
}

/**
 * Generate launch.json configurations for all projects
 */
export async function generateLaunchConfigurations(): Promise<void> {
  const projects = await getProjects('runnable');

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
