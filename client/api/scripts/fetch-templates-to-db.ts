/**
 * Fetch Akash template data from GitHub/Akash, migrate to MongoDB-style docs, then save.
 * Run with: yarn fetch-templates (or npm run fetch-templates).
 * Uses same MONGODB_URI / MONGODB_DB as the API. Run once or on a schedule to populate templates.
 *
 * Flow: Akash/GitHub format → migrate to MongoDB style (_id, categoryId, updatedAt) → save.
 */
import "dotenv/config";
import { connectMongo, closeMongo } from "../src/lib/mongo.js";
import { fetchTemplatesFromAkash } from "../src/services/template.service.js";
import { migrateAkashToMongoFormat, saveMongoTemplateData } from "../src/services/template-store.js";

async function main() {
  console.log("Connecting to MongoDB...");
  await connectMongo();
  console.log("Fetching templates from Akash/GitHub...");
  const categories = await fetchTemplatesFromAkash();
  const totalTemplates = categories.reduce((n, c) => n + c.templates.length, 0);
  console.log(`Fetched ${categories.length} categories, ${totalTemplates} templates.`);
  if (categories.length === 0) {
    console.warn("No templates to save.");
    await closeMongo();
    process.exit(0);
    return;
  }
  console.log("Migrating to MongoDB-style documents (_id, categoryId, updatedAt)...");
  const { categoryDocs, templateDocs } = migrateAkashToMongoFormat(categories);
  await saveMongoTemplateData(categoryDocs, templateDocs);
  console.log(`Saved ${categoryDocs.length} categories, ${templateDocs.length} templates to MongoDB.`);
  await closeMongo();
  process.exit(0);
}

main().catch((err) => {
  console.error("fetch-templates failed:", err);
  process.exit(1);
});
