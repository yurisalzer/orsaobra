import { expect, test } from "@playwright/test";
import { execSync } from "node:child_process";

const EMAIL = "admin.e2e@exemplo.com.br";
const SENHA = "SenhaForte2026";

test.beforeAll(() => {
  execSync(`npx dotenv -e .env.test -- tsx scripts/criar-admin.ts ${EMAIL} "Admin E2E"`, {
    env: { ...process.env, ADMIN_SENHA: SENHA },
    stdio: "inherit",
  });
});

test("sem sessão, redireciona para o login", async ({ page }) => {
  await page.goto("/orcamentos");
  await expect(page).toHaveURL(/\/login$/);
});

test("cookie forjado não dá acesso", async ({ page, context }) => {
  await context.addCookies([{ name: "sessao", value: "forjado", url: "http://localhost:3100" }]);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});

test("senha errada mostra erro", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill("errada12345");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("E-mail ou senha inválidos.");
});

test("login, tela inicial e saída", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Início" })).toBeVisible();
  await expect(page.getByText("Admin E2E · Administrador")).toBeVisible();
  await expect(page.getByRole("link", { name: "Importação" })).toBeVisible();
  const cookie = (await page.context().cookies()).find((c) => c.name === "sessao");
  expect(cookie?.httpOnly).toBe(true);
  await page.screenshot({ path: "test-results/tela-inicial.png", fullPage: true });
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});
