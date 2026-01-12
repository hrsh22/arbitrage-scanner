import type { Config } from "drizzle-kit";

export default {
  schema: ["./src/db/schema.ts", "./src/db/botSchema.ts", "./src/db/analyticsSchema.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
} satisfies Config;
