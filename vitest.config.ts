import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    root: ".",
    include: ["src/**/*.test.ts"],
    globals: true,
    coverage: {
      reporter: ["text", "lcov", "html"],
    },
  },
  resolve: {
    alias: {
      // Mock the vscode module for unit testing
      vscode: path.resolve(__dirname, "src/__mocks__/vscode.ts"),
    },
  },
});
