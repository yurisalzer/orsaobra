import { expect, test, type Page } from "@playwright/test";
import ExcelJS from "exceljs";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { LINHAS_EXEMPLO } from "../importar-orcamento/exemplo";

const EMAIL = "importar.e2e@exemplo.com.br";
const SENHA = "SenhaForte2026";

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

test.beforeAll(() => {
  execSync("npx dotenv -e .env.test -- tsx tests/e2e/preparar-referencia.ts", { stdio: "inherit" });
  execSync(`npx dotenv -e .env.test -- tsx scripts/criar-admin.ts ${EMAIL} "Orçamentista Importação"`, { env: { ...process.env, ADMIN_SENHA: SENHA }, stdio: "inherit" });
});

async function entrar(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Início" })).toBeVisible();
}

async function planilhaExemplo(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Orçamento");
  for (const l of LINHAS_EXEMPLO) ws.addRow(l);
  ws.mergeCells("G8:H8");
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test("importa planilha .xlsx: colunas automáticas, dados de cadastro, conferência e gravação", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await entrar(page);
  await page.goto("/orcamentos");
  await page.getByRole("link", { name: "Importar orçamento" }).click();
  await expect(page.getByRole("heading", { name: "Importar orçamento" })).toBeVisible();
  await page.getByLabel(/Arquivo do orçamento/).setInputFiles({ name: "orcamento-escola.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: await planilhaExemplo() });

  // colunas identificadas
  await expect(page.getByLabel("Coluna de Código")).toHaveValue("2");
  await expect(page.getByLabel("Coluna de Quantidade")).toHaveValue("5");
  await expect(page.getByLabel("Coluna de Custo unitário (sem BDI)")).toHaveValue("6");
  await expect(page.getByRole("status")).toContainText("2 etapas e 3 itens");
  // o usuário pode trocar uma coluna (e desfazer)
  await page.getByLabel("Coluna de Unidade").selectOption("");
  await page.getByLabel("Coluna de Unidade").selectOption("4");
  await page.getByRole("button", { name: "Avançar" }).click();

  // dados de cadastro: identificados e o que falta
  await expect(page.getByLabel("Nome da obra")).toHaveValue("Reforma da Escola Municipal Aldo Silva");
  await expect(page.getByLabel("Processo")).toHaveValue("12.345/2026");
  await expect(page.getByLabel("Cidade")).toHaveValue("Macaé");
  await expect(page.getByLabel("Código da obra")).toHaveValue("");
  await page.getByLabel("Código da obra").fill("OB-500");
  await expect(page.getByLabel("Título")).toHaveValue("orcamento-escola");
  await page.getByLabel("Título").fill("Reforma da escola (importado)");
  await expect(page.getByLabel("Regime EMOP")).toHaveValue("SEM_DESONERACAO");
  await expect(page.getByText(/BDI no arquivo: 25,00%/)).toBeVisible();
  await page.getByRole("button", { name: "Conferir itens nas bases" }).click();

  // conferência: 2 encontrados, 1 não encontrado
  await expect(page.getByRole("status")).toContainText("2 de 3 itens serão importados");
  await expect(page.getByText("Não encontrado nas bases escolhidas")).toBeVisible();
  // corrigir o código inexistente para um que existe (e voltar)
  await page.getByRole("button", { name: "Corrigir código da linha 14" }).click();
  await page.getByLabel("Código da linha 14").fill("36178");
  await page.getByLabel("Código da linha 14").press("Enter");
  await expect(page.getByRole("status")).toContainText("3 de 3 itens serão importados");
  await page.getByRole("button", { name: "Corrigir código da linha 14" }).click();
  await page.getByLabel("Código da linha 14").fill("999999");
  await page.getByLabel("Código da linha 14").press("Enter");
  await expect(page.getByRole("status")).toContainText("2 de 3 itens serão importados");
  // não encontrado: incluir com preço informado (custo do arquivo já preenchido)
  await page.getByLabel("Incluir com preço informado — linha 14").check();
  await expect(page.getByLabel("Custo informado — linha 14")).toHaveValue("10");
  await expect(page.getByRole("status")).toContainText("3 de 3 itens serão importados (1 com preço informado)");
  await page.getByRole("button", { name: "Importar 3 itens" }).click();
  await expect(page.getByText("Orçamento importado: 3 itens gravados.")).toBeVisible();
  await page.getByRole("link", { name: "Abrir o orçamento" }).click();
  await expect(page.getByRole("heading", { name: "Reforma da escola (importado)" })).toBeVisible();
  await expect(page.getByLabel("Quantidade 1.1")).toHaveValue("4,00");
  await expect(page.getByLabel("Quantidade 2.1")).toHaveValue("1.234,50");
  // 4 × 211,97 + 1.234,5 × 194,45 + 2 × 10,00 = 847,88 + 240.048,53 + 20,00 (sem BDI)
  await expect(page.getByText("R$ 240.916,41").first()).toBeVisible();
  // item informado: selo, sem vínculo com a base, custo editável
  const informado = page.getByRole("row").filter({ has: page.getByLabel("Custo unitário 2.2") });
  await expect(informado).toContainText("INFORMADO");
  await expect(informado).toContainText("Preço informado pelo orçamentista");
  await page.getByLabel("Custo unitário 2.2").fill("12,50");
  await page.getByLabel("Custo unitário 2.2").press("Enter");
  await expect(page.getByText("R$ 240.921,41").first()).toBeVisible();
  await page.screenshot({ path: "test-results/importar-xlsx.png", fullPage: true });
});

test("importa de volta o PDF do orçamento sintético gerado pelo sistema", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await entrar(page);
  await page.goto("/orcamentos");
  await page.getByRole("link", { name: "Reforma da escola (importado)" }).click();
  await page.getByRole("link", { name: "Relatórios" }).click();
  const [pdf] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Baixar PDF — Orçamento sintético" }).click()]);
  const arquivo = readFileSync(await pdf.path());

  await page.goto("/orcamentos/importar");
  await page.getByLabel(/Arquivo do orçamento/).setInputFiles({ name: "sintetico.pdf", mimeType: "application/pdf", buffer: arquivo });
  await expect(page.getByRole("status")).toContainText("2 etapas e 3 itens");
  await page.getByRole("button", { name: "Avançar" }).click();
  // a obra já existe (mesmo código): o orçamento vai para ela
  await expect(page.getByLabel("Obra", { exact: true })).not.toHaveValue("");
  await expect(page.getByLabel("Título")).toHaveValue("Reforma da escola (importado)");
  await page.getByLabel("Título").fill("Cópia via PDF");
  await page.getByRole("button", { name: "Conferir itens nas bases" }).click();
  await expect(page.getByRole("status")).toContainText("2 de 3 itens serão importados");
  await page.getByRole("button", { name: "Incluir todos os não encontrados com preço informado" }).click();
  await expect(page.getByLabel("Custo informado — linha 14")).toHaveValue("12,50");
  await expect(page.getByRole("status")).toContainText("3 de 3 itens serão importados (1 com preço informado)");
  await page.getByRole("button", { name: "Importar 3 itens" }).click();
  await page.getByRole("link", { name: "Abrir o orçamento" }).click();
  await expect(page.getByRole("heading", { name: "Cópia via PDF" })).toBeVisible();
  await expect(page.getByText("R$ 240.921,41").first()).toBeVisible();
});
