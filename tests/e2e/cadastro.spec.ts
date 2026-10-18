import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";

const ADMIN = "admin.cadastro@exemplo.com.br";
const SENHA_ADMIN = "SenhaForte2026";
const NOVO = "maria.souza@exemplo.com.br";
const SENHA = "MinhaSenha2026";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const ultimoEmail = (para: string, motivo: string) =>
  execSync(`npx dotenv -e .env.test -- tsx tests/e2e/ler-email.ts ${para} ${motivo}`).toString();

test.beforeAll(() => {
  execSync("npx dotenv -e .env.test -- tsx tests/e2e/preparar-banco.ts", { stdio: "inherit" });
  execSync(`npx dotenv -e .env.test -- tsx scripts/criar-admin.ts ${ADMIN} "Admin Cadastro"`, { env: { ...process.env, ADMIN_SENHA: SENHA_ADMIN }, stdio: "inherit" });
});

async function tentarEntrar(page: Page, email: string, senha: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(senha);
  await page.getByRole("button", { name: "Entrar" }).click();
}

test("cadastro pela tela de login, confirmação por e-mail e liberação pelo administrador", async ({ page, browser }) => {
  await page.goto("/login");
  await page.getByRole("link", { name: "Criar conta" }).click();
  await expect(page.getByRole("heading", { name: "Criar conta" })).toBeVisible();

  await page.getByLabel("Nome completo").fill("Maria Souza");
  await page.getByLabel("E-mail").fill(NOVO);
  await page.getByLabel("CPF").fill("52998224724"); // dígito errado
  await page.getByLabel(/^Senha/).fill(SENHA);
  await page.getByLabel("Confirme a senha").fill(SENHA);
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.locator("main").getByRole("alert")).toHaveText(/CPF inválido/);
  // os campos continuam preenchidos; a máscara formata o CPF
  await expect(page.getByLabel("Nome completo")).toHaveValue("Maria Souza");
  await page.getByLabel("CPF").fill("52998224725");
  await expect(page.getByLabel("CPF")).toHaveValue("529.982.247-25");
  await page.getByLabel(/^Telefone/).fill("21987654321");
  await expect(page.getByLabel(/^Telefone/)).toHaveValue("(21) 98765-4321");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.locator("main").getByRole("status")).toContainText("Cadastro recebido");
  await expect(page.locator("main").getByRole("status")).toContainText(NOVO);

  // antes de confirmar o e-mail: não entra, e a tela oferece reenviar
  await tentarEntrar(page, NOVO, SENHA);
  await expect(page.locator("form").getByRole("alert")).toContainText("Confirme o seu e-mail");
  await expect(page.getByRole("link", { name: "Reenviar o e-mail de confirmação" })).toBeVisible();

  // abre o link do e-mail
  const link = /https?:\/\/\S+\/cadastro\/confirmar\?token=[\w-]+/.exec(ultimoEmail(NOVO, "CONFIRMACAO"))![0];
  await page.goto(new URL(link).pathname + new URL(link).search);
  await expect(page.locator("main").getByRole("status")).toContainText("E-mail confirmado");

  // confirmado, mas ainda sem liberação
  await tentarEntrar(page, NOVO, SENHA);
  await expect(page.locator("form").getByRole("alert")).toContainText("aguarda a liberação do acesso pelo administrador");
  expect(ultimoEmail(ADMIN, "NOVO_CADASTRO")).toContain("Maria Souza");

  // o administrador libera
  const ctx = await browser.newContext();
  const adm = await ctx.newPage();
  adm.on("dialog", (d) => d.accept());
  await tentarEntrar(adm, ADMIN, SENHA_ADMIN);
  await expect(adm.getByRole("heading", { name: "Início" })).toBeVisible();
  await adm.goto("/usuarios");
  await expect(adm.getByText("1 cadastro aguarda a liberação")).toBeVisible();
  await expect(adm.getByText("CPF 529.982.247-25 · Tel. (21) 98765-4321")).toBeVisible();
  await adm.getByLabel("Consulta de preços — Maria Souza").check();
  await expect(adm.getByLabel("Consulta de preços — Maria Souza")).toBeChecked();
  await adm.getByLabel("Ativo — Maria Souza").check();
  await expect(adm.getByRole("status").filter({ hasText: "liberado" })).toBeVisible();
  await expect(adm.getByText("Acesso liberado — Orçamento de Obras")).toBeVisible(); // caixa de saída
  await ctx.close();

  await tentarEntrar(page, NOVO, SENHA);
  await expect(page.getByRole("heading", { name: "Início" })).toBeVisible();
  const menu = page.getByRole("navigation");
  await expect(menu.getByRole("link", { name: "Consulta" })).toBeVisible();
  await expect(menu.getByRole("link", { name: "Importação" })).toHaveCount(0);
});

test("reenviar confirmação responde sem revelar se o e-mail existe", async ({ page }) => {
  await page.goto("/cadastro/reenviar");
  await page.getByLabel("E-mail").fill("nao.existe@exemplo.com.br");
  await page.getByRole("button", { name: "Reenviar e-mail" }).click();
  await expect(page.locator("main").getByRole("status")).toContainText("Se houver um cadastro aguardando confirmação");
});
