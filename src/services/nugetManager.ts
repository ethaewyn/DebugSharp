/**
 * NuGet Manager
 *
 * Handles parsing .csproj files to read installed packages and
 * modifying package references (add, remove, update).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as xml2js from 'xml2js';

export interface InstalledPackage {
  id: string;
  version: string;
  isTransitive?: boolean;
}

/**
 * Parse a .csproj file and extract installed NuGet packages
 * @param csprojPath Path to the .csproj file
 */
export async function getInstalledPackages(csprojPath: string): Promise<InstalledPackage[]> {
  try {
    const content = fs.readFileSync(csprojPath, 'utf8');
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(content);

    const packages: InstalledPackage[] = [];
    const project = result.Project;

    if (!project) {
      return packages;
    }

    // Look for PackageReference elements in ItemGroup
    const itemGroups = project.ItemGroup || [];
    for (const itemGroup of itemGroups) {
      const packageReferences = itemGroup.PackageReference || [];
      for (const pkgRef of packageReferences) {
        const attrs = pkgRef.$;
        if (attrs && attrs.Include) {
          packages.push({
            id: attrs.Include,
            version: attrs.Version || 'Unknown',
          });
        }
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
 * @param csprojPath Path to the .csproj file
 */
export async function getAllPackages(csprojPath: string): Promise<InstalledPackage[]> {
  const projectDir = path.dirname(csprojPath);
  const assetsPath = path.join(projectDir, 'obj', 'project.assets.json');

  try {
    // First get explicit packages
    const explicitPackages = await getInstalledPackages(csprojPath);
    const explicitSet = new Set(explicitPackages.map(p => p.id.toLowerCase()));

    // Try to read project.assets.json for transitive dependencies
    if (!fs.existsSync(assetsPath)) {
      return explicitPackages;
    }

    const assetsContent = fs.readFileSync(assetsPath, 'utf8');
    const assets = JSON.parse(assetsContent);

    const allPackages: InstalledPackage[] = [...explicitPackages];

    // Get all libraries/packages from targets
    const targets = assets.targets || {};
    const targetKeys = Object.keys(targets);

    if (targetKeys.length > 0) {
      const targetFramework = targetKeys[0];
      const packages = targets[targetFramework] || {};

      for (const [pkgKey, pkgData] of Object.entries(packages)) {
        // Format is "PackageName/Version"
        const parts = pkgKey.split('/');
        if (parts.length === 2) {
          const [pkgId, pkgVersion] = parts;

          // Skip if it's an explicit package or not a package (e.g., project reference)
          if (explicitSet.has(pkgId.toLowerCase()) || !pkgData) {
            continue;
          }

          // Check if it's actually a package (has type: "package")
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
    // Fall back to explicit packages only
    return getInstalledPackages(csprojPath);
  }
}

/**
 * Add a package reference to a .csproj file
 * @param csprojPath Path to the .csproj file
 * @param packageId Package ID to add
 * @param version Version to install
 */
export async function addPackageReference(
  csprojPath: string,
  packageId: string,
  version: string,
): Promise<boolean> {
  try {
    const content = fs.readFileSync(csprojPath, 'utf8');
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(content);

    const project = result.Project;
    if (!project) {
      return false;
    }

    // Ensure ItemGroup exists
    if (!project.ItemGroup) {
      project.ItemGroup = [];
    }

    // Find or create an ItemGroup for PackageReferences
    let packageItemGroup = project.ItemGroup.find((ig: any) => ig.PackageReference);
    if (!packageItemGroup) {
      packageItemGroup = { PackageReference: [] };
      project.ItemGroup.push(packageItemGroup);
    }

    if (!packageItemGroup.PackageReference) {
      packageItemGroup.PackageReference = [];
    }

    // Check if package already exists
    const existingPkg = packageItemGroup.PackageReference.find(
      (pkg: any) => pkg.$ && pkg.$.Include === packageId,
    );

    if (existingPkg) {
      // Update existing package version
      existingPkg.$.Version = version;
    } else {
      // Add new package reference
      packageItemGroup.PackageReference.push({
        $: {
          Include: packageId,
          Version: version,
        },
      });
    }

    // Build XML back
    const builder = new xml2js.Builder({
      xmldec: { version: '1.0', encoding: 'UTF-8' },
    });
    const xml = builder.buildObject(result);

    // Write back to file
    fs.writeFileSync(csprojPath, xml, 'utf8');
    return true;
  } catch (error) {
    console.error('Error adding package reference:', error);
    return false;
  }
}

/**
 * Remove a package reference from a .csproj file
 * @param csprojPath Path to the .csproj file
 * @param packageId Package ID to remove
 */
export async function removePackageReference(
  csprojPath: string,
  packageId: string,
): Promise<boolean> {
  try {
    const content = fs.readFileSync(csprojPath, 'utf8');
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(content);

    const project = result.Project;
    if (!project || !project.ItemGroup) {
      return false;
    }

    let removed = false;

    // Iterate through ItemGroups and remove the package
    for (const itemGroup of project.ItemGroup) {
      if (itemGroup.PackageReference) {
        const initialLength = itemGroup.PackageReference.length;
        itemGroup.PackageReference = itemGroup.PackageReference.filter(
          (pkg: any) => !(pkg.$ && pkg.$.Include === packageId),
        );
        if (itemGroup.PackageReference.length < initialLength) {
          removed = true;
        }
      }
    }

    if (!removed) {
      return false;
    }

    // Build XML back
    const builder = new xml2js.Builder({
      xmldec: { version: '1.0', encoding: 'UTF-8' },
    });
    const xml = builder.buildObject(result);

    // Write back to file
    fs.writeFileSync(csprojPath, xml, 'utf8');
    return true;
  } catch (error) {
    console.error('Error removing package reference:', error);
    return false;
  }
}

/**
 * Update a package reference version in a .csproj file
 * @param csprojPath Path to the .csproj file
 * @param packageId Package ID to update
 * @param newVersion New version to set
 */
export async function updatePackageReference(
  csprojPath: string,
  packageId: string,
  newVersion: string,
): Promise<boolean> {
  // For update, we can reuse addPackageReference which handles both add and update
  return addPackageReference(csprojPath, packageId, newVersion);
}
