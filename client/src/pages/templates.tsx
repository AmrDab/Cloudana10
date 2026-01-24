import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
const TEMPLATES_API_URL = "https://console-api.akash.network/v1/templates";


export interface Template {
  id: string;
  name: string;
  path: string;
  logoUrl: string | null;
  summary: string;
  readme: string;
  deploy: string;
  persistentStorageEnabled: boolean;
  guide?: string;
  githubUrl: string;
  config: {
    ssh?: boolean;
  };
}

export interface TemplateCategory {
  title: string;
  templates: Template[];
}

// Fetch templates from API with proper error handling and timeout
const fetchWithBrowserHeaders = async (url: string): Promise<TemplatesResponse> => {
    // Create a timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Request timeout after 30 seconds')), 30000);
    });

    // First, try a simple fetch with JSON Accept header
    const fetchPromise = async (): Promise<TemplatesResponse> => {
      try {
        console.log('Attempting direct fetch to:', url);
        const response = await fetch(url, {
          method: 'GET',
          mode: 'cors',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('Direct fetch successful, data type:', Array.isArray(data) ? 'array' : typeof data, 'length:', Array.isArray(data) ? data.length : 'N/A');
        return data as TemplatesResponse;
      } catch (error) {
        console.warn('Direct fetch failed:', error);
        throw error;
      }
    };

    try {
      // Race between fetch and timeout
      return await Promise.race([fetchPromise(), timeoutPromise]);
    } catch (error) {
      // Fallback: Try with CORS proxy
      try {
        console.log('Trying CORS proxy...');
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
        const proxyPromise = fetch(proxyUrl, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
          },
        });

        const response = await Promise.race([proxyPromise, timeoutPromise]);
  
        if (!response.ok) {
          throw new Error(`Proxy fetch failed: ${response.status} ${response.statusText}`);
        }
  
        const data = await response.json();
        console.log('Proxy fetch successful, data type:', Array.isArray(data) ? 'array' : typeof data, 'length:', Array.isArray(data) ? data.length : 'N/A');
        return data as TemplatesResponse;
      } catch (proxyError) {
        console.error('All fetch methods failed:', proxyError);
        throw new Error(`Failed to fetch templates: ${proxyError instanceof Error ? proxyError.message : 'Unknown error'}`);
      }
    }
  };
  

// The API returns an array of TemplateCategory directly
export type TemplatesResponse = TemplateCategory[];

// Async function to fetch templates directly
export async function getAllTemplates(): Promise<TemplatesResponse | undefined> {
  try {
    console.log("Fetching templates from:", TEMPLATES_API_URL);
    const result = await fetchWithBrowserHeaders(TEMPLATES_API_URL);
    console.log("Raw API response:", result);
    
    // Validate that result is an array
    if (!Array.isArray(result)) {
      console.error("API response is not an array:", result);
      throw new Error("API response is not in the expected format (array expected)");
    }
    
    // The API returns an array of TemplateCategory directly
    return result as TemplatesResponse;
  } catch (err) {
    console.error("Error fetching templates:", err);
    throw err;
  }
}

// Get just the category titles from templates
export function getTemplateCategories(templates: TemplatesResponse | undefined): string[] {
  if (!templates || !Array.isArray(templates)) {
    return [];
  }
  return templates.map(category => category.title);
}

// Get category list with template counts
export function getTemplateCategoriesWithCounts(templates: TemplatesResponse | undefined): Array<{ title: string; count: number }> {
  if (!templates || !Array.isArray(templates)) {
    return [];
  }
  return templates.map(category => ({
    title: category.title,
    count: category.templates?.length || 0
  }));
}

// Async function to get just the category list
export async function getTemplateCategoriesList(): Promise<string[]> {
  const templates = await getAllTemplates();
  return getTemplateCategories(templates);
}

// Hook version for React components (uses React Query for caching)
export function useAllTemplates() {
  const { data, isLoading, error } = useQuery<TemplatesResponse | undefined>({
    queryKey: ["TEMPLATES_TABLE"],
    queryFn: async () => {
      try {
        return await getAllTemplates();
      } catch (err) {
        console.error("Error in useAllTemplates:", err);
        return undefined;
      }
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    refetchInterval: 1000 * 60,
    refetchIntervalInBackground: true,
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });

  console.log("templatesData:", data, "isLoading:", isLoading, "error:", error);
  return { data, isLoading, error };
}

// Hook to get just categories
export function useTemplateCategories() {
  const { data: templates, isLoading, error } = useAllTemplates();
  const categories = getTemplateCategories(templates);
  return { categories, isLoading, error };
}  