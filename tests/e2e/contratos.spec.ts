import { expect, test } from "@playwright/test";
import { execSync } from "node:child_process";
import ExcelJS from "exceljs";
import { mkdirSync } from "node:fs";

const EMAIL = "contratos.e2e@exemplo.com.br";
const SENHA = "SenhaForte2026";

test.setTimeout(120_000);
test.beforeAll(async () => {
  execSync(`npx dotenv -e .env.test -- tsx scripts/criar-admin.ts ${EMAIL} "Fiscal"`, { env: { ...process.env, ADMIN_SENHA: SENHA }, stdio: "inherit" });
  // planilha da proposta: grupos com subgrupo, preços com 2 e 4 casas e total do arquivo
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Proposta");
  ws.addRow(["Contrato 045/2023"]);
  ws.addRow(["Empreiteira: CONSÓRCIO EXEMPLO"]);
  ws.addRow([]);
  ws.addRow(["Item", "Código", "Descrição", "Unid.", "Quant.", "Preço Unit. (R$)", "Valor (R$)"]);
  ws.addRow(["1", null, "SERVIÇOS ADMINISTRATIVOS", null, null, null, 435200]);
  ws.addRow(["1.1", "01.090.0000-0", "INDICE GERAL P/ADMINISTRACAO LOCAL", "UN", 100, 4352, 435200]);
  ws.addRow(["2", null, "CANTEIRO DE OBRAS", null, null, null, 25200]);
  ws.addRow(["2.1", "02.006.0015-0", "ALUGUEL CONTAINER TIPO ESCRITORIO", "UNXMES", 12, 100, 1200]);
  ws.addRow(["2.2", "02.006.0020-0", "ALUGUEL CONTAINER TIPO SANITARIO", "UNXMES", 24, 1000.1234, 24002.96]);
  mkdirSync("test-results", { recursive: true });
  await wb.xlsx.writeFile("test-results/proposta.xlsx");
});

test("importa a planilha da proposta: preços idênticos ao arquivo, grupos e total", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.getByRole("link", { name: "Contratos", exact: true }).click();
  await page.getByRole("link", { name: "Importar planilha da proposta" }).click();
  await page.getByLabel("Arquivo da planilha (.xls, .xlsx ou .pdf)").setInputFiles("test-results/proposta.xlsx");
  await expect(page.getByRole("status")).toContainText("3 itens em 2 grupos");
  await expect(page.getByRole("status")).toContainText("R$ 460.402,96");
  await expect(page.getByLabel("Nº do contrato")).toHaveValue("045/2023");
  await expect(page.getByLabel("Empresa contratada")).toHaveValue("CONSÓRCIO EXEMPLO");
  await page.getByLabel("Nome da obra", { exact: true }).fill("Praça e CRAS no Miramar");
  await page.getByLabel("Objeto (nome da obra)").fill("CONSTRUÇÃO DE PRAÇA E CRAS NO MIRAMAR");
  await page.getByLabel("Endereço da obra").fill("Rua Exemplo, 100 — Miramar, Macaé/RJ");
  // prazos: términos calculados na hora (dias corridos, contando o início)
  await page.getByLabel("Data de assinatura").fill("2023-08-10");
  await page.getByLabel("Prazo contratual (dias)").fill("365");
  await page.getByLabel("Ordem de serviço (início)").fill("2023-08-14");
  await page.getByLabel("Prazo de execução (dias)").fill("660");
  await expect(page.getByText("Término da vigência: 08/08/2024")).toBeVisible();
  await expect(page.getByText("Término da execução: 03/06/2025")).toBeVisible();
  await expect(page.getByText("A execução termina depois do fim da vigência do contrato.")).toBeVisible();
  await page.getByLabel("Prazo contratual (dias)").fill("720");
  await expect(page.getByText("A execução termina depois do fim da vigência do contrato.")).toHaveCount(0);
  await page.getByLabel("Nome do responsável técnico").fill("Eng. Maria Souza");
  await page.getByLabel("ART / RRT").fill("ART RJ20230012345");
  await page.getByLabel("E-mail de contato").fill("obra@consorcio.com.br");
  await page.getByLabel("Telefone de contato").fill("22988887777");
  await page.getByRole("button", { name: "Criar contrato com 3 itens" }).click();
  await expect(page.getByRole("heading", { name: "Contrato 045/2023" })).toBeVisible();
  await expect(page.getByText(/planilha importada da proposta \(proposta\.xlsx\)/)).toBeVisible();
  await expect(page.getByText("Término da execução: 03/06/2025")).toBeVisible();
  await expect(page.getByText("Término da vigência: 29/07/2025")).toBeVisible();
  await expect(page.getByText("Eng. Maria Souza")).toBeVisible();
  await expect(page.getByText("obra@consorcio.com.br · (22) 98888-7777")).toBeVisible();
  await expect(page.getByRole("row", { name: /^2\.2 / })).toContainText("1.000,1234");
  await expect(page.getByRole("row", { name: /^2\.2 / })).toContainText("24.002,96");
  await expect(page.getByRole("row", { name: /TOTAL CONTRATADO/ })).toContainText("460.402,96");
  // preços da proposta não são editáveis
  await expect(page.getByLabel(/Preço contratado/)).toHaveCount(0);
  await page.screenshot({ path: "test-results/contrato-importado.png", fullPage: true });
  await page.getByRole("button", { name: "Excluir contrato" }).click();
  await expect(page.getByRole("heading", { name: "Contratos e medições" })).toBeVisible();
});
