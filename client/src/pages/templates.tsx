/**
 * Template data layer.
 *
 * For the testnet MVP, templates are served from a static array
 * (no MongoDB / backend dependency). The interfaces remain the same
 * so the gallery UI and deployment editor work unchanged.
 */

import { CLOUDANA_TEMPLATES } from "@/data/cloudana-templates";

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

/** Category grouping for the template gallery. */
export interface TemplateCategory {
  title: string;
  description?: string;
  templates: Template[];
}

export type TemplatesResponse = TemplateCategory[];

/* ------------------------------------------------------------------ */
/*  Hooks                                                              */
/* ------------------------------------------------------------------ */

/** All Cloudana templates — instant, no network request. */
export function useAllTemplates() {
  return {
    data: CLOUDANA_TEMPLATES as TemplatesResponse,
    isLoading: false,
    error: null,
  };
}

/** Single template lookup by id. */
export function useTemplateById(id: string | null) {
  if (!id) return { data: null, isLoading: false, error: null };
  const flat = CLOUDANA_TEMPLATES.flatMap((c) => c.templates);
  const found = flat.find((t) => t.id === id) ?? null;
  return { data: found, isLoading: false, error: null };
}

/* ------------------------------------------------------------------ */
/*  Utilities                                                          */
/* ------------------------------------------------------------------ */

export function getTemplateCategories(
  templates: TemplatesResponse | undefined,
): string[] {
  if (!templates || !Array.isArray(templates)) return [];
  return templates.map((c) => c.title);
}

export function getTemplateCategoriesWithCounts(
  templates: TemplatesResponse | undefined,
): Array<{ title: string; count: number }> {
  if (!templates || !Array.isArray(templates)) return [];
  return templates.map((c) => ({
    title: c.title,
    count: c.templates?.length || 0,
  }));
}

export function getTemplateCategoriesList(): string[] {
  return getTemplateCategories(CLOUDANA_TEMPLATES);
}

export function useTemplateCategories() {
  const { data: templates } = useAllTemplates();
  const categories = getTemplateCategories(templates);
  return { categories, isLoading: false, error: null };
}
