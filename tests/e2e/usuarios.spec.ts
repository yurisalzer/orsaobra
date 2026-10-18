import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";

const ADMIN = "admin.usuarios@exemplo.com.br";
const SENHA = "SenhaForte2026";
const LEITOR = "leitor.teste@exemplo.com.br";
const SENHA_LEITOR = "Provisoria2026";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

test.beforeAll(() => {
  execSync("npx dotenv -e .env.test -- tsx tests/e2e/preparar-banco.ts", { stdio: "inherit" });
  execSync(`npx dotenv -e .env.test -- tsx scripts/criar-admin.ts ${ADMIN} "Admin Usuários"`, { env: { ...process.env, ADMIN_SENHA: SENHA }, stdio: "inherit" });
});

async function entrar(page: Page, email: string, senha: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(senha);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Início" })).toBeVisible();
}

test("administrador cadastra usuário e libera ou bloqueia recursos pelas caixas", async ({ page, browser }) => {
  page.on("dialog", (d) => d.accept());
  await entrar(page, ADMIN, SENHA);
  await page.getByRole("link", { name: "Usuários", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Usuários e permissões" })).toBeVisible();
  // a própria permissão de administrador não pode ser retirada
  await expect(page.getByLabel("Usuários e permissões — Admin Usuários")).toBeDisabled();
  await expect(page.getByLabel("Ativo — Admin Usuários")).toBeDisabled();

  await page.getByRole("button", { name: "Novo usuário" }).click();
  await page.getByLabel("Nome").fill("Leitor Teste");
  await page.getByLabel("E-mail").fill(LEITOR);
  await page.getByLabel(/Senha provisória/).fill(SENHA_LEITOR);
  await page.getByLabel("Permissões iniciais").selectOption("Leitor");
  await page.getByRole("button", { name: "Criar usuário" }).click();
  await expect(page.getByLabel("Consulta de preços — Leitor Teste")).toBeChecked();
  await expect(page.getByLabel("Editar orçamentos — Leitor Teste")).not.toBeChecked();
  await expect(page.getByLabel("Importação de bases — Leitor Teste")).not.toBeChecked();

  // o leitor entra: menu e páginas restritos
  const ctx = await browser.newContext();
  const leitor = await ctx.newPage();
  await entrar(leitor, LEITOR, SENHA_LEITOR);
  const menu = leitor.getByRole("navigation");
  await expect(menu.getByRole("link", { name: "Orçamentos" })).toBeVisible();
  await expect(menu.getByRole("link", { name: "Importação" })).toHaveCount(0);
  await expect(menu.getByRole("link", { name: "Usuários", exact: true })).toHaveCount(0);
  await expect(menu.getByRole("link", { name: "BDI" })).toHaveCount(0);
  await leitor.goto("/orcamentos");
  await expect(leitor.getByRole("link", { name: "Novo orçamento" })).toHaveCount(0);
  await leitor.goto("/orcamentos/novo");
  await expect(leitor.getByRole("heading", { name: "Acesso não liberado" })).toBeVisible();
  await expect(leitor.getByText("“Editar orçamentos”")).toBeVisible();
  await leitor.goto("/usuarios");
  await expect(leitor.getByRole("heading", { name: "Acesso não liberado" })).toBeVisible();

  // o administrador marca "Editar orçamentos" e desmarca "Consulta de preços"
  await page.getByLabel("Editar orçamentos — Leitor Teste").check();
  await expect(page.getByLabel("Editar orçamentos — Leitor Teste")).toBeChecked();
  await page.getByLabel("Consulta de preços — Leitor Teste").uncheck();
  await expect(page.getByLabel("Consulta de preços — Leitor Teste")).not.toBeChecked();
  await page.reload();
  await expect(page.getByLabel("Editar orçamentos — Leitor Teste")).toBeChecked();
  await expect(page.getByLabel("Consulta de preços — Leitor Teste")).not.toBeChecked();
  await page.screenshot({ path: "test-results/usuarios.png", fullPage: true });

  // vale na próxima página aberta pelo usuário
  await leitor.goto("/orcamentos");
  await expect(leitor.getByRole("link", { name: "Novo orçamento" })).toBeVisible();
  await expect(leitor.getByRole("navigation").getByRole("link", { name: "Consulta de preços" })).toHaveCount(0);
  await leitor.goto("/consulta");
  await expect(leitor.getByRole("heading", { name: "Acesso não liberado" })).toBeVisible();

  // desativar encerra o acesso
  await page.getByLabel("Ativo — Leitor Teste").uncheck();
  await expect(page.getByLabel("Ativo — Leitor Teste")).not.toBeChecked();
  await leitor.goto("/orcamentos");
  await expect(leitor).toHaveURL(/\/login/);
  await ctx.close();
});
