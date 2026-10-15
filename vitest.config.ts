import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["tests/**/*.test.ts"],
    // testes de banco compartilham um único banco de teste: rodar em série
    fileParallelism: false,
    testTimeout: 30000,
  },
});
