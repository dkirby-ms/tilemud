import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const rootDir = fileURLToPath(new URL("./", import.meta.url));
const normalizeGlob = (pattern: string) => pattern.replace(/\\/g, "/");


export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: [normalizeGlob(resolve(rootDir, "tests/**/*.spec.ts"))],
    setupFiles: [normalizeGlob(resolve(rootDir, "tests/setup.ts"))],
    coverage: {
      reporter: ["text", "lcov"],
      include: [normalizeGlob(resolve(rootDir, "src/**/*.ts"))],
      exclude: [
        normalizeGlob(resolve(rootDir, "src/contracts/**")),
        normalizeGlob(resolve(rootDir, "src/index.ts"))
      ]
    },
    watch: false
  },
  resolve: {
    alias: {
      "@@": resolve(rootDir, "src")
    }
  },
  root: rootDir
});
