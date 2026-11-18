// ESLint flat config. Tooling only: the goal is to catch hook-dependency
// mistakes (react-hooks) and obvious TypeScript issues without forcing a mass
// rewrite of existing source. exhaustive-deps starts as a warning and will be
// promoted to an error once the existing warnings are fixed or justified.
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "src-tauri/**", "node_modules/**", "public/**", "packaging/**", "infra/**", "coverage/**", ".claude/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node-side files: build scripts and root-level tool configs.
    files: ["scripts/**/*.{js,mjs,cjs}", "*.{js,mjs,cjs,ts}"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // Recommended rules that the existing source already trips. Kept as
      // warnings so the lint step passes without rewriting source in the
      // tooling change; tighten to errors as each is cleaned up.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",
      "@typescript-eslint/no-this-alias": "warn",
      "prefer-const": "warn",
      "no-useless-assignment": "warn",
      "no-useless-escape": "warn",
    },
  },
  {
    // Platform-free engine (refactor card P3-04). src/engine depends only on
    // the port interfaces in src/engine/ports.ts; the Tauri-backed adapters
    // live in src/platform/enginePorts.ts and are installed by src/main.tsx.
    files: ["src/engine/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          {
            group: ["@tauri-apps/*"],
            message: "src/engine must stay platform-free: depend on a port in src/engine/ports.ts and implement it in src/platform/enginePorts.ts.",
          },
          {
            regex: "(^|/)platform(/|$)",
            message: "src/engine must not import src/platform: take a port from src/engine/ports.ts instead.",
          },
        ],
      }],
    },
  },
);
