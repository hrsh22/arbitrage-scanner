import { nextJsConfig } from "@workspace/eslint-config/next-js";

export default [
  ...nextJsConfig,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "dist/**",
      ".turbo/**",
      "out/**",
      "playwright-report/**",
      "test-results/**",
    ],
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
