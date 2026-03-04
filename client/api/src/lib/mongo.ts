/**
 * Shared MongoDB connection. Connect before any server work (build status, templates).
 * Set MONGODB_URI (default: mongodb://localhost:27017) and MONGODB_DB (default: cloudana).
 */
import { MongoClient, type Db } from "mongodb";

const DEFAULT_URI = "mongodb://localhost:27017";
const DEFAULT_DB = "cloudana";

let client: MongoClient | null = null;
let db: Db | null = null;

export function getMongoUri(): string {
  return process.env.MONGODB_URI ?? DEFAULT_URI;
}

export function getDbName(): string {
  return process.env.MONGODB_DB ?? DEFAULT_DB;
}

/** Connect to MongoDB. Call once at server startup before any DB-dependent work. */
export async function connectMongo(): Promise<void> {
  if (db) return;
  const uri = getMongoUri();
  client = new MongoClient(uri);
  await client.connect();
  db = client.db(getDbName());
}

/** Get the connected DB. Throws if connectMongo() has not been called successfully. */
export async function getDb(): Promise<Db> {
  if (!db) {
    await connectMongo();
  }
  if (!db) throw new Error("MongoDB not connected");
  return db;
}

/** Close the MongoDB connection (e.g. graceful shutdown). */
export async function closeMongo(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}
