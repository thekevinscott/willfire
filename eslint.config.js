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
    },
  },
  {
    files: ["src/**/*.test.ts"],
    rules: {
      "max-lines": "off",
    },
  },
);
