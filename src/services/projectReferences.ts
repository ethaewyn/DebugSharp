/**
 * Project References Manager
 *
 * Quick-pick based UI for adding/removing ProjectReference entries
 * in .csproj files. Uses dotnet CLI for mutations (preserves formatting).
 * Detects transitive references so you don't add duplicates.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import * as vscode from 'vscode';

// ─── Types ───────────────────────────────────────────────────────────

interface ProjectRef {
  name: string;
  /** Include path as written in the csproj */
  includePath: string;
  /** Resolved absolute path on disk */
  absolutePath: string;
}

// ─── Reading ─────────────────────────────────────────────────────────

/**
 * Parse ProjectReference entries from a csproj file.
 */
function getProjectReferences(csprojPath: string): ProjectRef[] {
  try {
    const content = fs.readFileSync(csprojPath, 'utf8');
    const refs: ProjectRef[] = [];
    const regex = /<ProjectReference\s+Include="([^"]+)"/gi;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const includePath = match[1];
      const absolutePath = path.resolve(path.dirname(csprojPath), includePath);
      refs.push({
        name: path.basename(absolutePath, '.csproj'),
        includePath,
        absolutePath,
      });
    }
    return refs;
  } catch {
    return [];
  }
}

/**
 * Recursively collect all project references reachable from a csproj,
 * including transitive ones. Returns a set of normalised absolute paths.
 */
function getAllTransitiveRefs(csprojPath: string, visited = new Set<string>()): Set<string> {
  const norm = path.normalize(csprojPath).toLowerCase();
  if (visited.has(norm)) return visited;
  visited.add(norm);

  const refs = getProjectReferences(csprojPath);
  for (const ref of refs) {
    if (fs.existsSync(ref.absolutePath)) {
      getAllTransitiveRefs(ref.absolutePath, visited);
    }
  }
  return visited;
}

// ─── CLI helpers ─────────────────────────────────────────────────────

function runDotnet(args: string[], cwd: string): Promise<{ success: boolean; output: string }> {
  return new Promise(resolve => {
    const proc = cp.spawn('dotnet', args, { cwd, shell: true });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    proc.on('close', code => resolve({ success: code === 0, output: stdout + stderr }));
    proc.on('error', err => resolve({ success: false, output: err.message }));
  });
}

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
  const transitiveSet = getAllTransitiveRefs(csprojPath);

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
    const isTransitive = !isDirect && transitiveSet.has(norm);

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
      // Sort referenced items to the bottom
      kind: isDirect || isTransitive ? undefined : undefined,
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
      : transitiveSet.has(path.normalize(a.projectPath).toLowerCase())
        ? 1
        : 0;
    const bScore = directSet.has(path.normalize(b.projectPath).toLowerCase())
      ? 2
      : transitiveSet.has(path.normalize(b.projectPath).toLowerCase())
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
  if (transitiveSet.has(pickedNorm)) {
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
      const cwd = path.dirname(csprojPath);
      const result = await runDotnet(['add', csprojPath, 'reference', picked.projectPath], cwd);
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
  const dependents = findDependents(csprojPath, picked.ref, directRefs);
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
      const cwd = path.dirname(csprojPath);
      const result = await runDotnet(
        ['remove', csprojPath, 'reference', picked.ref.absolutePath],
        cwd,
      );
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
  const targetNorm = path.normalize(targetPath).toLowerCase();
  const directRefs = getProjectReferences(csprojPath);

  for (const ref of directRefs) {
    if (!fs.existsSync(ref.absolutePath)) continue;
    const reachable = getAllTransitiveRefs(ref.absolutePath);
    if (reachable.has(targetNorm)) {
      return ref.name;
    }
  }

  return 'another project';
}

/**
 * Check if any of the remaining direct refs (besides the one being removed)
 * transitively reference the same project.
 */
function findDependents(
  csprojPath: string,
  removing: ProjectRef,
  allDirect: ProjectRef[],
): string[] {
  const removingNorm = path.normalize(removing.absolutePath).toLowerCase();
  const dependents: string[] = [];

  for (const ref of allDirect) {
    if (path.normalize(ref.absolutePath).toLowerCase() === removingNorm) continue;
    if (!fs.existsSync(ref.absolutePath)) continue;

    const transitive = getAllTransitiveRefs(ref.absolutePath);
    if (transitive.has(removingNorm)) {
      dependents.push(ref.name);
    }
  }

  return dependents;
}
