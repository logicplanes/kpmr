import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.ts"],
    environment: "node",
    maxWorkers: 2,
    coverage: {
      provider: "v8",
      include: ["src/server/**/*.ts", "src/registry/**/*.ts"],
      exclude: ["**/*.test.ts", "src/server/test/**", "src/server/main.ts", "src/server/app.ts"],
      reporter: ["text-summary", "json-summary"],
      thresholds: { statements: 90, branches: 80, functions: 90, lines: 90 },
    },
  },
});
