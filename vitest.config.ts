import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "tools/**/*.test.ts",
      "tests/**/*.test.ts",
    ],
    globals: true,
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});
