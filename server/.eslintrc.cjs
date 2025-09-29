// eslint-disable-next-line @typescript-eslint/no-var-requires -- CommonJS config file
const path = require("node:path");

module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: path.resolve(__dirname, "tsconfig.eslint.json"),
    tsconfigRootDir: __dirname,
    sourceType: "module"
  },
  env: {
    es2022: true,
    node: true
  },
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking",
    "prettier"
  ],
  ignorePatterns: ["dist", "node_modules", "src/contracts/api-types.d.ts"],
  rules: {
    "@typescript-eslint/consistent-type-imports": "warn"
  },
  overrides: [
    {
      files: ["tests/**/*.ts"],
      rules: {
        "@typescript-eslint/no-unsafe-assignment": "off",
        "@typescript-eslint/no-unsafe-call": "off",
        "@typescript-eslint/no-unsafe-member-access": "off",
        "@typescript-eslint/no-unsafe-return": "off",
        "@typescript-eslint/require-await": "off"
      }
    }
  ]
};
