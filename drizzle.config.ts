import { defineConfig } from "drizzle-kit";
import "dotenv/config";

const url =
  process.env.POSTGRES_URL_NON_POOLING ??
  process.env.POSTGRES_URL ??
  process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    "Missing database connection string. Set POSTGRES_URL_NON_POOLING, POSTGRES_URL, or DATABASE_URL."
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./drizzle/schema.ts",
  out: "./drizzle/migrations",
  dbCredentials: {
    url,
  },
  strict: true,
});
