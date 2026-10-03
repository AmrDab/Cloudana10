import type { Template, TemplateCategory } from "../types/template.js";
import { loadTemplateGallery, loadTemplateById, saveTemplateGallery } from "./template-store.js";
import { SEED_TEMPLATES, seedTemplateById } from "./template-seed.js";

const REPOSITORIES = {
  "awesome-akash": {
    owner: "akash-network",
    repo: "awesome-akash",
    branch: "master"
  },
  "cosmos-omnibus": {
    owner: "akash-network",
    repo: "cosmos-omnibus",
    branch: "master"
  },
  "akash-linuxserver": {
    owner: "cryptoandcoffee",
    repo: "akash-linuxserver",
    branch: "main"
  }
};

interface TemplateSource {
  name: string;
  path: string;
  repoOwner: string;
  repoName: string;
  repoBranch: string;
  logoUrl?: string | null;
  summary?: string;
}

// Fetch file content from GitHub raw content API with timeout
async function fetchFileContent(owner: string, repo: string, branch: string, path: string, timeout: number = 5000): Promise<string | null> {
  try {
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!response.ok) {
        return null;
      }
      return await response.text();
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        console.warn(`Timeout fetching ${path}`);
      }
      return null;
    }
  } catch (error) {
    console.warn(`Failed to fetch ${path}:`, error);
    return null;
  }
}

// Fetch directory listing using GitHub API (public, no auth needed for basic info)
async function fetchDirectoryListing(owner: string, repo: string, branch: string, path: string = ""): Promise<Array<{ name: string; path: string; type: string }>> {
  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
    const response = await fetch(url);
    if (!response.ok) {
      return [];
    }
    const data = await response.json();
    if (!Array.isArray(data)) {
      return [];
    }
    return data.map((item: { name: string; path: string; type: string }) => ({
      name: item.name,
      path: item.path,
      type: item.type
    }));
  } catch (error) {
    console.warn(`Failed to fetch directory listing for ${path}:`, error);
    return [];
  }
}

