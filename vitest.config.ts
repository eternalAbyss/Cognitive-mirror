import { defineConfig } from "vitest/config";

/**
 * One root config rather than per-package ones: every package's tests are plain
 * Node with no environment setup, so splitting the config would add files
 * without adding meaning.
 */
export default defineConfig({
  test: {
    include: ["{apps,packages}/*/test/**/*.test.ts"],
    // The visualiser is a Next app whose only real logic is the WebGL engine,
    // which needs a GPU context to say anything useful. It is verified by
    // running it, not by unit tests.
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["{apps,packages}/*/src/**/*.ts"],
      exclude: [
        // Entrypoints wire things together and are covered by running them.
        "**/src/index.ts",
        "**/src/stdio.ts",
        "**/dist/**",
      ],
    },
  },
});
