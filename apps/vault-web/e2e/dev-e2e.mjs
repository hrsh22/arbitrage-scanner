import { spawn } from "child_process";

const mockApi = spawn("node", ["./e2e/mock-api-server.mjs"], {
  stdio: "inherit",
});

const nextDev = spawn("pnpm", ["dev"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
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
