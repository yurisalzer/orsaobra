import { expect, test } from "@playwright/test";
import { execSync } from "node:child_process";
import ExcelJS from "exceljs";
import { mkdirSync } from "node:fs";

const EMAIL = "contratos.e2e@exemplo.com.br";
const SENHA = "SenhaForte2026";

test.setTimeout(120_000);
test.describe.configure({ mode: "serial" });

async function entrarComo(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Início" })).toBeVisible();
}
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

test("cadastro de empresa com responsáveis técnicos", async ({ page }) => {
  await entrarComo(page);
  await page.getByRole("navigation").getByRole("button", { name: "Cadastros" }).click();
  await page.getByRole("menuitem", { name: "Empresas" }).click();
  await page.getByRole("link", { name: "Nova empresa" }).click();
  await page.getByLabel("Razão social *").fill("CONSÓRCIO EXEMPLO");
  await page.getByLabel("CNPJ *").fill("19.378.246/0001-21");
  await page.getByLabel("Município").fill("Macaé");
  await page.getByLabel("Nome do responsável técnico 1").fill("Eng. Maria Souza");
  await page.getByLabel("Registro no conselho 1").fill("2012345678");
  await page.getByLabel("E-mail do responsável técnico 1").fill("maria@consorcio.com.br");
  await page.getByLabel("Telefone do responsável técnico 1").fill("22988887777");
  await page.getByRole("button", { name: "Cadastrar empresa" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("CNPJ inválido");
  await page.getByLabel("CNPJ *").fill("19.378.246/0001-20");
  await page.getByRole("button", { name: "+ responsável técnico" }).click();
  await page.getByLabel("Nome do responsável técnico 2").fill("Arq. Pedro Lima");
  await page.getByLabel("Conselho 2", { exact: true }).selectOption("CAU");
  await page.getByLabel("Registro no conselho 2").fill("A123456-7");
  await page.getByRole("button", { name: "Cadastrar empresa" }).click();
  await expect(page.getByRole("heading", { name: "CONSÓRCIO EXEMPLO" })).toBeVisible();
  await expect(page.getByLabel("Nome do responsável técnico 2")).toHaveValue("Arq. Pedro Lima");
  await page.screenshot({ path: "test-results/empresa.png", fullPage: true });
  await page.getByRole("link", { name: "Empresas" }).first().click();
  await expect(page.getByRole("row", { name: /CONSÓRCIO EXEMPLO/ })).toContainText("Eng. Maria Souza — CREA 2012345678/RJ");
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
  // empresa cadastrada preenche razão social, CNPJ e responsável técnico
  await page.getByLabel("Empresa cadastrada").selectOption({ label: "CONSÓRCIO EXEMPLO — CNPJ 19.378.246/0001-20" });
  await expect(page.getByLabel("CNPJ", { exact: true })).toHaveValue("19.378.246/0001-20");
  await expect(page.getByLabel("Nome do responsável técnico")).toHaveValue("Eng. Maria Souza");
  await page.getByLabel("Responsável técnico da empresa").selectOption({ label: "Arq. Pedro Lima — CAU A123456-7/RJ" });
  await expect(page.getByLabel("Nome do responsável técnico")).toHaveValue("Arq. Pedro Lima");
  await page.getByLabel("Responsável técnico da empresa").selectOption({ label: "Eng. Maria Souza — CREA 2012345678/RJ (principal)" });
  await page.getByLabel("Objeto (nome da obra)").fill("CONSTRUÇÃO DE PRAÇA E CRAS NO MIRAMAR");
  await page.getByLabel("Nº do processo").fill("SEI-045/2023");
  // regime de execução: os 7 da lei e cadastro de um novo
  await page.getByLabel("Regime de execução").selectOption({ label: "1. Empreitada por preço unitário" });
  await expect(page.getByText("Medição pela quantidade executada de cada item.")).toBeVisible();
  await page.getByLabel("Regime de execução").selectOption({ label: "2. Empreitada por preço global" });
  await expect(page.getByText("Medição pelo percentual executado de cada item.")).toBeVisible();
  await page.getByLabel("Regime de execução").selectOption("__novo");
  await page.getByLabel("Nome do novo regime").fill("Regime especial E2E");
  await page.getByRole("button", { name: "Cadastrar regime" }).click();
  await expect(page.getByLabel("Regime de execução")).toHaveValue(/[0-9a-f-]{36}/);
  await expect(page.getByLabel("Regime de execução").locator("option:checked")).toHaveText("Regime especial E2E");
  await page.getByLabel("Regime de execução").selectOption({ label: "1. Empreitada por preço unitário" });
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
  await expect(page.getByText("SEI-045/2023")).toBeVisible();
  await expect(page.getByText("Empreitada por preço unitário — medição por quantidade executada")).toBeVisible();
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

test("medições: planejamento (até 30 dias), lançamento por quantidade, fechamento e reabertura", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await entrarComo(page);
  await page.getByRole("link", { name: "Contratos", exact: true }).click();
  await page.getByRole("link", { name: "Importar planilha da proposta" }).click();
  await page.getByLabel("Arquivo da planilha (.xls, .xlsx ou .pdf)").setInputFiles("test-results/proposta.xlsx");
  await expect(page.getByRole("status")).toContainText("3 itens em 2 grupos");
  await page.getByLabel("Nº do contrato").fill("046/2023");
  await page.getByLabel("Nome da obra", { exact: true }).fill("Escola — medições");
  await page.getByLabel("Objeto (nome da obra)").fill("Reforma da escola — medições");
  await page.getByLabel("Regime de execução").selectOption({ label: "1. Empreitada por preço unitário" });
  await page.getByLabel("Ordem de serviço (início)").fill("2026-10-10");
  await page.getByLabel("Prazo de execução (dias)").fill("300");
  await page.getByRole("button", { name: "Criar contrato com 3 itens" }).click();
  await expect(page.getByRole("heading", { name: "Contrato 046/2023" })).toBeVisible();
  await page.getByRole("button", { name: "Confirmar planilha" }).click();
  await expect(page.getByText(/Planilha vigente/)).toBeVisible();

  await page.getByRole("link", { name: "Medições", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Medições — Contrato 046/2023" })).toBeVisible();
  // sugestão: 300 dias ÷ 30 = 10 medições, a partir da OS
  await expect(page.getByLabel("Quantidade de medições")).toHaveValue("10");
  await expect(page.getByLabel("Início da 1ª medição")).toHaveValue("2026-10-10");
  await page.getByLabel(/Dias corridos por medição/).fill("31");
  await expect(page.getByRole("button", { name: "Planejar medições" })).toBeDisabled();
  await page.getByLabel(/Dias corridos por medição/).fill("30");
  await expect(page.getByText(/Prévia: 1ª 10\/10\/2026 a 08\/11\/2026/)).toBeVisible();
  // serviço contínuo: mensal dia a dia
  await page.getByLabel(/Serviço contínuo/).check();
  await expect(page.getByText(/Prévia: 1ª 10\/10\/2026 a 09\/11\/2026 · 2ª 10\/11\/2026 a 09\/12\/2026/)).toBeVisible();
  await page.getByLabel(/Serviço contínuo/).uncheck();
  await page.getByLabel("Quantidade de medições").fill("10");
  await page.getByRole("button", { name: "Planejar medições" }).click();
  const tabela = page.getByRole("region", { name: "Medições" });
  await expect(tabela.getByRole("row")).toHaveCount(11);
  await expect(tabela.getByRole("row", { name: /^10ª/ })).toContainText("07/07/2027");
  // ajuste do 1º período (20 dias): as seguintes acompanham
  await page.getByLabel("Fim da 1ª medição").fill("2026-10-29");
  await tabela.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Período da 1ª medição ajustado.")).toBeVisible();
  await expect(tabela.getByRole("row", { name: /^2ª/ })).toContainText("30/10/2026");

  await tabela.getByRole("row", { name: /^1ª/ }).getByRole("link", { name: "Abrir" }).click();
  await expect(page.getByRole("heading", { name: "1ª medição — Contrato 046/2023" })).toBeVisible();
  await page.getByRole("button", { name: "Iniciar medição" }).click();
  await expect(page.getByLabel("Quantidade do item 2.1")).toBeVisible();
  await page.getByLabel("Quantidade do item 2.1").fill("13");
  await expect(page.getByText("saldo 12")).toBeVisible();
  await page.getByLabel("Quantidade do item 2.1").fill("6");
  await page.getByLabel("Quantidade do item 1.1").fill("10,5");
  await page.getByRole("button", { name: "Salvar lançamentos (2)" }).click();
  await expect(page.getByText("Lançamentos salvos.")).toBeVisible();
  await expect(page.getByRole("row", { name: /^2\.1 / })).toContainText("600,00");
  await expect(page.getByRole("row", { name: /^1\.1 / })).toContainText("45.696,00");
  await page.getByLabel("Observações da medição").fill("Medição de teste");
  await page.getByRole("button", { name: "Fechar medição" }).click();
  await expect(page.getByText("Medição fechada.")).toBeVisible();
  await expect(page.getByLabel("Quantidade do item 2.1")).toHaveCount(0);
  await page.screenshot({ path: "test-results/medicao.png", fullPage: true });
  await page.getByRole("button", { name: "Reabrir medição" }).click();
  await expect(page.getByText("Medição reaberta.")).toBeVisible();
  await expect(page.getByLabel("Quantidade do item 2.1")).toHaveValue("6");
  await page.getByRole("button", { name: "Fechar medição" }).click();
  await expect(page.getByText("Medição fechada.")).toBeVisible();

  await page.getByRole("link", { name: "← Voltar às medições" }).click();
  await expect(tabela.getByRole("row", { name: /^1ª/ })).toContainText("Fechada");
  await expect(tabela.getByRole("row", { name: /^1ª/ })).toContainText("46.296,00");
  await page.screenshot({ path: "test-results/medicoes.png", fullPage: true });
});
