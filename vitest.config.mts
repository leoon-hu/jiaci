import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // 与 tsconfig 的 paths 对齐：没有这条，凡是引 @/... 的模块（client/*、components/*）都没法进测试（审计 F158）
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
