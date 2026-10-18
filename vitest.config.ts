import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "src"),
      "@contracts": path.resolve(templateRoot, "contracts"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
      "@db": path.resolve(templateRoot, "db"),
    },
  },
  test: {
    environment: "node",
    // api/ holds the backend; src/lib/ holds framework-free frontend helpers
    // (gesture maths, formatting) that are worth testing without a DOM.
    include: ["api/**/*.test.ts", "api/**/*.spec.ts", "src/lib/**/*.test.ts"],
  },
});
