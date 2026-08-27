import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

const connectionString = process.env.VAULT_DATABASE_URL || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("VAULT_DATABASE_URL or DATABASE_URL is not set");
}

const pool = new Pool({
  connectionString,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});

export const db = drizzle(pool, { schema });

export { pool };

