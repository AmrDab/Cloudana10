/**
 * Fetch the full Akash template gallery from GitHub and emit a D1 seed file.
 *
 * Why a .sql file (not a direct write): saveTemplateGallery() needs the Workers
 * D1 binding via getD1(), which isn't available from a plain Node process.
 * fetchTemplatesFromAkash() is pure fetch, so it runs fine in Node. We fetch,
 * then write INSERT OR IGNORE statements that AUGMENT the existing curated set
 * (no DELETE) and apply with:
 *
 *   npx wrangler d1 execute cloudana-db --local  --file=./akash-templates-seed.sql
 *   npx wrangler d1 execute cloudana-db --remote --file=./akash-templates-seed.sql
 *
 * Run: npx tsx scripts/seed-akash-templates-to-d1.ts
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { fetchTemplatesFromAkash } from "../src/services/template.service.js";
import type { TemplateCategory } from "../src/types/template.js";

// D1 caps a single SQL statement at 100 KB. Cap the large text fields so the
// inlined INSERT stays well under that (column overhead + other fields ~1 KB).
const README_CAP = 60_000;
const DEPLOY_CAP = 30_000;
const cap = (s: string | undefined, max: number): string | undefined =>
  s && s.length > max ? s.slice(0, max) + "\n\n…(truncated)" : s;

// Mirrors slugFromTitle in template-store.ts so category ids match the app.
function slugFromTitle(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "category"
  );
}

// SQLite string literal: wrap in single quotes, double any embedded quote.
function sql(value: string | null | undefined): string {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

const OUT = "./akash-templates-seed.sql";
// Curated categories occupy low sort_order values; start Akash well above them.
const START_ORDER = 100;

async function main() {
  const CACHE = "./akash-gallery.json";
  let categories: TemplateCategory[];
  if (existsSync(CACHE)) {
    console.log(`Loading cached gallery from ${CACHE}...`);
    categories = JSON.parse(readFileSync(CACHE, "utf8"));
  } else {
    console.log("Fetching templates from Akash/GitHub (this can take a few minutes)...");
    categories = await fetchTemplatesFromAkash();
    writeFileSync(CACHE, JSON.stringify(categories), "utf8");
  }
  const totalTemplates = categories.reduce((n, c) => n + c.templates.length, 0);
  console.log(`Loaded ${categories.length} categories, ${totalTemplates} templates.`);

  if (categories.length === 0) {
    console.error("No templates fetched — aborting (GitHub fetch likely failed).");
    process.exit(1);
  }

  const now = new Date().toISOString();
  const lines: string[] = [
    "-- Akash template gallery seed (augments curated set; INSERT OR IGNORE).",
    `-- Generated ${now} — ${categories.length} categories, ${totalTemplates} templates.`,
    "",
  ];

  const seenSlug = new Set<string>();
  const seenTemplateId = new Set<string>();
  let order = START_ORDER;
  let catCount = 0;
  let tmplCount = 0;

  for (const cat of categories) {
    const slug = slugFromTitle(cat.title);
    if (seenSlug.has(slug)) continue;
    seenSlug.add(slug);

    lines.push(
      `INSERT OR IGNORE INTO template_categories (id, title, description, sort_order, updated_at) VALUES (${sql(slug)}, ${sql(cat.title)}, ${sql(cat.description)}, ${order++}, ${sql(now)});`,
    );
    catCount++;

    for (const t of cat.templates) {
      if (seenTemplateId.has(t.id)) continue;
      seenTemplateId.add(t.id);

      lines.push(
        `INSERT OR IGNORE INTO templates (id, category_id, name, path, readme, summary, logo_url, deploy, guide, github_url, persistent_storage_enabled, config, updated_at) VALUES (` +
          `${sql(t.id)}, ${sql(slug)}, ${sql(t.name)}, ${sql(t.path)}, ${sql(cap(t.readme, README_CAP))}, ${sql(t.summary)}, ${sql(t.logoUrl)}, ${sql(cap(t.deploy, DEPLOY_CAP))}, ${sql(t.guide)}, ${sql(t.githubUrl)}, ${t.persistentStorageEnabled ? 1 : 0}, ${sql(JSON.stringify(t.config))}, ${sql(now)});`,
      );
      tmplCount++;
    }
  }

  writeFileSync(OUT, lines.join("\n") + "\n", "utf8");
  console.log(`Wrote ${OUT}: ${catCount} categories, ${tmplCount} templates.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("seed generation failed:", err);
  process.exit(1);
});
