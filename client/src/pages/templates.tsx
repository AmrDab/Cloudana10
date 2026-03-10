import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

/** Base URL for template API (templates are served from backend MongoDB). */
const getTemplatesApiBase = () =>
  import.meta.env.VITE_API_URL
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

/** Category from API (templates loaded from backend DB). */
export interface TemplateCategory {
  title: string;
  description?: string;
  templates: Template[];
}

// The API returns an array of TemplateCategory directly (from backend DB)
export type TemplatesResponse = TemplateCategory[];

const TEMPLATE_FETCH_TIMEOUT_MS = 60_000;

/** Fetch template gallery from API (backend reads from MongoDB). */
const fetchGallery = async (url: string): Promise<TemplatesResponse> => {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("Request timeout")), TEMPLATE_FETCH_TIMEOUT_MS);
  });
  const fetchPromise = async (): Promise<TemplatesResponse> => {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`);
    }
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error("API response is not an array");
    return data as TemplatesResponse;
  };
  return Promise.race([fetchPromise(), timeoutPromise]);
};

/** Fetch all templates (gallery) from backend DB. */
export async function getAllTemplates(): Promise<TemplatesResponse | undefined> {
  try {
    const url = getTemplatesApiBase();
    const result = await fetchGallery(url);
    return result;
  } catch (err) {
    console.error("Error fetching templates:", err);
    throw err;
  }
}

/** Response shape for GET /v1/templates/:id */
export interface GetTemplateByIdResponse {
  data: Template;
}

/** Fetch a single template by id from backend DB (one indexed read). */
export async function getTemplateById(id: string): Promise<Template | null> {
  try {
    const base = getTemplatesApiBase();
    const url = `${base}/${encodeURIComponent(id)}`;
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`);
    }
    const json = (await response.json()) as GetTemplateByIdResponse;
    return json?.data ?? null;
  } catch (err) {
    console.error("Error fetching template by id:", err);
    return null;
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

/** Hook: template gallery from backend DB (React Query cache). */
export function useAllTemplates() {
  const { data, isLoading, error } = useQuery<TemplatesResponse | undefined>({
    queryKey: ["templates", "gallery"],
    queryFn: async () => {
      try {
        return await getAllTemplates();
      } catch (err) {
        console.error("Error in useAllTemplates:", err);
        return undefined;
      }
    },
    staleTime: 10 * 60 * 1000, // 10 min - templates are from DB, updated by fetch-templates script
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });

  useEffect(() => {
    if (data) {
      console.log("Templates loaded from DB:", data.length, "categories");
    }
  }, [data]);

  return { data, isLoading, error };
}

/** Hook: single template by id from backend DB (one indexed read; use for detail/deep link). */
export function useTemplateById(id: string | null) {
  const { data, isLoading, error } = useQuery<Template | null>({
    queryKey: ["templates", "byId", id],
    queryFn: () => (id ? getTemplateById(id) : Promise.resolve(null)),
    enabled: Boolean(id),
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
  return { data: data ?? null, isLoading, error };
}

// Hook to get just categories
export function useTemplateCategories() {
  const { data: templates, isLoading, error } = useAllTemplates();
  const categories = getTemplateCategories(templates);
  return { categories, isLoading, error };
}  