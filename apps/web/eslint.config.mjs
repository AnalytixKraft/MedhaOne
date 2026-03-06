import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
  globalIgnores([
    ".next/**",
    ".next_stale*/**",
    "node_modules/**",
    "out/**",
    "e2e/**",
    "e2e/reports/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);
