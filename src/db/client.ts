import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../drizzle/schema";

let pool: Pool | null = null;
let db: NodePgDatabase<typeof schema> | null = null;

const connectionString =
  process.env.POSTGRES_URL_NON_POOLING ??
  process.env.POSTGRES_URL ??
  process.env.DATABASE_URL ??
  null;

const isDbConfigured = Boolean(connectionString);

function initialize(): void {
  if (db || !isDbConfigured) {
    return;
  }
  pool = new Pool({ connectionString: connectionString! });
  db = drizzle(pool, { schema });
}

export function getDb(): NodePgDatabase<typeof schema> {
  if (!isDbConfigured) {
    throw new Error("Database connection string is not configured.");
  }
  if (!db) {
    initialize();
  }
  return db!;
}

export function maybeGetDb(): NodePgDatabase<typeof schema> | null {
  if (!db && isDbConfigured) {
    initialize();
  }
  return db;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
  db = null;
}

export type Database = NodePgDatabase<typeof schema>;
export * as schema from "../../drizzle/schema";
