import type { Config } from "drizzle-kit";

export default {
  schema: ["./src/db/schema.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.VAULT_DATABASE_URL ?? "",
  },
} satisfies Config;
