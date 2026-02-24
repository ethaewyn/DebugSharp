/**
 * NuGet Manager
 *
 * Handles parsing .csproj files to read installed packages and
 * modifying package references using the dotnet CLI (preserves formatting).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import * as vscode from 'vscode';

export interface InstalledPackage {
  id: string;
  version: string;
  isTransitive?: boolean;
}

/** A sibling project that has a specific package installed */
export interface CrossProjectReference {
  projectName: string;
  projectPath: string;
  version: string;
}

/**
 * Parse a .csproj file and extract installed NuGet packages.
 * Uses regex to read PackageReference elements without modifying the file.
 */
export async function getInstalledPackages(csprojPath: string): Promise<InstalledPackage[]> {
  try {
    const content = fs.readFileSync(csprojPath, 'utf8');
    const packages: InstalledPackage[] = [];
    const foundIds = new Set<string>();

    // Match <PackageReference Include="..." Version="..." /> (self-closing or not)
    const attrRegex = /<PackageReference\s+Include="([^"]+)"\s+Version="([^"]+)"\s*\/?>/gi;
    let match;
    while ((match = attrRegex.exec(content)) !== null) {
      foundIds.add(match[1].toLowerCase());
      packages.push({ id: match[1], version: match[2] });
    }

    // Also match Version as a child element
    const childRegex =
      /<PackageReference\s+Include="([^"]+)"[^>]*>\s*<Version>([^<]+)<\/Version>/gi;
    while ((match = childRegex.exec(content)) !== null) {
      if (!foundIds.has(match[1].toLowerCase())) {
        packages.push({ id: match[1], version: match[2] });
      }
    }

    return packages;
  } catch (error) {
    console.error('Error reading .csproj file:', error);
    return [];
  }
}

/**
 * Get all packages including transitive dependencies from project.assets.json
 */
export async function getAllPackages(csprojPath: string): Promise<InstalledPackage[]> {
  const projectDir = path.dirname(csprojPath);
  const assetsPath = path.join(projectDir, 'obj', 'project.assets.json');

  try {
    const explicitPackages = await getInstalledPackages(csprojPath);
    const explicitSet = new Set(explicitPackages.map(p => p.id.toLowerCase()));

    if (!fs.existsSync(assetsPath)) {
      return explicitPackages;
    }

    const assetsContent = fs.readFileSync(assetsPath, 'utf8');
    const assets = JSON.parse(assetsContent);

    const allPackages: InstalledPackage[] = [...explicitPackages];

    const targets = assets.targets || {};
    const targetKeys = Object.keys(targets);

    if (targetKeys.length > 0) {
      const targetFramework = targetKeys[0];
      const pkgs = targets[targetFramework] || {};

      for (const [pkgKey, pkgData] of Object.entries(pkgs)) {
        const parts = pkgKey.split('/');
        if (parts.length === 2) {
          const [pkgId, pkgVersion] = parts;
          if (explicitSet.has(pkgId.toLowerCase()) || !pkgData) continue;

          const pkgInfo = pkgData as any;
          if (pkgInfo.type === 'package') {
            allPackages.push({
              id: pkgId,
              version: pkgVersion,
              isTransitive: true,
            });
          }
        }
      }
    }

    return allPackages;
  } catch (error) {
    console.error('Error reading project assets:', error);
    return getInstalledPackages(csprojPath);
  }
}

// ─── Cross-project awareness ─────────────────────────────────────────

/**
 * Find all .csproj files in the workspace (excluding the given one).
 */
async function findSiblingProjects(excludeCsprojPath: string): Promise<string[]> {
  const uris = await vscode.workspace.findFiles('**/*.csproj', '**/node_modules/**');
  const normalized = path.normalize(excludeCsprojPath).toLowerCase();
  return uris.map(u => u.fsPath).filter(p => path.normalize(p).toLowerCase() !== normalized);
}

/**
 * Check which other projects in the workspace have a specific package installed.
 */
export async function getCrossProjectReferences(
  currentCsprojPath: string,
  packageId: string,
): Promise<CrossProjectReference[]> {
  const siblings = await findSiblingProjects(currentCsprojPath);
  const refs: CrossProjectReference[] = [];

  for (const projPath of siblings) {
    try {
      const packages = await getInstalledPackages(projPath);
      const found = packages.find(p => p.id.toLowerCase() === packageId.toLowerCase());
      if (found) {
        refs.push({
          projectName: path.basename(projPath, '.csproj'),
          projectPath: projPath,
          version: found.version,
        });
      }
    } catch {
      // Skip unreadable projects
    }
  }

  return refs;
}

/**
 * Check which packages from a list are installed in other projects.
 * Returns a map of packageId (lowercase) → CrossProjectReference[].
 */
export async function batchCrossProjectCheck(
  currentCsprojPath: string,
  packageIds: string[],
): Promise<Map<string, CrossProjectReference[]>> {
  const result = new Map<string, CrossProjectReference[]>();
  if (packageIds.length === 0) return result;

  const siblings = await findSiblingProjects(currentCsprojPath);
  const lowerIds = new Set(packageIds.map(id => id.toLowerCase()));

  for (const projPath of siblings) {
    try {
      const packages = await getInstalledPackages(projPath);
      const projName = path.basename(projPath, '.csproj');

      for (const pkg of packages) {
        const key = pkg.id.toLowerCase();
        if (lowerIds.has(key)) {
          if (!result.has(key)) result.set(key, []);
          result.get(key)!.push({
            projectName: projName,
            projectPath: projPath,
            version: pkg.version,
          });
        }
      }
    } catch {
      // Skip unreadable projects
    }
  }

  return result;
}

// ─── CLI-based mutations (preserve csproj formatting) ────────────────

/**
 * Run a dotnet CLI command and return { success, output }.
 */
function runDotnet(args: string[], cwd: string): Promise<{ success: boolean; output: string }> {
  return new Promise(resolve => {
    const proc = cp.spawn('dotnet', args, { cwd, shell: true });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on('data', (d: Buffer) => (stderr += d.toString()));

    proc.on('close', code => {
      resolve({
        success: code === 0,
        output: stdout + stderr,
      });
    });

    proc.on('error', err => {
      resolve({ success: false, output: err.message });
    });
  });
}

/**
 * Add or update a package reference using `dotnet add package`.
 * Preserves existing csproj formatting.
 */
export async function addPackageReference(
  csprojPath: string,
  packageId: string,
  version: string,
): Promise<boolean> {
  const cwd = path.dirname(csprojPath);
  const result = await runDotnet(
    ['add', csprojPath, 'package', packageId, '--version', version],
    cwd,
  );

  if (!result.success) {
    console.error('dotnet add package failed:', result.output);
  }
  return result.success;
}

/**
 * Remove a package reference using `dotnet remove package`.
 * Preserves existing csproj formatting.
 */
export async function removePackageReference(
  csprojPath: string,
  packageId: string,
): Promise<boolean> {
  const cwd = path.dirname(csprojPath);
  const result = await runDotnet(['remove', csprojPath, 'package', packageId], cwd);

  if (!result.success) {
    console.error('dotnet remove package failed:', result.output);
  }
  return result.success;
}

/**
 * Update a package reference version.
 */
export async function updatePackageReference(
  csprojPath: string,
  packageId: string,
  newVersion: string,
): Promise<boolean> {
  return addPackageReference(csprojPath, packageId, newVersion);
}
