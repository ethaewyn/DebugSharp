/**
 * Build Up-To-Date Check
 *
 * Decides whether a project's compiled output is newer than every input that
 * could affect it, so an unchanged project can skip `dotnet build` entirely.
 *
 * MSBuild performs its own incremental check, but only after the ~1-2s cost of
 * starting up and evaluating the project graph. This check answers the same
 * question with a stat walk, which is what makes repeated runs feel instant.
 *
 * It deliberately errs towards "stale": anything unreadable, missing, or
 * ambiguous means we build. A needless build costs seconds; a wrongly skipped
 * build runs the user's old code.
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
  BuildableItem,
  ProjectInfo,
  isSolution,
  getSolutionProjects,
  getProjectGraph,
} from '../shared/projectIndex';
import { BUILD_CONFIGURATION } from './constants';
import { EVAL_FILE_NAME } from '../eval/scaffold';

/** Directories that hold build artifacts, not build inputs */
const IGNORED_DIRS = new Set(['bin', 'obj', 'node_modules', '.git', '.vs', '.vscode']);

/**
 * Files that are outputs of the debugger, not inputs to the build.
 * The eval scaffold is rewritten on every breakpoint hit, so treating it as an
 * input would make its project permanently stale.
 */
const IGNORED_FILES = new Set([EVAL_FILE_NAME]);

/** Build-affecting files that live above the project directory */
const SHARED_BUILD_FILES = [
  'Directory.Build.props',
  'Directory.Build.targets',
  'Directory.Packages.props',
  'global.json',
  'NuGet.config',
  'nuget.config',
];

/**
 * Newest input mtime per project, reused across a single up-to-date query so
 * that a library shared by many projects in a solution is only walked once.
 */
type InputMemo = Map<string, number>;

/**
 * Whether the user has the up-to-date check enabled.
 */
export function skipUnchangedBuildsEnabled(): boolean {
  return vscode.workspace.getConfiguration('debugSharp').get<boolean>('skipUnchangedBuilds', true);
}

/**
 * Locate a project's compiled assembly for the active build configuration.
 *
 * Only ever looks under `bin/<Configuration>` — a Release build sitting on disk
 * must not make a stale Debug output look current, or vice versa. Switching
 * configuration to one that was never built therefore reads as stale, which is
 * exactly right.
 */
export function findOutputAssembly(project: ProjectInfo): string | undefined {
  const configDir = path.join(path.dirname(project.path), 'bin', BUILD_CONFIGURATION);
  const dllName = `${project.assemblyName || project.name}.dll`;

  let newest: { path: string; mtime: number } | undefined;

  // <config>/<tfm>[/<rid>]/<Assembly>.dll
  for (const tfmDir of listDirs(configDir)) {
    for (const candidateDir of [tfmDir, ...listDirs(tfmDir)]) {
      const candidate = path.join(candidateDir, dllName);
      const mtime = mtimeOf(candidate);
      if (mtime !== undefined && (!newest || mtime > newest.mtime)) {
        newest = { path: candidate, mtime };
      }
    }
  }

  return newest?.path;
}

/**
 * Is this project or solution up to date with respect to its sources?
 */
export async function isUpToDate(item: BuildableItem): Promise<boolean> {
  const memo: InputMemo = new Map();

  if (isSolution(item)) {
    const members = await getSolutionProjects(item);

    // Only trust the answer when every project the solution names resolved to
    // one we've analyzed — a project outside the workspace would go unchecked.
    if (members.length === 0 || members.length !== item.projectCount) {
      return false;
    }

    for (const member of members) {
      if (!isProjectUpToDate(member, memo)) return false;
    }
    return true;
  }

  return isProjectUpToDate(item, memo);
}

/**
 * Is a single project's output newer than every input that feeds it?
 */
function isProjectUpToDate(project: ProjectInfo, memo: InputMemo): boolean {
  const output = findOutputAssembly(project);
  if (!output) return false;

  const outputMtime = mtimeOf(output);
  if (outputMtime === undefined) return false;

  // The project plus everything it references, transitively
  for (const csprojPath of getProjectGraph(project.path).paths) {
    if (newestInputMtime(csprojPath, memo) > outputMtime) return false;
  }

  return true;
}

/**
 * The most recent modification time across every input belonging to one
 * project. Returns Infinity when the project can't be read, which forces a
 * build.
 */
function newestInputMtime(csprojPath: string, memo: InputMemo): number {
  const key = path.normalize(csprojPath).toLowerCase();
  const cached = memo.get(key);
  if (cached !== undefined) return cached;

  const projectDir = path.dirname(csprojPath);

  let newest = newestInTree(projectDir);

  // The restore marker lives under obj/, which the source walk skips
  newest = Math.max(newest, mtimeOf(path.join(projectDir, 'obj', 'project.assets.json')) ?? 0);
  newest = Math.max(newest, newestSharedBuildFile(projectDir));

  memo.set(key, newest);
  return newest;
}

/**
 * Directory.Build.props and friends apply to every project beneath them, so
 * walk up to the workspace root collecting them.
 */
function newestSharedBuildFile(projectDir: string): number {
  const workspaceRoot = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(projectDir))?.uri
    .fsPath;
  const stopAt = workspaceRoot ? path.normalize(workspaceRoot) : undefined;

  let dir = path.normalize(projectDir);
  let newest = 0;

  for (;;) {
    for (const fileName of SHARED_BUILD_FILES) {
      newest = Math.max(newest, mtimeOf(path.join(dir, fileName)) ?? 0);
    }

    if (stopAt && dir === stopAt) break;
    const parent = path.dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }

  return newest;
}

/**
 * Newest modification time in a project's source tree. Everything that isn't a
 * build artifact counts as an input — .resx, .json and content files all affect
 * the result.
 *
 * Directory timestamps count too, and they carry the changes file timestamps
 * can't: deleting, renaming or moving a source leaves every remaining file's
 * mtime untouched (a rename even preserves the moved file's own mtime), but it
 * always bumps the mtime of the directory that gained or lost the entry.
 */
function newestInTree(dir: string): number {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return Infinity; // Can't read it, so can't rule out a change
  }

  let newest = mtimeOf(dir) ?? 0;

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name.toLowerCase())) continue;
      newest = Math.max(newest, newestInTree(fullPath));
      continue;
    }

    if (!entry.isFile() || IGNORED_FILES.has(entry.name)) continue;

    newest = Math.max(newest, mtimeOf(fullPath) ?? 0);
  }

  return newest;
}

// ─── fs helpers ──────────────────────────────────────────────────────

function mtimeOf(filePath: string): number | undefined {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return undefined;
  }
}

function listDirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => path.join(dir, e.name));
  } catch {
    return [];
  }
}
