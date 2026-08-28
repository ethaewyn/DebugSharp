/**
 * Project Index
 *
 * Single source of truth for discovering and analyzing C# projects and
 * solutions in the workspace. Results are cached and invalidated by a
 * file watcher, so pickers don't re-parse every .csproj on each invocation.
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface ProjectInfo {
  name: string;
  path: string;
  outputType: 'exe' | 'library' | 'web';
  targetFramework: string;
  isWeb: boolean;
  isTest: boolean;
  hasLaunchSettings: boolean;
  launchProfiles?: any;
  assemblyName?: string;
}

export interface SolutionInfo {
  name: string;
  path: string;
  projectCount: number;
}

export type BuildableItem = ProjectInfo | SolutionInfo;

export function isSolution(item: BuildableItem): item is SolutionInfo {
  return 'projectCount' in item;
}

/** Which subset of projects a caller needs */
export type ProjectFilter = 'all' | 'runnable' | 'test';

// ─── Cache ───────────────────────────────────────────────────────────

let projectCache: Promise<ProjectInfo[]> | undefined;
let solutionCache: Promise<SolutionInfo[]> | undefined;

/**
 * Drop the cached scan. Safe to call repeatedly — callers that react to
 * project file changes should call this first rather than relying on the
 * watcher below having fired already.
 */
export function invalidateProjectIndex(): void {
  projectCache = undefined;
  solutionCache = undefined;
  graphCache.clear();
}

/**
 * Set up cache invalidation. Call once during activation.
 */
export function initializeProjectIndex(context: vscode.ExtensionContext): void {
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.{csproj,sln,slnx,slnf}');
  watcher.onDidCreate(invalidateProjectIndex);
  watcher.onDidChange(invalidateProjectIndex);
  watcher.onDidDelete(invalidateProjectIndex);
  context.subscriptions.push(watcher);
}

// ─── Queries ─────────────────────────────────────────────────────────

/**
 * Get all workspace projects matching a filter.
 */
export async function getProjects(filter: ProjectFilter = 'all'): Promise<ProjectInfo[]> {
  if (!projectCache) {
    projectCache = loadProjects();
  }

  const projects = await projectCache;

  switch (filter) {
    case 'runnable':
      return projects.filter(p => p.outputType === 'exe');
    case 'test':
      return projects.filter(p => p.isTest);
    default:
      return projects;
  }
}

/**
 * Get all workspace solution files (.sln, .slnx, .slnf).
 */
export async function getSolutions(): Promise<SolutionInfo[]> {
  if (!solutionCache) {
    solutionCache = loadSolutions();
  }
  return solutionCache;
}

/**
 * Find the runnable project that contains a given file.
 * Picks the deepest (most specific) match.
 */
export async function findProjectForFile(fsPath: string): Promise<ProjectInfo | undefined> {
  const projects = await getProjects('runnable');

  let bestMatch: ProjectInfo | undefined;
  let bestDepth = -1;

  for (const project of projects) {
    const projectDir = path.dirname(project.path);
    if (fsPath.startsWith(projectDir + path.sep) || fsPath.startsWith(projectDir + '/')) {
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
 * Detect a test project from its .csproj contents.
 */
export function isTestProject(csprojContent: string): boolean {
  return (
    csprojContent.includes('Microsoft.NET.Test.Sdk') ||
    csprojContent.includes('xunit') ||
    csprojContent.includes('NUnit') ||
    csprojContent.includes('nunit') ||
    csprojContent.includes('MSTest') ||
    csprojContent.includes('MSTest.TestFramework') ||
    csprojContent.includes('MSTest.TestAdapter')
  );
}

// ─── Loading ─────────────────────────────────────────────────────────

async function loadProjects(): Promise<ProjectInfo[]> {
  const csprojFiles = await vscode.workspace.findFiles('**/*.csproj', '**/node_modules/**');
  const projects: ProjectInfo[] = [];

  for (const uri of csprojFiles) {
    const info = analyzeProject(uri.fsPath);
    if (info) {
      projects.push(info);
    }
  }

  return projects;
}

/**
 * Analyze a .csproj file to determine project type and configuration.
 */
function analyzeProject(projectPath: string): ProjectInfo | null {
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
      } catch {
        // Failed to parse launchSettings.json, continue without profiles
      }
    }

    return {
      name: projectName,
      path: projectPath,
      outputType,
      targetFramework,
      isWeb,
      isTest: isTestProject(content),
      hasLaunchSettings,
      launchProfiles,
      assemblyName,
    };
  } catch {
    return null;
  }
}

async function loadSolutions(): Promise<SolutionInfo[]> {
  const slnFiles = await vscode.workspace.findFiles('**/*.{sln,slnx,slnf}', '**/node_modules/**');
  const solutions: SolutionInfo[] = [];

  for (const uri of slnFiles) {
    const solutionPath = uri.fsPath;
    const ext = path.extname(solutionPath);

    try {
      solutions.push({
        name: path.basename(solutionPath, ext),
        path: solutionPath,
        projectCount: readSolutionProjectPaths(solutionPath).length,
      });
    } catch {
      // Skip if we can't read the solution file
    }
  }

  return solutions;
}

