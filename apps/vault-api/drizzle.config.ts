import type { Config } from "drizzle-kit";
import "dotenv/config";

function withSslMode(url: string): string {
  if (!url) return url;

  if (process.env.DATABASE_SSL !== "true") {
    return url;
  }

  // If ssl/sslmode is already present, don't modify
  if (/[?&](ssl|sslmode)=/i.test(url)) {
    return url;
  }

  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}sslmode=require`;
}

const baseUrl = process.env.VAULT_DATABASE_URL ?? process.env.DATABASE_URL ?? "";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: withSslMode(baseUrl),
  },
} satisfies Config;
