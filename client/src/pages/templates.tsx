import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { useEffect } from "react";
const TEMPLATES_API_URL = import.meta.env.VITE_API_URL 
  ? `${import.meta.env.VITE_API_URL}/v1/templates`
  : "http://localhost:7002/v1/templates";


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
  // Create a timeout promise (increased to 2 minutes for template processing)
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Request timeout after 2 minutes')), 120000);
  });

  const fetchPromise = async (): Promise<TemplatesResponse> => {
    console.log('Fetching templates from:', url);
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`);
    }
    
    const data = await response.json();
    console.log('Fetch successful, data type:', Array.isArray(data) ? 'array' : typeof data, 'length:', Array.isArray(data) ? data.length : 'N/A');
    return data as TemplatesResponse;
  };

  try {
    // Race between fetch and timeout
    return await Promise.race([fetchPromise(), timeoutPromise]);
  } catch (error) {
    console.error('Failed to fetch templates:', error);
    throw new Error(`Failed to fetch templates: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
    refetchInterval: false, // Disable automatic refetching - templates don't change frequently
    refetchOnWindowFocus: false, // Don't refetch when window regains focus
    refetchOnMount: false, // Don't refetch on component mount if data exists
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });

  // Only log when data actually changes (not on every render)
  useEffect(() => {
    if (data) {
      console.log("Templates loaded:", data.length, "categories");
    }
  }, [data]);
  
  return { data, isLoading, error };
}

// Hook to get just categories
export function useTemplateCategories() {
  const { data: templates, isLoading, error } = useAllTemplates();
  const categories = getTemplateCategories(templates);
  return { categories, isLoading, error };
}  