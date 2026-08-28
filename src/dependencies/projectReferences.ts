/**
 * Project References Manager
 *
 * Quick-pick based UI for adding/removing ProjectReference entries
 * in .csproj files. Uses dotnet CLI for mutations (preserves formatting).
 * Detects transitive references so you don't add duplicates.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { runDotnet } from '../shared/dotnet';
import { getProjectReferences, getProjectGraph, ProjectRef } from '../shared/projectIndex';

// ─── Commands ────────────────────────────────────────────────────────

/**
 * Show a quick-pick to add a project reference.
 * - Lists all workspace csproj files (excluding the target itself)
 * - Marks already-referenced projects (direct + transitive)
 * - Prevents duplicates
 */
export async function addProjectReferenceCommand(csprojUri: vscode.Uri): Promise<void> {
  const csprojPath = csprojUri.fsPath;
  const projectName = path.basename(csprojPath, '.csproj');

  // Find all csproj files in workspace
  const allUris = await vscode.workspace.findFiles('**/*.csproj', '**/node_modules/**');
  const selfNorm = path.normalize(csprojPath).toLowerCase();

  // Gather direct refs and all transitive refs
  const directRefs = getProjectReferences(csprojPath);
  const directSet = new Set(directRefs.map(r => path.normalize(r.absolutePath).toLowerCase()));
  const transitiveGraph = getProjectGraph(csprojPath);

  // Build quick-pick items
  type RefItem = vscode.QuickPickItem & { projectPath: string };

  const items: RefItem[] = [];
  for (const uri of allUris) {
    const absPath = uri.fsPath;
    const norm = path.normalize(absPath).toLowerCase();
    if (norm === selfNorm) continue;

    const name = path.basename(absPath, '.csproj');
    const rel = path.relative(path.dirname(csprojPath), absPath);

    const isDirect = directSet.has(norm);
    const isTransitive = !isDirect && transitiveGraph.has(absPath);

    let description = rel;
    if (isDirect) {
      description = `$(check) Already referenced — ${rel}`;
    } else if (isTransitive) {
      // Find which direct ref transitively brings this in
      const via = findTransitiveSource(csprojPath, absPath);
      description = `$(link) Transitive via ${via} — ${rel}`;
    }

    items.push({
      label: name,
      description,
      projectPath: absPath,
    });
  }

  if (items.length === 0) {
    vscode.window.showInformationMessage('No other projects found in workspace');
    return;
  }

  // Sort: available first, then transitive, then direct
  items.sort((a, b) => {
    const aScore = directSet.has(path.normalize(a.projectPath).toLowerCase())
      ? 2
      : transitiveGraph.has(a.projectPath)
        ? 1
        : 0;
    const bScore = directSet.has(path.normalize(b.projectPath).toLowerCase())
      ? 2
      : transitiveGraph.has(b.projectPath)
        ? 1
        : 0;
    if (aScore !== bScore) return aScore - bScore;
    return a.label.localeCompare(b.label);
  });

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: `Add project reference to ${projectName}`,
    matchOnDescription: true,
  });

  if (!picked) return;

  const pickedNorm = path.normalize(picked.projectPath).toLowerCase();

  // Check for duplicate (direct)
  if (directSet.has(pickedNorm)) {
    vscode.window.showWarningMessage(
      `${picked.label} is already directly referenced by ${projectName}`,
    );
    return;
  }

  // Warn about transitive — let user decide
  if (transitiveGraph.has(picked.projectPath)) {
    const via = findTransitiveSource(csprojPath, picked.projectPath);
    const choice = await vscode.window.showWarningMessage(
      `${picked.label} is already transitively referenced via ${via}. Add a direct reference anyway?`,
      'Add Anyway',
      'Cancel',
    );
    if (choice !== 'Add Anyway') return;
  }

  // Add it
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Adding reference to ${picked.label}...`,
    },
    async () => {
      const result = await runDotnet(['add', csprojPath, 'reference', picked.projectPath], {
        cwd: path.dirname(csprojPath),
      });
      if (result.success) {
        vscode.window.showInformationMessage(`Added reference to ${picked.label}`);
      } else if (result.output.toLowerCase().includes('already')) {
        vscode.window.showWarningMessage(`${picked.label} is already referenced`);
      } else {
        vscode.window.showErrorMessage(`Failed to add reference: ${result.output}`);
      }
    },
  );
}

/**
 * Show a quick-pick to remove a project reference.
 * - Lists only direct ProjectReference entries
 * - Warns if other direct refs depend on it transitively
 */
export async function removeProjectReferenceCommand(csprojUri: vscode.Uri): Promise<void> {
  const csprojPath = csprojUri.fsPath;
  const projectName = path.basename(csprojPath, '.csproj');

  const directRefs = getProjectReferences(csprojPath);

  if (directRefs.length === 0) {
    vscode.window.showInformationMessage(`${projectName} has no project references`);
    return;
  }

  type RefItem = vscode.QuickPickItem & { ref: ProjectRef };

  const items: RefItem[] = directRefs.map(ref => ({
    label: ref.name,
    description: ref.includePath,
    ref,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: `Remove project reference from ${projectName}`,
    matchOnDescription: true,
  });

  if (!picked) return;

  // Check if any remaining direct ref transitively depends on the one being removed
  const dependents = findDependents(picked.ref, directRefs);
  if (dependents.length > 0) {
    const names = dependents.join(', ');
    const choice = await vscode.window.showWarningMessage(
      `Note: ${names} also reference${dependents.length === 1 ? 's' : ''} ${picked.label}, so it will remain transitively available. Remove the direct reference?`,
      'Remove',
      'Cancel',
    );
    if (choice !== 'Remove') return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Removing reference to ${picked.label}...`,
    },
    async () => {
      const result = await runDotnet(['remove', csprojPath, 'reference', picked.ref.absolutePath], {
        cwd: path.dirname(csprojPath),
      });
      if (result.success) {
        vscode.window.showInformationMessage(`Removed reference to ${picked.label}`);
      } else {
        vscode.window.showErrorMessage(`Failed to remove reference: ${result.output}`);
      }
    },
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Find which direct reference of `csprojPath` transitively brings in `targetPath`.
 * Returns the project name, or 'another project' as fallback.
 */
function findTransitiveSource(csprojPath: string, targetPath: string): string {
  const directRefs = getProjectReferences(csprojPath);

  for (const ref of directRefs) {
    if (!fs.existsSync(ref.absolutePath)) continue;
    if (getProjectGraph(ref.absolutePath).has(targetPath)) {
      return ref.name;
    }
  }

  return 'another project';
}

/**
 * Check if any of the remaining direct refs (besides the one being removed)
 * transitively reference the same project.
 */
function findDependents(removing: ProjectRef, allDirect: ProjectRef[]): string[] {
  const removingNorm = path.normalize(removing.absolutePath).toLowerCase();
  const dependents: string[] = [];

  for (const ref of allDirect) {
    if (path.normalize(ref.absolutePath).toLowerCase() === removingNorm) continue;
    if (!fs.existsSync(ref.absolutePath)) continue;

    if (getProjectGraph(ref.absolutePath).has(removing.absolutePath)) {
      dependents.push(ref.name);
    }
  }

  return dependents;
}
