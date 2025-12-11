import dotenv from "dotenv"
import express from "express"

dotenv.config()

const app = express()

app.use(express.json())

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    uptime: process.uptime(),
  })
})

const port = Number(process.env.PORT) || 8080
const host = process.env.HOST || "0.0.0.0"

app.listen(port, host, () => {
  console.log(`API listening on http://${host}:${port}`)
})
