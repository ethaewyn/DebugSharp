/**
 * NuGet Service
 *
 * Handles interactions with the NuGet API for searching packages,
 * retrieving package details, versions, and dependencies.
 */
import * as https from 'https';

export interface NuGetPackage {
  id: string;
  version: string;
  description: string;
  authors: string[];
  totalDownloads: number;
  versions: string[];
  iconUrl?: string;
  projectUrl?: string;
  licenseUrl?: string;
}

export interface NuGetSearchResult {
  id: string;
  version: string;
  description: string;
  authors: string;
  totalDownloads: number;
  iconUrl?: string;
  versions?: string[];
}

export interface PackageVersion {
  version: string;
  dependencies: PackageDependency[];
}

export interface PackageDependency {
  id: string;
  version: string;
  targetFramework?: string;
}

const NUGET_API_BASE = 'api.nuget.org';
const SERVICE_INDEX = '/v3/index.json';

/**
 * Fetch the NuGet service index to get API endpoints
 */
async function getServiceIndex(): Promise<any> {
  return new Promise((resolve, reject) => {
    https
      .get(`https://${NUGET_API_BASE}${SERVICE_INDEX}`, res => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(error);
          }
        });
      })
      .on('error', reject);
  });
}

let searchQueryServiceUrl: string | undefined;
let packageBaseAddressUrl: string | undefined;

/**
 * Initialize service endpoints
 */
async function initializeEndpoints(): Promise<void> {
  if (searchQueryServiceUrl && packageBaseAddressUrl) {
    return;
  }

  const serviceIndex = await getServiceIndex();
  const resources = serviceIndex.resources;

  searchQueryServiceUrl = resources.find((r: any) => r['@type'] === 'SearchQueryService')?.['@id'];

  packageBaseAddressUrl = resources.find((r: any) => r['@type'] === 'PackageBaseAddress/3.0.0')?.[
    '@id'
  ];
}

/**
 * Make an HTTPS GET request
 */
function httpsGet(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https
      .get(url, res => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(error);
          }
        });
      })
      .on('error', reject);
  });
}

/**
 * Search for NuGet packages
 * @param query Search query string
 * @param skip Number of results to skip (for pagination)
 * @param take Number of results to take (default: 20)
 */
export async function searchPackages(
  query: string,
  skip: number = 0,
  take: number = 20,
): Promise<NuGetSearchResult[]> {
  await initializeEndpoints();

  if (!searchQueryServiceUrl) {
    throw new Error('Search service URL not found');
  }

  const url = `${searchQueryServiceUrl}?q=${encodeURIComponent(query)}&skip=${skip}&take=${take}&prerelease=false`;
  const result = await httpsGet(url);

  return result.data.map((pkg: any) => ({
    id: pkg.id,
    version: pkg.version,
    description: pkg.description || '',
    authors: pkg.authors || '',
    totalDownloads: pkg.totalDownloads || 0,
    iconUrl: pkg.iconUrl,
    versions: pkg.versions?.map((v: any) => v.version) || [],
  }));
}

/**
 * Get all versions for a package
 * @param packageId The package ID
 */
export async function getPackageVersions(packageId: string): Promise<string[]> {
  await initializeEndpoints();

  if (!packageBaseAddressUrl) {
    throw new Error('Package base address URL not found');
  }

  const url = `${packageBaseAddressUrl}${packageId.toLowerCase()}/index.json`;
  const result = await httpsGet(url);

  return result.versions || [];
}

/**
 * Get package metadata including dependencies for a specific version
 * @param packageId The package ID
 * @param version The version string
 */
export async function getPackageMetadata(
  packageId: string,
  version: string,
): Promise<PackageVersion> {
  try {
    // First get the registration entry which contains the catalogEntry URL
    const registrationUrl = `https://api.nuget.org/v3/registration5-semver1/${packageId.toLowerCase()}/${version.toLowerCase()}.json`;
    const registrationResult = await httpsGet(registrationUrl);

    // Get the catalogEntry URL
    const catalogEntryUrl = registrationResult.catalogEntry;
    if (!catalogEntryUrl || typeof catalogEntryUrl !== 'string') {
      return {
        version: version,
        dependencies: [],
      };
    }

    // Fetch the actual catalog entry which has the dependency information
    const catalogEntry = await httpsGet(catalogEntryUrl);
    const dependencyGroups = catalogEntry.dependencyGroups || [];

    const dependencies: PackageDependency[] = [];
    for (const group of dependencyGroups) {
      const targetFramework = group.targetFramework;
      const deps = group.dependencies || [];
      for (const dep of deps) {
        dependencies.push({
          id: dep.id,
          version: dep.range || '*',
          targetFramework: targetFramework,
        });
      }
    }

    return {
      version: version,
      dependencies: dependencies,
    };
  } catch (error) {
    console.error('Error fetching package metadata:', error);
    // If we can't get detailed metadata, return basic info
    return {
      version: version,
      dependencies: [],
    };
  }
}

/**
 * Get detailed package information
 * @param packageId The package ID
 */
export async function getPackageDetails(packageId: string): Promise<NuGetPackage | null> {
  try {
    const versions = await getPackageVersions(packageId);
    if (versions.length === 0) {
      return null;
    }

    const latestVersion = versions[versions.length - 1];
    const registrationUrl = `https://api.nuget.org/v3/registration5-semver1/${packageId.toLowerCase()}/${latestVersion.toLowerCase()}.json`;
    const result = await httpsGet(registrationUrl);

    const catalogEntry = result.catalogEntry || result;

    return {
      id: packageId,
      version: latestVersion,
      description: catalogEntry.description || '',
      authors: catalogEntry.authors
        ? catalogEntry.authors.split(',').map((a: string) => a.trim())
        : [],
      totalDownloads: 0,
      versions: versions,
      iconUrl: catalogEntry.iconUrl,
      projectUrl: catalogEntry.projectUrl,
      licenseUrl: catalogEntry.licenseUrl,
    };
  } catch (error) {
    console.error('Error fetching package details:', error);
    return null;
  }
}
