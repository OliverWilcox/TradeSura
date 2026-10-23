import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "_local-backup/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "lib/generated/**",
    // Separate Expo app with its own package.json/lint setup.
    "mobile/**",
  ]),
]);

export default eslintConfig;
