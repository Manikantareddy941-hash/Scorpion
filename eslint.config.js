import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettierConfig from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "backend/**",
      "engine/**",
      "scorpion-vscode/**",
      "src-backup/**",
      "node_modules/**",
      "project/**",
      "scripts/**",
      "print_tree.cjs",
      // Vendored / scaffold / tooling dirs — not app source. Linting these
      // pulled in a bundled Obsidian plugin (main.js) that produced 27 phantom
      // errors and kept frontend CI red.
      ".obsidian/**",
      ".bolt/**",
      "graphify-out/**",
      "starter-for-react/**",
      "Stackpilot/**",
      "Stitch_Screens/**",
      "examples/**",
      "functions/**",
      "public/**"
    ]
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,js,jsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      "react-hooks/rules-of-hooks": "off",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-expressions": "off",
    },
  },
  prettierConfig
);