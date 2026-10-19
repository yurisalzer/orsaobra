import { expect, test } from "@playwright/test";
import { execSync } from "node:child_process";

const EMAIL = "contato.e2e@exemplo.com.br";
const SENHA = "SenhaForte2026";

test.beforeAll(() => {
  execSync(`npx dotenv -e .env.test -- tsx scripts/criar-admin.ts ${EMAIL} "Pessoa Contato"`, { env: { ...process.env, ADMIN_SENHA: SENHA }, stdio: "inherit" });
});

test("aba Contato envia a solicitação por e-mail", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.getByRole("navigation").getByRole("link", { name: "Contato" }).click();
  await expect(page.getByRole("heading", { name: "Contato" })).toBeVisible();
  await expect(page.getByLabel("Nome")).toHaveValue("Pessoa Contato");
  await expect(page.getByLabel("E-mail")).toHaveValue(EMAIL);
  await page.getByLabel("Contato", { exact: true }).fill("21987654321");
  await expect(page.getByLabel("Contato", { exact: true })).toHaveValue("(21) 98765-4321");
  await page.getByRole("button", { name: "Enviar solicitação" }).click();
  // campos obrigatórios do navegador: módulo e mensagem
  await expect(page.getByRole("status")).toHaveCount(0);
  await page.getByLabel("Módulo").selectOption("Relatórios");
  await page.getByLabel("Mensagem").fill("O relatório de curva ABC poderia ter gráfico?");
  await page.getByRole("button", { name: "Enviar solicitação" }).click();
  await expect(page.getByRole("status")).toContainText("Solicitação enviada");
  await expect(page.getByLabel("Mensagem")).toHaveValue("");
  const texto = execSync(`npx dotenv -e .env.test -- tsx tests/e2e/ler-email.ts yurisalzer@gmail.com CONTATO`).toString();
  expect(texto).toContain("Módulo: Relatórios");
  expect(texto).toContain("curva ABC");
});
