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
    ignores: ["dist/**", "src-tauri/**", "node_modules/**", "public/**", "packaging/**", "infra/**", "coverage/**"],
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
);