/**
 * Read the absolute paths of the projects declared in a solution file.
 * Each solution format stores its project list differently.
 */
function readSolutionProjectPaths(solutionPath: string): string[] {
  const content = fs.readFileSync(solutionPath, 'utf8');
  const ext = path.extname(solutionPath);
  const relativePaths: string[] = [];

  // Paths are relative to the solution itself, except in a .slnf filter where
  // they are relative to the .sln the filter points at.
  let baseDir = path.dirname(solutionPath);

  if (ext === '.sln') {
    // Project("{TypeGuid}") = "Name", "Rel\Path.csproj", "{ProjectGuid}"
    const regex = /Project\("{[^}]+}"\)\s*=\s*"[^"]*",\s*"([^"]+)"/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      relativePaths.push(match[1]);
    }
  } else if (ext === '.slnx') {
    // XML-based solution format
    const regex = /<Project\s+Path="([^"]+)"/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      relativePaths.push(match[1]);
    }
  } else if (ext === '.slnf') {
    // Solution filter is JSON format
    const filter = JSON.parse(content);
    const referencedSln = filter.solution?.path;
    if (typeof referencedSln === 'string') {
      baseDir = path.dirname(path.resolve(baseDir, referencedSln.replace(/\\/g, path.sep)));
    }
    for (const p of filter.solution?.projects ?? []) {
      if (typeof p === 'string') relativePaths.push(p);
    }
  }

  return relativePaths
    .filter(p => p.toLowerCase().endsWith('.csproj')) // skip solution folders
    .map(p => path.resolve(baseDir, p.replace(/\\/g, path.sep)));
}

/**
 * Get the analyzed projects belonging to a solution.
 * Returns an empty array if the solution can't be read or names no projects.
 */
export async function getSolutionProjects(solution: SolutionInfo): Promise<ProjectInfo[]> {
  let memberPaths: string[];
  try {
    memberPaths = readSolutionProjectPaths(solution.path);
  } catch {
    return [];
  }

  const byPath = new Map(
    (await getProjects()).map(p => [path.normalize(p.path).toLowerCase(), p] as const),
  );

  const members: ProjectInfo[] = [];
  for (const memberPath of memberPaths) {
    const found = byPath.get(path.normalize(memberPath).toLowerCase());
    if (found) members.push(found);
  }

  return members;
}

// ─── Project reference graph ─────────────────────────────────────────

export interface ProjectRef {
  name: string;
  /** Include path as written in the csproj */
  includePath: string;
  /** Resolved absolute path on disk */
  absolutePath: string;
}

/**
 * Parse ProjectReference entries from a csproj file.
 */
export function getProjectReferences(csprojPath: string): ProjectRef[] {
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
 * A project and everything it references, transitively.
 *
 * `paths` keeps real casing so entries stay usable for filesystem calls on
 * case-sensitive platforms; `has` compares case-insensitively for Windows.
 */
export interface ProjectGraph {
  readonly paths: readonly string[];
  has(csprojPath: string): boolean;
}

/**
 * Reference closures, keyed by project. Cleared with the rest of the index.
 *
 * Caching matters more than it looks: a solution-wide up-to-date check asks for
 * every member's closure, and in a layered solution those closures overlap
 * almost entirely. Recomputing each from scratch made a 200-project check take
 * ~23s — slower than the build it exists to avoid.
 */
const graphCache = new Map<string, Map<string, string>>();

function graphKey(csprojPath: string): string {
  return path.normalize(csprojPath).toLowerCase();
}

/**
 * Collect the project and everything it references, transitively.
 *
 * Closures are composed from those of the referenced projects rather than
 * re-walked, so each project in a solution is visited once overall.
 */
export function getProjectGraph(csprojPath: string): ProjectGraph {
  const entries = collectGraph(csprojPath, new Set());

  return {
    paths: [...entries.values()],
    has: (candidate: string) => entries.has(graphKey(candidate)),
  };
}

/** normalised key → real-cased path */
function collectGraph(csprojPath: string, inProgress: Set<string>): Map<string, string> {
  const key = graphKey(csprojPath);

  const cached = graphCache.get(key);
  if (cached) return cached;

  // Back-edge of a reference cycle. MSBuild rejects these, but we must not hang.
  if (inProgress.has(key)) return new Map();

  inProgress.add(key);

  const entries = new Map<string, string>([[key, path.normalize(csprojPath)]]);
  for (const ref of getProjectReferences(csprojPath)) {
    if (!fs.existsSync(ref.absolutePath)) continue;
    for (const [refKey, refPath] of collectGraph(ref.absolutePath, inProgress)) {
      entries.set(refKey, refPath);
    }
  }

  inProgress.delete(key);
  graphCache.set(key, entries);
  return entries;
}
