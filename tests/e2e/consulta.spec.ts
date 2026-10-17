import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";

const EMAIL = "orcamentista.e2e@exemplo.com.br";
const SENHA = "SenhaForte2026";

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  execSync("npx dotenv -e .env.test -- tsx tests/e2e/preparar-referencia.ts", { stdio: "inherit" });
  execSync(`npx dotenv -e .env.test -- tsx scripts/criar-admin.ts ${EMAIL} "Orçamentista E2E"`, { env: { ...process.env, ADMIN_SENHA: SENHA }, stdio: "inherit" });
});

async function entrar(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Início" })).toBeVisible();
}

test("busca por código e analítica oficial EMOP", async ({ page }) => {
  await entrar(page);
  await page.goto("/consulta");
  await page.getByLabel("Buscar").fill("01.001.0001");
  await page.getByRole("button", { name: "Buscar" }).click();
  const linha = page.getByRole("row", { name: /01\.001\.0001-0/ });
  await expect(linha).toContainText("LIMITE DE PLASTICIDADE");
  await expect(linha).toContainText("R$ 211,97");
  await linha.getByRole("link", { name: "01.001.0001-0" }).click();
  await expect(page.getByRole("heading", { name: /Composição analítica publicada pela fonte — EMOP RJ 09\/2026/ })).toBeVisible();
  await expect(page.getByText("Preço publicado (valor oficial)")).toBeVisible();
  await expect(page.getByRole("row", { name: /02083/ })).toBeVisible();
});

test("busca sem acento, troca de regime e analítica SINAPI com subcomposição", async ({ page }) => {
  await entrar(page);
  await page.goto("/consulta?q=podotatil&tipo=COMPOSICAO");
  await page.getByRole("link", { name: "104658" }).first().click();
  await expect(page.getByRole("row", { name: /88316/ })).toContainText("SERVENTE");
  const semDes = await page.locator("dd").filter({ hasText: "Encargos sociais sem desoneração" }).innerText();
  await page.getByLabel("Regime SINAPI").selectOption("COM_DESONERACAO");
  await page.getByRole("button", { name: "Aplicar" }).click();
  await expect(page.locator("dd").filter({ hasText: "Encargos sociais com desoneração" })).toBeVisible();
  expect(semDes).not.toEqual(await page.locator("dd").filter({ hasText: "com desoneração" }).innerText());
  await page.screenshot({ path: "test-results/consulta-analitica.png", fullPage: true });
});

test("buscar com o campo vazio lista todos os itens", async ({ page }) => {
  await entrar(page);
  await page.goto("/consulta");
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page.getByText(/\d+ resultado\(s\)/)).toBeVisible();
  await expect(page.getByRole("row", { name: /01\.001\.0001-0/ })).toBeVisible();
  await page.getByLabel("Fonte").selectOption("SINAPI");
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page.getByRole("row", { name: /104658/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /01\.001\.0001-0/ })).toHaveCount(0);
});

test("composição sem custo publicada não vira zero", async ({ page }) => {
  await entrar(page);
  await page.goto("/consulta?q=105006");
  await expect(page.getByRole("row", { name: /105006/ })).toContainText("sem preço");
});

test("cria insumo próprio, registra cotação e monta composição própria mista", async ({ page }) => {
  await entrar(page);
  await page.goto("/composicoes/nova?tipo=INSUMO");
  await page.getByLabel("Código").fill("P-ANDAIME");
  await page.getByLabel("Descrição").fill("Andaime tubular (locação)");
  await page.getByLabel("Unidade").fill("MES");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByRole("heading", { name: /P-ANDAIME/ })).toBeVisible();
  await expect(page.getByText("próprio — não oficial")).toBeVisible();
  await page.getByLabel("Data", { exact: true }).fill("2026-09-10");
  await page.getByLabel("Valor (R$)").fill("50,25");
  await page.getByLabel("Fonte da cotação").fill("Fornecedor X");
  await page.getByRole("button", { name: "Registrar cotação" }).click();
  await expect(page.getByRole("row", { name: /10\/09\/2026/ })).toContainText("R$ 50,25");

  await page.goto("/composicoes/nova?tipo=COMPOSICAO");
  await page.getByLabel("Código").fill("P-SERV-01");
  await page.getByLabel("Descrição").fill("Ensaio com andaime");
  await page.getByLabel("Unidade").fill("UN");
  await page.getByLabel("Buscar componente").fill("01.001.0001");
  await page.getByRole("option", { name: /01\.001\.0001-0/ }).click();
  await page.getByLabel("Coeficiente de 01.001.0001-0").fill("2");
  await page.getByLabel("Buscar componente").fill("andaime");
  await page.getByRole("option", { name: /P-ANDAIME/ }).click();
  await page.getByLabel("Coeficiente de P-ANDAIME").fill("1");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByRole("heading", { name: /Composição própria \(não oficial\) — versão 1/ })).toBeVisible();
  // 2 × 211,97 + 1 × 50,25 = 474,19
  await expect(page.getByText("Custo calculado da composição própria")).toBeVisible();
  await expect(page.locator("dd").filter({ hasText: "R$ 474,19" }).first()).toBeVisible();
  await page.screenshot({ path: "test-results/composicao-propria.png", fullPage: true });

  // editar gera versão 2; código oficial é recusado
  await page.getByRole("link", { name: "Editar item próprio" }).click();
  await page.getByLabel("Código").fill("01.001.0001-0");
  await page.getByRole("button", { name: "Salvar nova versão" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(/base oficial EMOP/);
  await page.getByLabel("Código").fill("P-SERV-01");
  await page.getByLabel("Coeficiente de P-ANDAIME").fill("3");
  await page.getByRole("button", { name: "Salvar nova versão" }).click();
  await expect(page.getByRole("heading", { name: /versão 2/ })).toBeVisible();
  await expect(page.locator("dd").filter({ hasText: "R$ 574,69" }).first()).toBeVisible();
});
