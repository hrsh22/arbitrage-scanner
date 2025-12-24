import { nextJsConfig } from "@workspace/eslint-config/next-js";

/** @type {import("eslint").Linter.Config} */
export default [
  ...nextJsConfig,
  {
    ignores: [".next/**", "node_modules/**", "dist/**", ".turbo/**"],
  },
  {
    files: ["next.config.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
      },
    },
  },
];
