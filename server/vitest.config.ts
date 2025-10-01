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
      provider: "istanbul",
      reporter: ["text", "lcov"],
      include: [normalizeGlob("src/**/*.ts")],
      exclude: [
        normalizeGlob("src/contracts/**"),
        normalizeGlob("src/index.ts")
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
