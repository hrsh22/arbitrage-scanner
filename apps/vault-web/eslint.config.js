import { nextJsConfig } from "@workspace/eslint-config/next-js";

export default [
  ...nextJsConfig,
  {
    ignores: [".next/**", "node_modules/**", "dist/**", ".turbo/**"],
  },
  {
    files: ["next.config.js"],
    languageOptions: {
      globals: {
        process: "readonly",
      },
    },
  },
];
