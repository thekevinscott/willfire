import stylistic from "@stylistic/eslint-plugin";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    files: ["src/**/*.ts"],
    extends: [tseslint.configs.base],
    plugins: { "@stylistic": stylistic },
    rules: {
      curly: ["error", "all"],
      "@stylistic/semi": ["error", "always"],
      "max-lines": ["error", { max: 100, skipBlankLines: true, skipComments: true }],
      "no-restricted-syntax": [
        "error",
        {
          selector: 'TSAsExpression > TSAsExpression[typeAnnotation.type="TSUnknownKeyword"]',
          message: "No casting through unknown. Fix the types instead.",
        },
        {
          selector: 'TSAsExpression > TSAsExpression[typeAnnotation.type="TSAnyKeyword"]',
          message: "No casting through any. Fix the types instead.",
        },
      ],
    },
  },
  {
    files: ["src/**/*.test.ts"],
    rules: {
      "max-lines": "off",
      "no-restricted-syntax": "off",
    },
  },
  {
    files: ["src/entries/jobName.ts"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
);
