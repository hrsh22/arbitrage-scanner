import "dotenv/config"
import express from "express"
import { db, pool } from "./db/client.js"

const app = express()

app.use(express.json())

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    uptime: process.uptime(),
  })
})

app.get("/health/db", async (_req, res) => {
  try {
    await db.execute("select 1")
    res.status(200).json({ status: "ok" })
  } catch (error) {
    res.status(500).json({ status: "error", error: (error as Error).message })
  }
})

const port = Number(process.env.PORT) || 8080
const host = process.env.HOST || "0.0.0.0"

app.listen(port, host, () => {
  console.log(`API listening on http://${host}:${port}`)
})

process.on("SIGTERM", async () => {
  await pool.end()
  process.exit(0)
})

process.on("SIGINT", async () => {
  await pool.end()
  process.exit(0)
})
