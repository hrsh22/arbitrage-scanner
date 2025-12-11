import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core"

export const example = pgTable("example", {
  id: serial("id").primaryKey(),
  name: text("name"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})
