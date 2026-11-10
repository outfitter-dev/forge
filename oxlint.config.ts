import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";

export default defineConfig({
  env: { browser: false, node: true },
  extends: [core],
  globals: { Bun: "readonly" },
  ignorePatterns: [...(core.ignorePatterns ?? []), "dist/**", "coverage/**"],
});
