/**
 * Deployment templates persistence using Cloudflare D1 (SQLite at the edge).
 * Two tables: template_categories (ordered gallery) + templates (one row per template).
 */
import { getD1 } from "../lib/storage.js";
import type { Template, TemplateCategory } from "../types/template.js";

function slugFromTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "category";
}

/**
 * Load full gallery from D1. Categories ordered, templates joined by category_id.
 */
export async function loadTemplateGallery(): Promise<TemplateCategory[] | null> {
  try {
    const db = getD1();

    const cats = await db
      .prepare("SELECT id, title, description FROM template_categories ORDER BY sort_order")
      .all<{ id: string; title: string; description: string | null }>();

    if (!cats.results?.length) return null;

    const tmpls = await db
      .prepare(
        "SELECT id, category_id, name, path, readme, summary, logo_url, deploy, guide, github_url, persistent_storage_enabled, config FROM templates"
      )
      .all<{
        id: string;
        category_id: string;
        name: string;
        path: string;
        readme: string;
        summary: string;
        logo_url: string | null;
        deploy: string;
        guide: string | null;
        github_url: string;
        persistent_storage_enabled: number;
        config: string;
      }>();

    // Group templates by category
    const byCat = new Map<string, Template[]>();
    for (const t of tmpls.results ?? []) {
      const list = byCat.get(t.category_id) ?? [];
      list.push({
        id: t.id,
        name: t.name,
        path: t.path,
        readme: t.readme,
        summary: t.summary,
        logoUrl: t.logo_url,
        deploy: t.deploy,
        guide: t.guide ?? undefined,
        githubUrl: t.github_url,
        persistentStorageEnabled: !!t.persistent_storage_enabled,
        config: JSON.parse(t.config || "{}"),
      });
      byCat.set(t.category_id, list);
    }

    return cats.results.map((cat) => ({
      title: cat.title,
      description: cat.description ?? undefined,
      templates: byCat.get(cat.id) ?? [],
    }));
  } catch (e) {
    console.warn("[template-store] loadTemplateGallery failed:", e);
    return null;
  }
}

/**
 * Load one template by id.
 */
export async function loadTemplateById(id: string): Promise<Template | null> {
  try {
    const db = getD1();
    const row = await db
      .prepare(
        "SELECT id, name, path, readme, summary, logo_url, deploy, guide, github_url, persistent_storage_enabled, config FROM templates WHERE id = ?"
      )
      .bind(id)
      .first<{
        id: string;
        name: string;
        path: string;
        readme: string;
        summary: string;
        logo_url: string | null;
        deploy: string;
        guide: string | null;
        github_url: string;
        persistent_storage_enabled: number;
        config: string;
      }>();

    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      path: row.path,
      readme: row.readme,
      summary: row.summary,
      logoUrl: row.logo_url,
      deploy: row.deploy,
      guide: row.guide ?? undefined,
      githubUrl: row.github_url,
      persistentStorageEnabled: !!row.persistent_storage_enabled,
      config: JSON.parse(row.config || "{}"),
    };
  } catch (e) {
    console.warn("[template-store] loadTemplateById failed:", e);
    return null;
  }
}

/**
 * Save template gallery to D1. Replaces all existing data.
 * Used by the template fetch script / admin endpoint.
 */
export async function saveTemplateGallery(categories: TemplateCategory[]): Promise<void> {
  if (!categories?.length) return;

  const db = getD1();
  const now = new Date().toISOString();

  // Clear existing data
  await db.batch([
    db.prepare("DELETE FROM templates"),
    db.prepare("DELETE FROM template_categories"),
  ]);

  // Insert categories
  const seenSlug = new Set<string>();
  let order = 0;
  const catStmts: D1PreparedStatement[] = [];
  const tmplStmts: D1PreparedStatement[] = [];
  const seenTemplateId = new Set<string>();

  for (const cat of categories) {
    const slug = slugFromTitle(cat.title);
    if (seenSlug.has(slug)) continue;
    seenSlug.add(slug);

    catStmts.push(
      db
        .prepare(
          "INSERT INTO template_categories (id, title, description, sort_order, updated_at) VALUES (?, ?, ?, ?, ?)"
        )
        .bind(slug, cat.title, cat.description ?? null, order++, now)
    );

    for (const t of cat.templates) {
      if (seenTemplateId.has(t.id)) continue;
      seenTemplateId.add(t.id);

      tmplStmts.push(
        db
          .prepare(
            "INSERT INTO templates (id, category_id, name, path, readme, summary, logo_url, deploy, guide, github_url, persistent_storage_enabled, config, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
          )
          .bind(
            t.id,
            slug,
            t.name,
            t.path,
            t.readme,
            t.summary,
            t.logoUrl,
            t.deploy,
            t.guide ?? null,
            t.githubUrl,
            t.persistentStorageEnabled ? 1 : 0,
            JSON.stringify(t.config),
            now
          )
      );
    }
  }

  // Batch insert (D1 batch limit is 100 statements)
  const allStmts = [...catStmts, ...tmplStmts];
  for (let i = 0; i < allStmts.length; i += 100) {
    await db.batch(allStmts.slice(i, i + 100));
  }
}

/**
 * Migrate Akash/GitHub format to D1-compatible structures.
 * Kept for compatibility with the fetch-templates script.
 */
export function migrateAkashToMongoFormat(categories: TemplateCategory[]) {
  const now = new Date().toISOString();
  const categoryDocs: Array<{ _id: string; title: string; description?: string; order: number; updatedAt: string }> = [];
  const seenSlug = new Set<string>();
  for (let i = 0; i < categories.length; i++) {
    const c = categories[i];
    const slug = slugFromTitle(c.title);
    if (seenSlug.has(slug)) continue;
    seenSlug.add(slug);
    categoryDocs.push({ _id: slug, title: c.title, description: c.description, order: categoryDocs.length, updatedAt: now });
  }
  const templateDocs: Array<{ _id: string; categoryId: string } & Omit<Template, "id"> & { updatedAt: string }> = [];
  const templateDocsById = new Map<string, (typeof templateDocs)[number]>();
  for (const cat of categories) {
    const categoryId = slugFromTitle(cat.title);
    for (const t of cat.templates) {
      const { id, ...rest } = t;
      if (templateDocsById.has(id)) continue;
      const doc = { _id: id, categoryId, ...rest, updatedAt: now };
      templateDocsById.set(id, doc);
    }
  }
  return { categoryDocs, templateDocs: Array.from(templateDocsById.values()) };
}