// Parse README to extract categories and templates
function parseReadme(
  readmeContent: string,
  repoOwner: string,
  repoName: string,
  repoBranch: string
): Array<{ title: string; description?: string; templates: TemplateSource[] }> {
  const categories: Array<{ title: string; description?: string; templates: TemplateSource[] }> = [];
  
  // Match category headers: ### Category Title
  // Optional description on next line
  // List of templates: - [Template Name](path/to/template)
  const categoryRegex = /### (.+?)(?:\n+([^\n]+?))?\n+((?:- \[.+?\]\(.+?\)\n?)+)/gm;
  
  let match;
  while ((match = categoryRegex.exec(readmeContent)) !== null) {
    const title = match[1].trim();
    const description = match[2]?.trim();
    const templatesStr = match[3];
    
    if (!templatesStr) continue;
    
    // Parse template links: - [Template Name](path/to/template)
    const templateRegex = /- \[(.+?)\]\((.+?)\)/g;
    const templates: TemplateSource[] = [];
    let templateMatch;
    
    while ((templateMatch = templateRegex.exec(templatesStr)) !== null) {
      const name = templateMatch[1].trim();
      let path = templateMatch[2].trim();
      
      // Remove leading ./ or / if present
      path = path.replace(/^\.?\//, "");
      
      // Skip if it's an external URL
      if (path.startsWith("http://") || path.startsWith("https://")) {
        continue;
      }
      
      templates.push({ name, path, repoOwner, repoName, repoBranch });
    }
    
    if (templates.length > 0) {
      categories.push({ title, description, templates });
    }
  }
  
  return categories;
}

// Get template summary from README (first 200 chars)
function getTemplateSummary(readme: string | null): string {
  if (!readme) return "";
  
  // Remove images and first header
  let text = readme
    .replace(/!\[.*?\]\(.+?\)\n*/g, "")
    .replace(/^#+ .*\n+/gm, "");
  
  // Remove markdown formatting
  text = text
    .replace(/#{1,6}\s/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .trim();
  
  const maxLength = 200;
  return text.length > maxLength ? text.substring(0, maxLength - 3).trim() + "..." : text;
}

// Process a single template
async function processTemplate(
  templateSource: TemplateSource,
  options: { ignoreList?: string[]; includeConfigJson?: boolean } = {}
): Promise<Template | null> {
  try {
    const { ignoreList = [], includeConfigJson = false } = options;
    
    const [readme, deployYaml, deployYml, guide, configJson] = await Promise.all([
      fetchFileContent(templateSource.repoOwner, templateSource.repoName, templateSource.repoBranch, `${templateSource.path}/README.md`),
      fetchFileContent(templateSource.repoOwner, templateSource.repoName, templateSource.repoBranch, `${templateSource.path}/deploy.yaml`),
      fetchFileContent(templateSource.repoOwner, templateSource.repoName, templateSource.repoBranch, `${templateSource.path}/deploy.yml`),
      fetchFileContent(templateSource.repoOwner, templateSource.repoName, templateSource.repoBranch, `${templateSource.path}/GUIDE.md`),
      includeConfigJson ? fetchFileContent(templateSource.repoOwner, templateSource.repoName, templateSource.repoBranch, `${templateSource.path}/config.json`) : Promise.resolve(null)
    ]);
    
    const deploy = deployYaml || deployYml;
    
    if (!readme || !deploy) {
      return null;
    }
    
    // Check ignore list for akash-linuxserver
    if (ignoreList.length > 0) {
      const readmeLower = readme.toLowerCase();
      if (ignoreList.some(phrase => readmeLower.includes(phrase.toLowerCase()))) {
        return null;
      }
    }
    
    const id = `${templateSource.repoOwner}-${templateSource.repoName}-${templateSource.path}`;
    
    // Parse config.json if available
    let config: { ssh?: boolean; logoUrl?: string } = {};
    if (configJson) {
      try {
        config = JSON.parse(configJson);
      } catch (e) {
        // Ignore parse errors
      }
    }
    
    // Use provided logoUrl and summary if available
    const logoUrl = templateSource.logoUrl || config.logoUrl || null;
    const summary = templateSource.summary || getTemplateSummary(readme);
    
    // Check for persistent storage
    const persistentStorageEnabled = deploy.includes("persistent: true") || deploy.includes("persistent:true");
    
    // Replace relative links in README with absolute GitHub URLs
    let processedReadme = readme;
    const linkRegex = /!?\[([^\]]+)\]\((?!https?:\/\/)([^)]+)\)/g;
    const baseUrl = `https://raw.githubusercontent.com/${templateSource.repoOwner}/${templateSource.repoName}/${templateSource.repoBranch}`;
    processedReadme = processedReadme.replace(linkRegex, (match, text, url) => {
      const isImage = match.startsWith("!");
      const cleanUrl = url.replace(/^\.?\//, "");
      const absoluteUrl = isImage
        ? `${baseUrl}/${templateSource.path}/${cleanUrl}`
        : `https://github.com/${templateSource.repoOwner}/${templateSource.repoName}/blob/${templateSource.repoBranch}/${templateSource.path}/${cleanUrl}`;
      return `[${text}](${absoluteUrl})`;
    });
    
    const template: Template = {
      id,
      name: templateSource.name,
      path: id,
      readme: processedReadme,
      summary,
      logoUrl,
      deploy,
      guide: guide || undefined,
      githubUrl: `https://github.com/${templateSource.repoOwner}/${templateSource.repoName}/blob/${templateSource.repoBranch}/${templateSource.path}`,
      persistentStorageEnabled,
      config: {
        ssh: config.ssh || false,
        ...(logoUrl && { logoUrl })
      }
    };
    
    return template;
  } catch (error) {
    console.warn(`Failed to process template ${templateSource.name}:`, error);
    return null;
  }
}

// Fetch templates from awesome-akash repository
export async function fetchAwesomeAkashTemplates(): Promise<TemplateCategory[]> {
  const repo = REPOSITORIES["awesome-akash"];
  const readmeContent = await fetchFileContent(repo.owner, repo.repo, repo.branch, "README.md");
  
  if (!readmeContent) {
    throw new Error("Failed to fetch README from awesome-akash repository");
  }
  
  const categoriesData = parseReadme(readmeContent, repo.owner, repo.repo, repo.branch);
  return await processCategories(categoriesData, { includeConfigJson: true });
}

// Fetch templates from cosmos-omnibus repository
async function fetchCosmosOmnibusTemplates(): Promise<TemplateCategory[]> {
  const repo = REPOSITORIES["cosmos-omnibus"];
  const directoryItems = await fetchDirectoryListing(repo.owner, repo.repo, repo.branch, "");
  
  // Filter for directories only, exclude hidden and special folders
  const folders = directoryItems.filter(item => 
    item.type === "dir" && 
    !item.name.startsWith(".") && 
    !item.name.startsWith("_")
  );
  
  const templateSources: TemplateSource[] = [];
  
  // Fetch chain registry data for each folder to get name and description
  // Process in parallel with timeout
  const chainDataPromises = folders.map(async (folder) => {
    try {
      // Try to fetch chain registry data with timeout
      const chainRegistryUrl = `https://raw.githubusercontent.com/cosmos/chain-registry/master/${folder.name}/chain.json`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      try {
        const chainResponse = await fetch(chainRegistryUrl, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        if (chainResponse.ok) {
          const chainData = await chainResponse.json() as {
            pretty_name?: string;
            description?: string;
            logo_URIs?: Record<string, string>;
          };
          const logoUris = chainData.logo_URIs || {};
          const logoUrl = Object.values(logoUris)[0];
          return {
            name: chainData.pretty_name || folder.name,
            path: folder.path,
            repoOwner: repo.owner,
            repoName: repo.repo,
            repoBranch: repo.branch,
            summary: chainData.description || "This is a meta package of cosmos-sdk-based docker images and configuration meant to make deploying onto Akash easy and standardized across cosmos.",
            logoUrl: logoUrl || null
          };
        } else {
          // Fallback if chain registry doesn't have this chain
          return {
            name: folder.name,
            path: folder.path,
            repoOwner: repo.owner,
            repoName: repo.repo,
            repoBranch: repo.branch,
            summary: "This is a meta package of cosmos-sdk-based docker images and configuration meant to make deploying onto Akash easy and standardized across cosmos."
          };
        }
      } catch (fetchError) {
        clearTimeout(timeoutId);
        if (fetchError instanceof Error && fetchError.name === 'AbortError') {
          console.warn(`Timeout fetching chain data for ${folder.name}`);
        }
        // Fallback
        return {
          name: folder.name,
          path: folder.path,
          repoOwner: repo.owner,
          repoName: repo.repo,
          repoBranch: repo.branch,
          summary: "This is a meta package of cosmos-sdk-based docker images and configuration meant to make deploying onto Akash easy and standardized across cosmos."
        };
      }
    } catch (error) {
      console.warn(`Could not fetch chain data for ${folder.name}:`, error);
      return {
        name: folder.name,
        path: folder.path,
        repoOwner: repo.owner,
        repoName: repo.repo,
        repoBranch: repo.branch,
        summary: "This is a meta package of cosmos-sdk-based docker images and configuration meant to make deploying onto Akash easy and standardized across cosmos."
      };
    }
  });
  
  const results = await Promise.allSettled(chainDataPromises);
  for (const result of results) {
    if (result.status === 'fulfilled') {
      templateSources.push(result.value);
    }
  }
  
  const categories: Array<{ title: string; description?: string; templates: TemplateSource[] }> = [{
    title: "Blockchain",
    templates: templateSources
  }];
  
  return await processCategories(categories, { includeConfigJson: true });
}

// Fetch templates from akash-linuxserver repository
async function fetchAkashLinuxServerTemplates(): Promise<TemplateCategory[]> {
  const repo = REPOSITORIES["akash-linuxserver"];
  const readmeContent = await fetchFileContent(repo.owner, repo.repo, repo.branch, "README.md");
  
  if (!readmeContent) {
    throw new Error("Failed to fetch README from akash-linuxserver repository");
  }
  
  const categoriesData = parseReadme(readmeContent, repo.owner, repo.repo, repo.branch);
  return await processCategories(categoriesData, {
    ignoreList: [
      "not recommended for use by the general public",
      "THIS IMAGE IS DEPRECATED",
      "container is not meant for public consumption",
      "Not for public consumption"
    ]
  });
}

// Process categories and their templates
async function processCategories(
  categoriesData: Array<{ title: string; description?: string; templates: TemplateSource[] }>,
  options: { ignoreList?: string[]; includeConfigJson?: boolean } = {}
): Promise<TemplateCategory[]> {
  const categories: TemplateCategory[] = [];
  const concurrency = 5; // Reduced concurrency to avoid overwhelming GitHub API
  
  for (const categoryData of categoriesData) {
    const templates: Template[] = [];
    
    // Process templates in batches with timeout protection
    for (let i = 0; i < categoryData.templates.length; i += concurrency) {
      const batch = categoryData.templates.slice(i, i + concurrency);
      const results = await Promise.allSettled(
        batch.map(templateSource => processTemplate(templateSource, options))
      );
      
      // Extract successful results
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value !== null) {
          templates.push(result.value);
        }
      }
    }
    
    if (templates.length > 0) {
      categories.push({
        title: categoryData.title,
        description: categoryData.description,
        templates
      });
    }
  }
  
  return categories;
}

// Merge template categories (combine categories with same title)
function mergeTemplateCategories(...categoriesArrays: TemplateCategory[][]): TemplateCategory[] {
  const mergedCategories: TemplateCategory[] = [];
  
  // Flatten all categories from all arrays
  const allCategories: TemplateCategory[] = ([] as TemplateCategory[]).concat(...categoriesArrays);
  
  for (const category of allCategories) {
    const existingCategory = mergedCategories.find(
      c => c.title.toLowerCase() === category.title.toLowerCase()
    );
    
    if (existingCategory) {
      existingCategory.templates = existingCategory.templates.concat(category.templates);
    } else {
      mergedCategories.push(JSON.parse(JSON.stringify(category)));
    }
  }
  
  return mergedCategories;
}

/** Fetch template gallery from Akash/GitHub only (no DB). Used by fetch-templates script. */
export async function fetchTemplatesFromAkash(): Promise<TemplateCategory[]> {
  const [awesomeAkashTemplates, cosmosOmnibusTemplates, akashLinuxServerTemplates] = await Promise.all([
    fetchAwesomeAkashTemplates().catch(err => {
      console.error("Error fetching awesome-akash templates:", err);
      return [];
    }),
    fetchCosmosOmnibusTemplates().catch(err => {
      console.error("Error fetching cosmos-omnibus templates:", err);
      return [];
    }),
    fetchAkashLinuxServerTemplates().catch(err => {
      console.error("Error fetching akash-linuxserver templates:", err);
      return [];
    })
  ]);

  return mergeTemplateCategories(
    awesomeAkashTemplates,
    cosmosOmnibusTemplates,
    akashLinuxServerTemplates
  );
}

/** Gallery cache shared by every TemplateService (cleared by refreshTemplates). */
const CACHE_TTL = 5 * 60 * 1000;
let cachedTemplates: TemplateCategory[] | null = null;
let cacheTimestamp = 0;

export function invalidateTemplateCache(): void {
  cachedTemplates = null;
  cacheTimestamp = 0;
}

/** Imported (awesome-akash) templates run as containers; the image is the SDL's first `image:`. */
function annotateImported(categories: TemplateCategory[]): TemplateCategory[] {
  return categories.map((cat) => ({
    ...cat,
    templates: cat.templates.map((t) => ({
      ...t,
      kind: "container" as const,
      category: cat.title,
      curated: false,
      image: /^\s*image:\s*["']?([^\s"']+)/m.exec(t.deploy)?.[1] ?? null,
    })),
  }));
}

/**
 * Fetch awesome-akash, put Cloudana's curated list in front (same-title categories merge,
 * curated templates first; a duplicate id keeps the curated one), and replace the store.
 * If the fetch fails the store still gets the curated list.
 */
export async function refreshTemplates(): Promise<{ categories: number; templates: number; imported: number; curated: number }> {
  const imported = annotateImported(
    await fetchAwesomeAkashTemplates().catch((err) => {
      console.warn("[templates] awesome-akash fetch failed:", err);
      return [] as TemplateCategory[];
    }),
  );
  const merged = mergeTemplateCategories(SEED_TEMPLATES, imported);
  await saveTemplateGallery(merged);
  invalidateTemplateCache();
  const count = (cats: TemplateCategory[]) => cats.reduce((n, c) => n + c.templates.length, 0);
  const ids = new Set(merged.flatMap((c) => c.templates.map((t) => t.id)));
  return { categories: merged.length, templates: ids.size, imported: count(imported), curated: count(SEED_TEMPLATES) };
}

export class TemplateService {
  /** Gallery from the store (5-min cache); the curated seed when the store is empty. */
  async getTemplateGallery(): Promise<TemplateCategory[]> {
    const now = Date.now();
    if (cachedTemplates && now - cacheTimestamp < CACHE_TTL) return cachedTemplates;
    const fromDb = await loadTemplateGallery();
    cachedTemplates = fromDb && fromDb.length > 0 ? fromDb : SEED_TEMPLATES;
    cacheTimestamp = now;
    return cachedTemplates;
  }

  /** Store first, then the curated seed (so curated ids resolve before any refresh). */
  async getTemplateById(id: string): Promise<Template | null> {
    return (await loadTemplateById(id)) ?? seedTemplateById(id);
  }
}
