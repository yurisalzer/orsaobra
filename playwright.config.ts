import { defineConfig } from "@playwright/test";

// Testes de ponta a ponta contra a aplicação compilada, usando o banco de teste.
const PORTA = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  use: { baseURL: `http://localhost:${PORTA}`, locale: "pt-BR" },
  webServer: {
    command: `npx dotenv -e .env.test -- next start -p ${PORTA}`,
    url: `http://localhost:${PORTA}/api/saude`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
