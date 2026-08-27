import { spawn } from "child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const litWarningBootstrap = path.join(__dirname, "suppress-lit-warning.mjs");
const nodeOptions = [process.env.NODE_OPTIONS, `--import=${litWarningBootstrap}`]
  .filter(Boolean)
  .join(" ");

const mockApi = spawn("node", ["./e2e/mock-api-server.mjs"], {
  stdio: "inherit",
});

const nextDev = spawn("pnpm", ["dev"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    NODE_OPTIONS: nodeOptions,
    NEXT_PUBLIC_API_URL: "http://127.0.0.1:8081",
  },
});

const shutdown = () => {
  mockApi.kill("SIGTERM");
  nextDev.kill("SIGTERM");
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

mockApi.on("exit", (code) => {
  if (code && code !== 0) {
    nextDev.kill("SIGTERM");
    process.exit(code);
  }
});

nextDev.on("exit", (code) => {
  mockApi.kill("SIGTERM");
  process.exit(code ?? 0);
});
