/**
 * NuGet Package Manager Panel
 *
 * Provides a webview panel for managing NuGet packages in a .csproj file.
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
  searchPackages,
  getPackageVersions,
  getPackageMetadata,
  NuGetSearchResult,
} from '../../services/nugetService';
import {
  getInstalledPackages,
  getAllPackages,
  addPackageReference,
  removePackageReference,
  updatePackageReference,
  getCrossProjectReferences,
  batchCrossProjectCheck,
  InstalledPackage,
  CrossProjectReference,
} from '../../services/nugetManager';

let currentNugetPanel: vscode.WebviewPanel | undefined;
let nugetExtensionContext: vscode.ExtensionContext | undefined;
let currentCsprojPath: string | undefined;
let showAllPackages: boolean = false;

/**
 * Initialize the NuGet panel module
 */
export function initializeNugetPanel(context: vscode.ExtensionContext): void {
  nugetExtensionContext = context;
}

/**
 * Show the NuGet Package Manager panel
 */
export async function showNugetPackageManager(csprojPath: string): Promise<void> {
  if (!nugetExtensionContext) {
    vscode.window.showErrorMessage('NuGet panel not initialized');
    return;
  }

  currentCsprojPath = csprojPath;
  const projectName = path.basename(csprojPath);

  if (currentNugetPanel) {
    currentNugetPanel.reveal(vscode.ViewColumn.One);
    currentNugetPanel.title = `NuGet: ${projectName}`;
    // Refresh the panel with new project
    await refreshPanel();
  } else {
    currentNugetPanel = vscode.window.createWebviewPanel(
      'nugetPackageManager',
      `NuGet: ${projectName}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(nugetExtensionContext.extensionPath, 'out')),
        ],
      },
    );

    currentNugetPanel.onDidDispose(() => {
      currentNugetPanel = undefined;
      currentCsprojPath = undefined;
    });

    currentNugetPanel.webview.onDidReceiveMessage(
      async message => {
        await handleWebviewMessage(message);
      },
      undefined,
      nugetExtensionContext.subscriptions,
    );

    await refreshPanel();
  }
}

/**
 * Refresh the panel content
 */
async function refreshPanel(): Promise<void> {
  if (!currentNugetPanel || !currentCsprojPath) {
    return;
  }

  const installedPackages = showAllPackages
    ? await getAllPackages(currentCsprojPath)
    : await getInstalledPackages(currentCsprojPath);
  const html = generateNugetHtml(installedPackages);
  currentNugetPanel.webview.html = html;
}

/**
 * Handle messages from the webview
 */
async function handleWebviewMessage(message: any): Promise<void> {
  if (!currentCsprojPath) {
    return;
  }

  switch (message.command) {
    case 'search':
      try {
        const results = await searchPackages(message.query, 0, 30);
        const installedPackages = showAllPackages
          ? await getAllPackages(currentCsprojPath)
          : await getInstalledPackages(currentCsprojPath);
        const installedMap = new Map(
          installedPackages.map((p: InstalledPackage) => [p.id.toLowerCase(), p.version]),
        );

        // Check which search results are installed in sibling projects
        const searchIds = results.map((r: NuGetSearchResult) => r.id);
        const crossRefs = await batchCrossProjectCheck(currentCsprojPath, searchIds);

        const enrichedResults = results.map((r: NuGetSearchResult) => {
          const refs = crossRefs.get(r.id.toLowerCase()) || [];
          return {
            ...r,
            isInstalled: installedMap.has(r.id.toLowerCase()),
            installedVersion: installedMap.get(r.id.toLowerCase()),
            crossProjectRefs: refs.map(ref => ({
              projectName: ref.projectName,
              version: ref.version,
            })),
          };
        });

        currentNugetPanel?.webview.postMessage({
          command: 'searchResults',
          results: enrichedResults,
        });
      } catch (error) {
        vscode.window.showErrorMessage(`Search failed: ${error}`);
      }
      break;

    case 'toggleAllPackages':
      showAllPackages = message.showAll;
      await refreshPanel();
      break;

    case 'getVersions':
      try {
        const versions = await getPackageVersions(message.packageId);
        currentNugetPanel?.webview.postMessage({
          command: 'versionsResult',
          packageId: message.packageId,
          versions: versions.reverse(), // Show latest first
        });
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to get versions: ${error}`);
      }
      break;

    case 'getDependencies':
      try {
        const metadata = await getPackageMetadata(message.packageId, message.version);
        currentNugetPanel?.webview.postMessage({
          command: 'dependenciesResult',
          packageId: message.packageId,
          version: message.version,
          dependencies: metadata.dependencies,
        });
      } catch (error) {
        console.error('Failed to get dependencies:', error);
        currentNugetPanel?.webview.postMessage({
          command: 'dependenciesResult',
          packageId: message.packageId,
          version: message.version,
          dependencies: [],
        });
      }
      break;

    case 'install':
      try {
        currentNugetPanel?.webview.postMessage({
          command: 'operationStarted',
          operation: 'install',
          packageId: message.packageId,
        });
        const success = await addPackageReference(
          currentCsprojPath,
          message.packageId,
          message.version,
        );
        if (success) {
          vscode.window.showInformationMessage(`Installed ${message.packageId} ${message.version}`);
          await refreshPanel();
        } else {
          vscode.window.showErrorMessage(`Failed to install ${message.packageId}`);
          currentNugetPanel?.webview.postMessage({
            command: 'operationFinished',
            packageId: message.packageId,
          });
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Installation failed: ${error}`);
        currentNugetPanel?.webview.postMessage({
          command: 'operationFinished',
          packageId: message.packageId,
        });
      }
      break;

    case 'uninstall':
      try {
        currentNugetPanel?.webview.postMessage({
          command: 'operationStarted',
          operation: 'uninstall',
          packageId: message.packageId,
        });
        const success = await removePackageReference(currentCsprojPath, message.packageId);
        if (success) {
          vscode.window.showInformationMessage(`Removed ${message.packageId}`);
          await refreshPanel();
        } else {
          vscode.window.showErrorMessage(`Failed to remove ${message.packageId}`);
          currentNugetPanel?.webview.postMessage({
            command: 'operationFinished',
            packageId: message.packageId,
          });
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Removal failed: ${error}`);
        currentNugetPanel?.webview.postMessage({
          command: 'operationFinished',
          packageId: message.packageId,
        });
      }
      break;

    case 'update':
      try {
        currentNugetPanel?.webview.postMessage({
          command: 'operationStarted',
          operation: 'update',
          packageId: message.packageId,
        });
        const success = await updatePackageReference(
          currentCsprojPath,
          message.packageId,
          message.version,
        );
        if (success) {
          vscode.window.showInformationMessage(
            `Updated ${message.packageId} to ${message.version}`,
          );
          await refreshPanel();
        } else {
          vscode.window.showErrorMessage(`Failed to update ${message.packageId}`);
          currentNugetPanel?.webview.postMessage({
            command: 'operationFinished',
            packageId: message.packageId,
          });
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Update failed: ${error}`);
        currentNugetPanel?.webview.postMessage({
          command: 'operationFinished',
          packageId: message.packageId,
        });
      }
      break;

    case 'crossProjectCheck':
      try {
        const refs = await getCrossProjectReferences(currentCsprojPath, message.packageId);
        currentNugetPanel?.webview.postMessage({
          command: 'crossProjectResult',
          packageId: message.packageId,
          references: refs.map(r => ({ projectName: r.projectName, version: r.version })),
        });
      } catch {
        currentNugetPanel?.webview.postMessage({
          command: 'crossProjectResult',
          packageId: message.packageId,
          references: [],
        });
      }
      break;
  }
}

/**
 * Generate the HTML content for the NuGet manager
 */
function generateNugetHtml(installedPackages: InstalledPackage[]): string {
  if (!nugetExtensionContext) {
    return '<html><body>Extension context not initialized</body></html>';
  }

  const templatePath = path.join(
    nugetExtensionContext.extensionPath,
    'out',
    'ui',
    'panels',
    'templates',
    'nugetManager.html',
  );

  try {
    let template = fs.readFileSync(templatePath, 'utf8');

    // Replace placeholders
    template = template.replace('{{INSTALLED_PACKAGES}}', JSON.stringify(installedPackages));

    return template;
  } catch (error) {
    console.error('Error loading NuGet template:', error);
    return '<html><body>Error loading template</body></html>';
  }
}
