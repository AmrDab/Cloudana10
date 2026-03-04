/**
 * Deployment templates persistence using MongoDB (shared connection via lib/mongo).
 * Optimized for read speed: normalized schema with two collections and indexes.
 * - template_categories: lightweight docs (title, description, order) for ordered gallery
 * - templates: one doc per template, indexed by _id and categoryId for fast by-id and $lookup
 */
import type { Collection, Document } from "mongodb";
import { getDb } from "../lib/mongo.js";
import type { Template, TemplateCategory } from "../types/template.js";

const TEMPLATE_CATEGORIES_COLLECTION = "template_categories";
const TEMPLATES_COLLECTION = "templates";

/** Category document: MongoDB-style, used for $lookup and ordered gallery. */
export interface CategoryDoc {
  _id: string;
  title: string;
  description?: string;
  order: number;
  updatedAt: string;
}

/** Template document: MongoDB-style, one doc per template; categoryId for $lookup. */
export interface TemplateDoc extends Omit<Template, "id"> {
  _id: string;
  categoryId: string;
  updatedAt: string;
}

function slugFromTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "category";
}

async function categoriesCollection(): Promise<Collection<CategoryDoc>> {
  const d = await getDb();
  return d.collection(TEMPLATE_CATEGORIES_COLLECTION);
}

async function templatesCollection(): Promise<Collection<TemplateDoc>> {
  const d = await getDb();
  return d.collection(TEMPLATES_COLLECTION);
}

/** Ensure indexes for fast reads: template by id, templates by categoryId, categories by order. */
async function ensureIndexes(): Promise<void> {
  const db = await getDb();
  const cats = db.collection(TEMPLATE_CATEGORIES_COLLECTION);
  const tmpl = db.collection(TEMPLATES_COLLECTION);
  await Promise.all([
    cats.createIndex({ order: 1 }),
    tmpl.createIndex({ categoryId: 1 }),
    // _id is already unique index by default
  ]);
}

/** Map MongoDB template document to domain Template (strip _id, categoryId, updatedAt). */
function mapTemplateDocToTemplate(doc: TemplateDoc): Template {
  const { _id, categoryId, updatedAt, ...rest } = doc;
  return { id: _id, ...rest };
}

/** Raw aggregation row: category + embedded templates from $lookup (MongoDB shape). */
interface GalleryAggregationRow {
  _id: string;
  title: string;
  description?: string;
  order: number;
  updatedAt: string;
  templates: TemplateDoc[];
}

/** Map one aggregation row (MongoDB shape) to domain TemplateCategory. */
function mapGalleryRowToCategory(row: GalleryAggregationRow): TemplateCategory {
  return {
    title: row.title,
    description: row.description,
    templates: row.templates.map(mapTemplateDocToTemplate),
  };
}

/**
 * Migrate Akash/GitHub format to MongoDB-style docs. Write contract: one category doc per slug,
 * one template doc per unique template id (first category wins for categoryId). Read logic expects this.
 */
export function migrateAkashToMongoFormat(categories: TemplateCategory[]): {
  categoryDocs: CategoryDoc[];
  templateDocs: TemplateDoc[];
} {
  const now = new Date().toISOString();
  const categoryDocs: CategoryDoc[] = [];
  const seenSlug = new Set<string>();
  for (let i = 0; i < categories.length; i++) {
    const c = categories[i];
    const slug = slugFromTitle(c.title);
    if (seenSlug.has(slug)) continue;
    seenSlug.add(slug);
    categoryDocs.push({
      _id: slug,
      title: c.title,
      description: c.description,
      order: categoryDocs.length,
      updatedAt: now,
    });
  }
  const templateDocsById = new Map<string, TemplateDoc>();
  for (const cat of categories) {
    const categoryId = slugFromTitle(cat.title);
    for (const t of cat.templates) {
      const { id, ...rest } = t;
      if (templateDocsById.has(id)) continue;
      templateDocsById.set(id, {
        _id: id,
        categoryId,
        ...rest,
        updatedAt: now,
      });
    }
  }
  const templateDocs = Array.from(templateDocsById.values());
  return { categoryDocs, templateDocs };
}

/**
 * Load full gallery from DB. Matches write shape: one category doc per slug, one template doc per _id
 * with single categoryId; $lookup joins templates into their category, then we map to domain.
 */
export async function loadTemplateGallery(): Promise<TemplateCategory[] | null> {
  try {
    const db = await getDb();
    const pipeline: Document[] = [
      { $sort: { order: 1 } },
      {
        $lookup: {
          from: TEMPLATES_COLLECTION,
          localField: "_id",
          foreignField: "categoryId",
          as: "templates",
        },
      },
    ];
    const cursor = db.collection(TEMPLATE_CATEGORIES_COLLECTION).aggregate(pipeline);
    const rows = (await cursor.toArray()) as GalleryAggregationRow[];
    if (!rows?.length) return null;
    return rows.map(mapGalleryRowToCategory);
  } catch (e) {
    console.warn("[template-store] loadTemplateGallery failed:", e);
    return null;
  }
}

/**
 * Load one template by id. Matches write shape: one doc per template _id; strip Mongo fields to domain Template.
 */
export async function loadTemplateById(id: string): Promise<Template | null> {
  try {
    const coll = await templatesCollection();
    const doc = await coll.findOne({ _id: id });
    if (!doc) return null;
    return mapTemplateDocToTemplate(doc);
  } catch (e) {
    console.warn("[template-store] loadTemplateById failed:", e);
    return null;
  }
}

/** Save MongoDB-style documents (from migration). Use after migrateAkashToMongoFormat. */
export async function saveMongoTemplateData(
  categoryDocs: CategoryDoc[],
  templateDocs: TemplateDoc[],
): Promise<void> {
  try {
    const catColl = await categoriesCollection();
    const tmplColl = await templatesCollection();
    await catColl.deleteMany({});
    await tmplColl.deleteMany({});
    if (categoryDocs.length > 0) {
      await catColl.insertMany(categoryDocs);
    }
    if (templateDocs.length > 0) {
      await tmplColl.insertMany(templateDocs);
    }
    await ensureIndexes();
  } catch (e) {
    console.warn("[template-store] saveMongoTemplateData failed:", e);
    throw e;
  }
}

/** Save template gallery from Akash format (migrates to MongoDB style internally). */
export async function saveTemplateGallery(categories: TemplateCategory[]): Promise<void> {
  if (!categories?.length) return;
  const { categoryDocs, templateDocs } = migrateAkashToMongoFormat(categories);
  await saveMongoTemplateData(categoryDocs, templateDocs);
}
