import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import prettierConfig from "eslint-config-prettier";
import globals from "globals";

export default [
    {
        ignores: ["dist", "node_modules"],
    },
    {
        files: ["src/**/*.ts", "scripts/**/*.ts"],
        languageOptions: {
            parser: tsparser,
            ecmaVersion: 2020,
            sourceType: "module",
            globals: globals.node,
            parserOptions: {
                project: "./tsconfig.json",
            },
        },
        plugins: {
            "@typescript-eslint": tseslint,
        },
        rules: {
            ...tseslint.configs.recommended.rules,
            "no-console": "off",
            "@typescript-eslint/no-explicit-any": "warn",
            "@typescript-eslint/no-unused-vars": [
                "warn",
                { "argsIgnorePattern": "^_" }
            ],
        },
    },
    prettierConfig,
];
