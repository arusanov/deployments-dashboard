import { defineConfig, globalIgnores } from "eslint/config";
import next from "eslint-config-next/core-web-vitals";
import tseslint from "typescript-eslint";
import unicorn from "eslint-plugin-unicorn";
import prettier from "eslint-config-prettier";

export default defineConfig(
  globalIgnores([
    ".next/**",
    "src/api/generated/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
  ]),
  ...next,
  {
    files: ["**/*.ts", "**/*.tsx"],
    extends: [
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true },
      ],
      "@typescript-eslint/no-confusing-void-expression": [
        "error",
        { ignoreArrowShorthand: true },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-import-type-side-effects": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
    },
  },
  {
    ...unicorn.configs.recommended,
    files: ["src/**/*.ts", "src/**/*.tsx"],
    rules: {
      ...unicorn.configs.recommended.rules,
      // Null is part of the backend PATCH and nuqs URL contracts.
      "unicorn/no-null": "off",
      // API names such as id, db and q are deliberately preserved.
      "unicorn/prevent-abbreviations": "off",
    },
  },
  {
    rules: {
      eqeqeq: ["error", "always"],
      "no-console": "error",
      "prefer-template": "error",
      "object-shorthand": "error",
    },
  },
  prettier,
  { rules: { curly: ["error", "all"] } },
);
