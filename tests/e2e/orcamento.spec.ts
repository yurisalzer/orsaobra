import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";

const EMAIL = "orcamento.e2e@exemplo.com.br";
const SENHA = "SenhaForte2026";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

test.beforeAll(() => {
  execSync("npx dotenv -e .env.test -- tsx tests/e2e/preparar-referencia.ts", { stdio: "inherit" });
  execSync(`npx dotenv -e .env.test -- tsx scripts/criar-admin.ts ${EMAIL} "Orçamentista"`, { env: { ...process.env, ADMIN_SENHA: SENHA }, stdio: "inherit" });
});

/** Respostas para window.prompt (na ordem) e aceite automático de confirmações. */
function dialogos(page: Page) {
  const respostas: string[] = [];
  page.on("dialog", (d) => (d.type() === "prompt" ? d.accept(respostas.shift() ?? "") : d.accept()));
  return respostas;
}

async function entrar(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Início" })).toBeVisible();
}

async function adicionar(page: Page, etapa: string, busca: string, opcao: RegExp, quantidade: string) {
  await page.getByRole("row", { name: new RegExp(etapa) }).getByRole("button", { name: "+ item" }).click();
  await page.getByLabel("Buscar serviço").fill(busca);
  await expect(page.getByRole("option", { name: opcao })).toHaveCount(1);
  await page.getByRole("option", { name: opcao }).click();
  await page.getByLabel("Quantidade do novo item").fill(quantidade);
  await page.getByRole("button", { name: "Adicionar", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("adicionado");
}

test("perfil de BDI, orçamento, itens, fechamento, nova revisão e comparação", async ({ page }) => {
  const respostas = dialogos(page);
  await entrar(page);

  // perfil de BDI informado
  await page.goto("/bdi");
  await page.getByRole("button", { name: "Novo perfil de BDI" }).click();
  await page.getByLabel("Nome do perfil").fill("BDI do edital");
  await page.getByLabel("Percentual informado (ex.: fixado em edital)").check();
  await page.getByLabel("BDI informado (%)").fill("25");
  await page.getByRole("button", { name: "Salvar perfil" }).click();
  await expect(page.getByRole("heading", { name: /BDI do edital — BDI 25,00%/ })).toBeVisible();

  // novo orçamento
  await page.goto("/orcamentos/novo");
  await page.getByLabel("Obra", { exact: true }).selectOption("");
  await page.getByLabel("Nome da obra").fill("Creche Municipal");
  await page.getByLabel("Código da obra").fill("OB-001");
  await page.getByLabel("Processo").fill("SEI-120001/000123/2026");
  await page.getByLabel("Descrição").fill("Reforma geral da creche");
  await page.getByLabel("Endereço").fill("Rua das Flores, 100");
  await page.getByLabel("Cidade").fill("Niterói");
  await page.getByLabel("Órgão solicitante").fill("Prefeitura");
  await page.getByLabel("Título").fill("Reforma da cobertura");
  await page.getByLabel("BDI global").selectOption({ label: "BDI do edital — 25,00%" });
  await page.getByRole("button", { name: "Criar orçamento" }).click();
  await expect(page.getByRole("heading", { name: "Reforma da cobertura" })).toBeVisible();
  await expect(page.getByText(/OB-001 · Creche Municipal — Prefeitura · Processo SEI-120001\/000123\/2026/)).toBeVisible();

  // etapas e itens
  respostas.push("Serviços preliminares");
  await page.getByRole("button", { name: "+ Nova etapa" }).click();
  await expect(page.getByRole("row", { name: /Serviços preliminares/ })).toBeVisible();
  // regime adotado "sem desoneração": só o código -0 é oferecido (o -A não aparece)
  await adicionar(page, "Serviços preliminares", "01.001.0001", /01\.001\.0001/, "10");
  // 211,97 × 1,25 = 264,9625 → 264,96; × 10 = 2.649,60
  await expect(page.getByRole("row", { name: /01\.001\.0001-0/ })).toContainText("R$ 2.649,60");
  await page.getByLabel("Quantidade 1.1").fill("2,5");
  await page.getByLabel("Quantidade 1.1").press("Enter");
  await expect(page.getByRole("row", { name: /01\.001\.0001-0/ })).toContainText("R$ 662,40");
  respostas.push("Acessibilidade");
  await page.getByRole("button", { name: "+ Nova etapa" }).click();
  await adicionar(page, "Acessibilidade", "104658", /104658/, "1");
  // 194,45 × 1,25 = 243,0625 → 243,06; total geral 662,40 + 243,06 = 905,46
  await expect(page.getByText("R$ 905,46")).toBeVisible();
  // memória de cálculo do quantitativo (exemplo do usuário)
  await page.getByLabel("Adicionar memória de cálculo 1.1").click();
  await page.getByLabel("Memória de cálculo do quantitativo — item 1.1").fill("2 x 1,25 (repetições)");
  await expect(page.getByText("Resultado: 2,50")).toBeVisible();
  await page.getByRole("button", { name: "Salvar memória" }).click();
  await expect(page.getByText("Memória de cálculo: 2 x 1,25 (repetições)")).toBeVisible();
  await expect(page.getByRole("row", { name: /01\.001\.0001-0/ })).toContainText("R$ 662,40"); // quantidade mantida (2,5)
  await page.getByLabel("Cálculo do preço 1.1").click();
  await expect(page.getByText(/211,97 × \(1 \+ 25,00% de BDI\) = R\$ 264,96/)).toBeVisible();
  await page.screenshot({ path: "test-results/orcamento-editor.png", fullPage: true });

  // fechar: fica imutável (memória visível, sem edição)
  await page.getByRole("button", { name: "Fechar revisão" }).click();
  await expect(page.getByText(/Fechada em/)).toBeVisible();
  await expect(page.getByLabel("Quantidade 1.1")).toHaveCount(0);
  await expect(page.getByText(/Memória de cálculo: 2 x 1,25/)).toBeVisible();
  await expect(page.getByLabel("Editar memória de cálculo 1.1")).toHaveCount(0);

  // nova revisão e alteração
  await page.getByRole("button", { name: "Nova revisão" }).click();
  await page.getByLabel("Descrição da nova revisão").fill("Ajuste de quantitativos");
  await page.getByRole("button", { name: "Criar revisão" }).click();
  await expect(page.getByText("Em elaboração")).toBeVisible();
  await page.getByLabel("Quantidade 1.1").fill("3");
  await page.getByLabel("Quantidade 1.1").press("Enter");
  // 3 × 264,96 = 794,88; total 794,88 + 243,06 = 1.037,94
  await expect(page.getByText("R$ 1.037,94")).toBeVisible();

  // comparação com a revisão 1
  await page.getByLabel("Comparar com").selectOption({ label: "Revisão 1" });
  await expect(page.getByRole("heading", { name: "Comparação: revisão 1 × revisão 2" })).toBeVisible();
  const linha = page.getByRole("row", { name: /01\.001\.0001-0/ });
  await expect(linha).toContainText("Alterado");
  await expect(linha).toContainText("R$ 132,48");
  await page.screenshot({ path: "test-results/orcamento-comparacao.png", fullPage: true });
});

test("a conta da memória de cálculo preenche a quantidade (exemplo do usuário)", async ({ page }) => {
  dialogos(page);
  await entrar(page);
  await page.goto("/orcamentos");
  await page.getByRole("link", { name: "Reforma da cobertura" }).click();
  await page.getByLabel("Adicionar memória de cálculo 2.1").click();
  await page.getByLabel("Memória de cálculo do quantitativo — item 2.1").fill("(30m (comprimento) + 20m (largura)) x 2 (perimetro) x 2m (altura) = 100m²");
  await expect(page.getByText("Resultado: 200,00")).toBeVisible();
  await expect(page.getByText(/resultado escrito após "=" \(100\) difere do calculado/)).toBeVisible();
  await page.getByRole("button", { name: "Salvar memória" }).click();
  // quantidade 200 × 243,06 = 48.612,00
  await expect(page.getByLabel("Quantidade 2.1")).toHaveValue("200,00");
  await expect(page.getByRole("row", { name: /104658/ })).toContainText("R$ 48.612,00");
  await expect(page.getByText(/→ 200,00/)).toBeVisible();
  // ao incluir um item, a memória preenche a quantidade
  await page.getByRole("row", { name: /Acessibilidade/ }).getByRole("button", { name: "+ item" }).click();
  await page.getByLabel("Buscar serviço").fill("01.001.0002");
  await page.getByRole("option", { name: /01\.001\.0002/ }).click();
  await page.getByLabel("Memória de cálculo do novo item").fill("3 x 4,5");
  await expect(page.getByLabel("Quantidade do novo item")).toHaveValue("13,50");
  await page.getByRole("button", { name: "Adicionar", exact: true }).click();
  await expect(page.getByLabel("Quantidade 2.2")).toHaveValue("13,50");
  // quantidade sempre com 2 casas (ou mais, se informadas)
  await expect(page.getByLabel("Quantidade 1.1")).toHaveValue("3,00");
  await page.getByLabel("Quantidade 1.1").fill("3,125");
  await page.getByLabel("Quantidade 1.1").press("Enter");
  await expect(page.getByLabel("Quantidade 1.1")).toHaveValue("3,125");
  await page.getByLabel("Quantidade 1.1").fill("3");
  await page.getByLabel("Quantidade 1.1").press("Enter");
  await expect(page.getByLabel("Quantidade 1.1")).toHaveValue("3,00");
  await page.screenshot({ path: "test-results/orcamento-memoria.png", fullPage: true });
});

test("editar o código de um item mantém quantidade e memória; o código continua abrindo a composição", async ({ page }) => {
  dialogos(page);
  await entrar(page);
  await page.goto("/orcamentos");
  await page.getByRole("link", { name: "Reforma da cobertura" }).click();
  const linha = () => page.getByRole("row").filter({ has: page.getByLabel("Quantidade 2.2") });
  await expect(linha().getByRole("link", { name: /^01\.001\.0002/ })).toHaveAttribute("href", /\/consulta\/item\//);
  await page.getByLabel("Editar código do item 2.2").click();
  await expect(page.getByLabel("Novo código do item 2.2")).toHaveValue(/^01\.001\.0002/);
  await page.getByLabel("Novo código do item 2.2").fill("01.001.0001");
  await page.getByRole("listbox", { name: "Códigos encontrados" }).getByRole("option", { name: /01\.001\.0001-0/ }).click();
  await expect(page.getByRole("status")).toContainText(/Item 2\.2: código 01\.001\.0002-\w trocado por 01\.001\.0001-0/);
  await expect(linha().getByRole("link", { name: "01.001.0001-0" })).toHaveAttribute("href", /\/consulta\/item\//);
  await expect(page.getByLabel("Quantidade 2.2")).toHaveValue("13,50");
  await expect(page.getByText(/Memória de cálculo:.*3 x 4,5/)).toBeVisible();
  await page.screenshot({ path: "test-results/orcamento-trocar-codigo.png", fullPage: true });
});

test("edição dos dados da obra", async ({ page }) => {
  await entrar(page);
  await page.goto("/orcamentos");
  await page.getByRole("link", { name: "Editar obra Creche Municipal" }).click();
  await expect(page.getByRole("heading", { name: "Editar obra" })).toBeVisible();
  await expect(page.getByLabel("Processo")).toHaveValue("SEI-120001/000123/2026");
  await expect(page.getByRole("button", { name: "Salvar alterações" })).toBeDisabled();
  await page.getByLabel("Código da obra").fill("OB-002");
  await page.getByLabel("Órgão solicitante").fill("Secretaria Municipal de Educação");
  await page.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(page.getByRole("heading", { name: "Obras e orçamentos" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "OB-002 · Creche Municipal — Secretaria Municipal de Educação" })).toBeVisible();
  // volta ao código original (os demais testes conferem o cabeçalho)
  await page.getByRole("link", { name: "Editar obra Creche Municipal" }).click();
  await page.getByLabel("Código da obra").fill("OB-001");
  await page.getByLabel("Órgão solicitante").fill("Prefeitura");
  await page.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(page.getByRole("heading", { name: "OB-001 · Creche Municipal — Prefeitura" })).toBeVisible();
});

test("conflito de edição entre duas abas é detectado", async ({ page, browser }) => {
  const respostas = dialogos(page);
  await entrar(page);
  await page.goto("/orcamentos");
  await page.getByRole("link", { name: "Reforma da cobertura" }).click();
  await expect(page.getByLabel("Quantidade 1.1")).toBeVisible();
  // segunda aba editando a mesma revisão
  const outra = await (await browser.newContext({ storageState: await page.context().storageState() })).newPage();
  dialogos(outra);
  await outra.goto(page.url());
  await page.getByLabel("Quantidade 1.1").fill("4");
  await page.getByLabel("Quantidade 1.1").press("Enter");
  await expect(page.getByRole("row", { name: /^1\.1 EMOP 01\.001\.0001-0/ })).toContainText("R$ 1.059,84"); // 4 × 264,96
  await outra.getByLabel("Quantidade 1.1").fill("5");
  await outra.getByLabel("Quantidade 1.1").press("Enter");
  await expect(outra.locator("main").getByRole("alert")).toContainText(/alterado por outra pessoa/);
  void respostas;
});

test("criador altera o nome do orçamento na lista e no editor", async ({ page }) => {
  const respostas = dialogos(page);
  await entrar(page);
  await page.goto("/orcamentos");
  respostas.push("Reforma da cobertura do bloco A");
  await page.getByRole("button", { name: "Alterar nome do orçamento Reforma da cobertura" }).first().click();
  await expect(page.getByRole("link", { name: "Reforma da cobertura do bloco A" })).toBeVisible();
  await page.getByRole("link", { name: "Reforma da cobertura do bloco A" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Reforma da cobertura do bloco A");
  respostas.push("Reforma da cobertura");
  await page.getByRole("button", { name: "Alterar nome do orçamento Reforma da cobertura do bloco A" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Reforma da cobertura$/);
});

test("cronograma e relatórios: visualizar, PDF e Excel", async ({ page }) => {
  dialogos(page);
  await entrar(page);
  await page.goto("/orcamentos");
  await page.getByRole("link", { name: "Reforma da cobertura" }).click();
  await expect(page.getByLabel("Quantidade 1.1")).toBeVisible();
  // cronograma
  await page.getByRole("link", { name: "Cronograma" }).click();
  await expect(page.getByRole("heading", { name: "Cronograma físico-financeiro" })).toBeVisible();
  await page.getByLabel("Prazo em meses").fill("2");
  await page.getByLabel("Percentual 1 mês 1").fill("100");
  await page.getByLabel("Percentual 2 mês 1").fill("30");
  await page.getByLabel("Percentual 2 mês 2").fill("70");
  await page.getByRole("button", { name: "Salvar cronograma" }).click();
  await expect(page.getByRole("status")).toContainText("Cronograma salvo");
  await page.getByLabel("Percentual 2 mês 2").fill("80");
  await page.getByRole("button", { name: "Salvar cronograma" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("passa de 100%");
  await page.getByLabel("Percentual 2 mês 2").fill("70");

  // relatórios
  await page.getByRole("link", { name: /Reforma da cobertura/ }).click();
  await page.getByRole("link", { name: "Relatórios" }).click();
  await expect(page.getByRole("heading", { name: /Relatórios — revisão 2/ })).toBeVisible();
  await page.getByRole("button", { name: "Visualizar — Orçamento sintético" }).click();
  const vis = page.getByRole("region", { name: "Visualização — Orçamento sintético" });
  await expect(vis.getByText("PRÉVIA", { exact: false })).toBeVisible();
  await expect(vis.getByRole("row", { name: /TOTAL GERAL/ })).toBeVisible();
  await expect(vis.getByText(/Obra:\s*OB-001/)).toBeVisible();
  await expect(vis.getByText(/Processo:\s*SEI-120001/)).toBeVisible();
  await page.screenshot({ path: "test-results/relatorio-sintetico.png", fullPage: true });

  const [pdf] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Baixar PDF — Orçamento analítico" }).click()]);
  expect(pdf.suggestedFilename()).toMatch(/^Orcamento_analitico_.*rev2\.pdf$/);
  const fs = await import("node:fs");
  const caminhoPdf = await pdf.path();
  expect(fs.readFileSync(caminhoPdf).subarray(0, 5).toString()).toBe("%PDF-");

  const [xlsx] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Baixar Excel — Cronograma físico-financeiro" }).click()]);
  expect(xlsx.suggestedFilename()).toMatch(/\.xlsx$/);
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(await xlsx.path());
  const ws = wb.worksheets[0];
  expect(ws.getCell(1, 1).value).toBe("CRONOGRAMA FÍSICO-FINANCEIRO");
  const valores: unknown[] = [];
  ws.eachRow((r) => { if (r.getCell(1).value === "% acumulado do orçamento") valores.push(r.getCell(5).value); });
  expect(valores).toEqual([100]);

  // memória de cálculo: sem a coluna "Cálculo do preço"; impressão da tela em A4 paisagem, só o relatório
  await page.getByRole("button", { name: "Visualizar — Memória de cálculo" }).click();
  const mem = page.getByRole("region", { name: "Visualização — Memória de cálculo" });
  await expect(mem.locator("thead th")).toHaveText(["Item", "Código", "Descrição", "Quant.", "Memória do quantitativo"]);
  await expect(mem.getByRole("button", { name: "Imprimir" })).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("button", { name: "Visualizar — Orçamento sintético" })).toBeHidden();
  const impresso = await page.pdf({ preferCSSPageSize: true, path: "test-results/memoria-impressao.pdf" });
  // A4 paisagem: 842 × 595 pt
  expect(impresso.toString("latin1")).toMatch(/MediaBox \[0 0 841\.\d+ 59[45]\.\d+\]/);
  await page.emulateMedia({ media: "screen" });
  await mem.getByRole("button", { name: "Fechar" }).click();

  // comparativo com a revisão 1
  await page.getByRole("button", { name: "Visualizar — Comparativo entre revisões" }).click();
  await expect(page.getByRole("region", { name: "Visualização — Comparativo entre revisões" }).getByText(/Rev\. 1 \(fechada\)/)).toBeVisible();
});

test("cabeçalho dos relatórios: cadastro com logo, escolha na obra e uso no relatório", async ({ page }) => {
  dialogos(page);
  await entrar(page);
  await page.getByRole("link", { name: "Cabeçalhos" }).click();
  await expect(page.getByRole("heading", { name: "Cabeçalhos dos relatórios" })).toBeVisible();
  // padrão sem logo
  await page.getByRole("button", { name: "Novo cabeçalho" }).click();
  await page.getByLabel("Nome (para identificar)").fill("Padrão do escritório");
  await page.getByLabel("Linha 1", { exact: true }).fill("Escritório de Engenharia");
  await page.getByRole("button", { name: "Salvar cabeçalho" }).click();
  await expect(page.getByRole("heading", { name: /Padrão do escritório/ })).toContainText("padrão");
  // Macaé com logo
  await page.getByRole("button", { name: "Novo cabeçalho" }).click();
  await page.getByLabel("Nome (para identificar)").fill("Macaé SEMINF");
  await page.getByLabel("Linha 1", { exact: true }).fill("Estado do Rio de Janeiro");
  await page.getByLabel("Linha 2", { exact: true }).fill("Prefeitura Municipal de Macaé");
  await page.getByLabel("Linha 3", { exact: true }).fill("Secretaria Municipal de Infraestrutura");
  await page.getByLabel("Linha 4", { exact: true }).fill("Secretaria Executiva de Obras");
  await page.getByLabel("Arquivo do logo").setInputFiles("tests/fixtures/logo.png");
  await expect(page.getByLabel("Prévia do cabeçalho").getByRole("img", { name: "Logo" })).toBeVisible();
  await page.getByRole("button", { name: "Salvar cabeçalho" }).click();
  await expect(page.getByRole("heading", { name: "Macaé SEMINF" })).toBeVisible();
  await page.screenshot({ path: "test-results/cabecalhos.png", fullPage: true });

  // a obra escolhe o cabeçalho de Macaé
  await page.goto("/orcamentos");
  await page.getByRole("link", { name: "Editar obra Creche Municipal" }).click();
  await page.getByLabel("Cabeçalho dos relatórios").selectOption({ label: "Macaé SEMINF" });
  await page.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(page.getByRole("heading", { name: "Obras e orçamentos" })).toBeVisible();

  await page.getByRole("link", { name: "Reforma da cobertura" }).click();
  await page.getByRole("link", { name: "Relatórios" }).click();
  await page.getByRole("button", { name: "Visualizar — Orçamento sintético" }).click();
  const vis = page.getByRole("region", { name: "Visualização — Orçamento sintético" });
  await expect(vis.getByText("Prefeitura Municipal de Macaé")).toBeVisible();
  await expect(vis.getByRole("img", { name: "Logo" })).toBeVisible();
  const [pdf] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Baixar PDF — Orçamento sintético" }).click()]);
  const fs = await import("node:fs");
  expect(fs.readFileSync(await pdf.path()).subarray(0, 5).toString()).toBe("%PDF-");
  const [xlsx] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Baixar Excel — Orçamento sintético" }).click()]);
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(await xlsx.path());
  expect(wb.worksheets[0].getImages()).toHaveLength(1);
  expect(wb.worksheets[0].getCell(2, 3).value).toBe("Prefeitura Municipal de Macaé");
});

test("pesquisa na lista de orçamentos e exclusão de orçamento em elaboração", async ({ page }) => {
  dialogos(page);
  await entrar(page);
  await page.goto("/orcamentos");
  const pesquisa = page.getByLabel("Pesquisar obras e orçamentos");
  for (const termo of ["creche", "OB-001", "SEI-120001", "cobertura"]) {
    await pesquisa.fill(termo);
    await page.getByRole("button", { name: "Pesquisar" }).click();
    await expect(page.getByRole("status")).toContainText("1 obra encontrada");
    await expect(page.getByRole("link", { name: "Reforma da cobertura" })).toBeVisible();
  }
  await pesquisa.fill("obra inexistente");
  await pesquisa.press("Enter");
  await expect(page.getByRole("status")).toContainText("Nada encontrado para “obra inexistente”");
  await page.getByRole("link", { name: "Limpar" }).click();
  await expect(pesquisa).toHaveValue("");

  // orçamento com revisão fechada também pode ser excluído pelo criador (com aviso de exclusão definitiva)
  await expect(page.getByLabel("Excluir orçamento Reforma da cobertura")).toBeVisible();

  // novo orçamento em elaboração na mesma obra: quem criou pode excluir
  await page.goto("/orcamentos/novo");
  await page.getByLabel("Obra", { exact: true }).selectOption({ label: "Creche Municipal" });
  await page.getByLabel("Título").fill("Orçamento descartável");
  await page.getByRole("button", { name: "Criar orçamento" }).click();
  await expect(page.getByRole("heading", { name: "Orçamento descartável" })).toBeVisible();
  await page.goto("/orcamentos");
  await expect(page.getByRole("row", { name: /Orçamento descartável/ })).toContainText("Orçamentista");
  await page.getByLabel("Excluir orçamento Orçamento descartável").click();
  await expect(page.getByRole("link", { name: "Orçamento descartável" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Reforma da cobertura" })).toBeVisible();
});

test("obra sem orçamentos pode ser excluída por quem a cadastrou", async ({ page }) => {
  dialogos(page);
  await entrar(page);
  await page.goto("/orcamentos/novo");
  await page.getByLabel("Obra", { exact: true }).selectOption("");
  await page.getByLabel("Nome da obra").fill("Obra temporária");
  await page.getByLabel("Título").fill("Orçamento temporário");
  await page.getByRole("button", { name: "Criar orçamento" }).click();
  await expect(page.getByRole("heading", { name: "Orçamento temporário" })).toBeVisible();
  await page.goto("/orcamentos");
  // com orçamento: não há exclusão da obra
  await expect(page.getByLabel("Excluir obra Obra temporária")).toHaveCount(0);
  await page.getByLabel("Excluir orçamento Orçamento temporário").click();
  await expect(page.getByText("Nenhum orçamento nesta obra.")).toBeVisible();
  await page.getByLabel("Excluir obra Obra temporária").click();
  await expect(page.getByRole("heading", { name: "Obra temporária" })).toHaveCount(0);
  await expect(page.getByLabel("Excluir obra Creche Municipal")).toHaveCount(0);
});


test("perfil de BDI editado depois de aplicado: aviso no orçamento e “Atualizar BDI”", async ({ page }) => {
  const respostas = dialogos(page);
  await entrar(page);
  await page.goto("/bdi");
  await page.getByRole("button", { name: "Novo perfil de BDI" }).click();
  await page.getByLabel("Nome do perfil").fill("BDI que muda");
  await page.getByLabel("Percentual informado (ex.: fixado em edital)").check();
  await page.getByLabel("BDI informado (%)").fill("10");
  await page.getByRole("button", { name: "Salvar perfil" }).click();
  await expect(page.getByRole("heading", { name: /BDI que muda — BDI 10,00%/ })).toBeVisible();

  await page.goto("/orcamentos/novo");
  await page.getByLabel("Obra", { exact: true }).selectOption({ label: "Creche Municipal" });
  await page.getByLabel("Título").fill("Orçamento com BDI que muda");
  await page.getByLabel("BDI global").selectOption({ label: "BDI que muda — 10,00%" });
  await page.getByRole("button", { name: "Criar orçamento" }).click();
  await expect(page.getByRole("heading", { name: "Orçamento com BDI que muda" })).toBeVisible();
  const url = page.url();
  respostas.push("Etapa única");
  await page.getByRole("button", { name: "+ Nova etapa" }).click();
  await adicionar(page, "Etapa única", "01.001.0001", /01\.001\.0001/, "1");
  await expect(page.getByText("R$ 233,17").first()).toBeVisible(); // 211,97 × 1,10

  // o perfil muda na aba BDI
  await page.goto("/bdi");
  await page.getByRole("heading", { name: /BDI que muda/ }).locator("xpath=ancestor::section[1]").getByRole("button", { name: "Editar" }).click();
  await page.getByLabel("BDI informado (%)").fill("12");
  await page.getByRole("button", { name: "Salvar perfil" }).click();
  await expect(page.getByRole("heading", { name: /BDI que muda — BDI 12,00%/ })).toBeVisible();

  await page.goto(url);
  const aviso = page.getByRole("status").filter({ hasText: "O BDI foi alterado" });
  await expect(aviso).toContainText("este orçamento usa 10,00% (BDI global); o perfil agora é 12,00%");
  await page.getByRole("button", { name: "Fechar revisão" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("Use “Atualizar BDI” antes de fechar");
  await page.getByRole("button", { name: "Atualizar BDI" }).click();
  await expect(page.getByText("BDI atualizado e itens recalculados.")).toBeVisible();
  await expect(aviso).toHaveCount(0);
  await expect(page.getByText("R$ 237,41").first()).toBeVisible(); // 211,97 × 1,12

  // BDI do item: sem BDI e percentual digitado
  await page.getByLabel("BDI 1.1").selectOption({ label: "Sem BDI (0%)" });
  await expect(page.getByLabel("BDI 1.1")).toHaveValue("__zero");
  await expect(page.getByRole("row", { name: /01\.001\.0001-0/ })).toContainText("R$ 211,97");
  await page.getByLabel("BDI 1.1").selectOption({ label: "Informar percentual…" });
  await page.getByLabel("BDI informado 1.1 (%)").fill("5");
  await page.getByLabel("BDI informado 1.1 (%)").press("Enter");
  await expect(page.getByLabel("BDI 1.1")).toHaveValue("__informado");
  await expect(page.getByRole("row", { name: /01\.001\.0001-0/ })).toContainText("R$ 222,57"); // 211,97 × 1,05
  await page.getByLabel("BDI 1.1").selectOption({ label: "Global (12,00%)" });
  await expect(page.getByRole("row", { name: /01\.001\.0001-0/ })).toContainText("R$ 237,41");
});

test("gera a versão com desoneração e compara com a original", async ({ page }) => {
  dialogos(page);
  await entrar(page);
  await page.goto("/orcamentos");
  await page.getByRole("link", { name: "Reforma da cobertura" }).click();
  await page.getByRole("button", { name: "Versão com/sem desoneração" }).click();
  await expect(page.getByLabel("Regime da nova versão")).toHaveValue("COM_DESONERACAO");
  await expect(page.getByLabel("Título da nova versão")).toHaveValue("Reforma da cobertura — com desoneração");
  await page.getByRole("button", { name: "Gerar e comparar" }).click();
  await expect(page.getByRole("heading", { name: "Comparação: Reforma da cobertura × Reforma da cobertura — com desoneração" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("código(s) da EMOP trocados pelo par do novo regime");
  await expect(page.getByText("→ 01.001.0001-A").first()).toBeVisible();
  await page.screenshot({ path: "test-results/versao-regime.png", fullPage: true });
  await page.getByRole("link", { name: /Abrir B:/ }).click();
  await expect(page.getByRole("heading", { name: "Reforma da cobertura — com desoneração" })).toBeVisible();
  await expect(page.getByText("Versões em outro regime:")).toBeVisible();
  await expect(page.getByText("(original)")).toBeVisible();
  await page.getByRole("link", { name: "Comparar", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Comparação: Reforma da cobertura ×/ })).toBeVisible();
});

test("desbloquear revisão fechada e excluir orçamento fechado, com confirmação", async ({ page }) => {
  const mensagens: string[] = [];
  page.on("dialog", (d) => { mensagens.push(d.message()); d.type() === "prompt" ? d.accept("Etapa única") : d.accept(); });
  await entrar(page);
  await page.goto("/orcamentos/novo");
  await page.getByLabel("Obra", { exact: true }).selectOption({ label: "Creche Municipal" });
  await page.getByLabel("Título").fill("Orçamento para fechar");
  await page.getByRole("button", { name: "Criar orçamento" }).click();
  await expect(page.getByRole("heading", { name: "Orçamento para fechar" })).toBeVisible();
  await page.getByRole("button", { name: "+ Nova etapa" }).click();
  await adicionar(page, "Etapa única", "01.001.0001", /01\.001\.0001/, "2");
  await page.getByRole("button", { name: "Fechar revisão" }).click();
  await expect(page.getByText(/Fechada em/)).toBeVisible();
  await expect(page.getByLabel("Quantidade 1.1")).toHaveCount(0);
  // desbloquear
  await page.getByRole("button", { name: "Desbloquear para edição" }).click();
  await expect(page.getByText("Revisão 1 desbloqueada para edição.")).toBeVisible();
  await expect(page.getByLabel("Quantidade 1.1")).toBeVisible();
  expect(mensagens.at(-1)).toContain("Desbloquear a revisão 1 para edição?");
  // fecha de novo e exclui de vez
  await page.getByRole("button", { name: "Fechar revisão" }).click();
  await expect(page.getByText(/Fechada em/)).toBeVisible();
  await page.getByRole("button", { name: "Excluir orçamento Orçamento para fechar" }).click();
  await expect(page.getByRole("heading", { name: "Obras e orçamentos" })).toBeVisible();
  expect(mensagens.at(-1)).toContain("EXCLUI EM DEFINITIVO");
  expect(mensagens.at(-1)).toContain("inclusive as FECHADAS");
  expect(mensagens.at(-1)).toContain("Deseja realmente excluir?");
  await expect(page.getByRole("link", { name: "Orçamento para fechar" })).toHaveCount(0);
});


test("memorial descritivo: só com revisão fechada e cronograma pronto; edita e gera .docx e PDF", async ({ page }) => {
  page.on("dialog", (d) => (d.type() === "prompt" ? d.accept("Serviços preliminares") : d.accept()));
  await entrar(page);
  await page.goto("/orcamentos/novo");
  await page.getByLabel("Obra", { exact: true }).selectOption({ label: "Creche Municipal" });
  await page.getByLabel("Título").fill("Orçamento do memorial");
  await page.getByRole("button", { name: "Criar orçamento" }).click();
  await expect(page.getByRole("heading", { name: "Orçamento do memorial" })).toBeVisible();
  await page.getByRole("button", { name: "+ Nova etapa" }).click();
  await adicionar(page, "Serviços preliminares", "01.001.0001", /01\.001\.0001/, "2");
  const editor = page.url();
  // em elaboração e sem cronograma: botão desabilitado, com as pendências
  await page.getByRole("link", { name: "Relatórios" }).click();
  await expect(page.getByText("A revisão precisa estar concluída e bloqueada")).toBeVisible();
  await expect(page.getByText("O cronograma físico-financeiro não foi preenchido.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Gerar memorial descritivo" })).toHaveCount(0);
  // cronograma e fechamento
  await page.goto(editor);
  await page.getByRole("link", { name: "Cronograma" }).click();
  await page.getByLabel("Prazo em meses").fill("1");
  await page.getByLabel("Percentual 1 mês 1").fill("100");
  await page.getByRole("button", { name: "Salvar cronograma" }).click();
  await expect(page.getByRole("status")).toContainText("Cronograma salvo");
  await page.goto(editor);
  await page.getByRole("button", { name: "Fechar revisão" }).click();
  await expect(page.getByText(/Fechada em/)).toBeVisible();
  await page.getByRole("link", { name: "Relatórios" }).click();
  await page.getByRole("link", { name: "Gerar memorial descritivo" }).click();
  await expect(page.getByRole("heading", { name: "Memorial descritivo" })).toBeVisible();
  await expect(page.getByLabel("Título da seção 1", { exact: true })).toHaveValue("1) OBJETO");
  await expect(page.getByText(/Complete os trechos entre colchetes/)).toBeVisible();
  await page.getByLabel("Texto de 1.1) JUSTIFICATIVA").fill("Necessidade de reforma da creche, conforme vistoria da Secretaria.");
  await expect(page.getByText(/Complete os trechos entre colchetes/)).toHaveCount(0);
  await page.screenshot({ path: "test-results/memorial-editor.png", fullPage: true });
  // gerar salva o texto editado
  const [docx] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Gerar .docx" }).click()]);
  expect(docx.suggestedFilename()).toBe("Memorial_descritivo_Orcamento_do_memorial_rev1.docx");
  const fs = await import("node:fs");
  const { unzipSync, strFromU8 } = await import("fflate");
  const xml = strFromU8(unzipSync(new Uint8Array(fs.readFileSync(await docx.path())))["word/document.xml"]);
  expect(xml).toContain("Necessidade de reforma da creche, conforme vistoria da Secretaria.");
  expect(xml).toContain("ESCOPO DOS SERVIÇOS");
  await expect(page.getByText(/Texto editado salvo/)).toBeVisible();
  const [pdf] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Gerar PDF" }).click()]);
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
  const bytes = fs.readFileSync(await pdf.path());
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  fs.copyFileSync(await pdf.path(), "test-results/memorial.pdf");
  // texto salvo volta ao reabrir
  await page.reload();
  await expect(page.getByLabel("Texto de 1.1) JUSTIFICATIVA")).toHaveValue("Necessidade de reforma da creche, conforme vistoria da Secretaria.");
});

test("contrato a partir do orçamento: preço contratado editável, desconto linear e confirmação", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await entrar(page);
  await page.goto("/orcamentos");
  await page.getByRole("link", { name: "Orçamento do memorial" }).click();
  await page.getByRole("link", { name: "Criar contrato" }).click();
  await expect(page.getByRole("heading", { name: "Novo contrato a partir do orçamento" })).toBeVisible();
  await expect(page.getByLabel("Revisão do orçamento")).not.toHaveValue("");
  // processo vem da obra do orçamento e pode ser editado
  await expect(page.getByLabel("Nº do processo")).toHaveValue("SEI-120001/000123/2026");
  await page.getByLabel("Nº do processo").fill("SEI-120001/000999/2026");
  await page.getByLabel("Nº do contrato").fill("017/2026");
  await page.getByLabel("Empresa contratada").fill("Construtora Exemplo Ltda");
  await page.getByLabel("Objeto (nome da obra)").fill("PONTE REGALO (SANA) - EMERGENCIAL");
  await page.getByRole("button", { name: "Criar contrato e planilha" }).click();
  await expect(page.getByRole("heading", { name: "Contrato 017/2026" })).toBeVisible();
  await expect(page.getByText("Em cadastro — confira a planilha e confirme")).toBeVisible();
  await expect(page.getByText("SEI-120001/000999/2026")).toBeVisible();
  await page.getByRole("button", { name: "Editar dados" }).click();
  await page.getByLabel("Nº do processo").fill("SEI-120001/001000/2026");
  await page.getByRole("button", { name: "Salvar dados" }).click();
  await expect(page.getByText("SEI-120001/001000/2026")).toBeVisible();
  // preço contratado começa igual ao orçado; edição item a item
  const preco = page.getByLabel("Preço contratado 1.1");
  await expect(preco).toHaveValue("211,97");
  await preco.fill("200,00");
  await preco.press("Enter");
  await expect(page.getByRole("row", { name: /^1\.1 / })).toContainText("400,00");
  // desconto linear de 10% sobre o orçado (211,97 × 0,9 = 190,773 → 190,77)
  await page.getByLabel("Desconto linear (%)").fill("10");
  await page.getByRole("button", { name: "Aplicar a todos os itens" }).click();
  await expect(page.getByRole("status")).toContainText("Desconto aplicado");
  await expect(page.getByLabel("Preço contratado 1.1")).toHaveValue("190,77");
  await expect(page.getByText("Desconto sobre o orçado")).toBeVisible();
  await page.screenshot({ path: "test-results/contrato-orcamento.png", fullPage: true });
  await page.getByRole("button", { name: "Confirmar planilha" }).click();
  await expect(page.getByText(/Planilha vigente desde/)).toBeVisible();
  await expect(page.getByLabel("Preço contratado 1.1")).toHaveCount(0);
  await page.getByRole("link", { name: "Contratos", exact: true }).first().click();
  await expect(page.getByRole("row", { name: /017\/2026/ })).toContainText("Vigente");
});

test("acesso individual: sem acesso vê só na lista; o criador libera pelo botão Acesso", async ({ page, browser }) => {
  const COLEGA = "colega.e2e@exemplo.com.br";
  execSync(`npx dotenv -e .env.test -- tsx scripts/criar-admin.ts ${COLEGA} "Colega Sem Acesso"`, {
    env: { ...process.env, ADMIN_SENHA: SENHA, PERMISSOES: "ORCAMENTOS_VER,ORCAMENTOS_EDITAR,RELATORIOS,MEDICOES_VER" }, stdio: "inherit",
  });
  const outra = await (await browser.newContext()).newPage();
  await outra.goto("/login");
  await outra.getByLabel("E-mail").fill(COLEGA);
  await outra.getByLabel("Senha").fill(SENHA);
  await outra.getByRole("button", { name: "Entrar" }).click();
  await expect(outra.getByRole("heading", { name: "Início" })).toBeVisible();
  await outra.goto("/orcamentos");
  // vê na lista, mas sem link
  await expect(outra.getByText(/🔒 .*Reforma da cobertura/).first()).toBeVisible();
  await expect(outra.getByRole("link", { name: /Reforma da cobertura/ })).toHaveCount(0);
  // nem pelo endereço direto
  await entrar(page);
  await page.goto("/orcamentos");
  await page.getByRole("link", { name: "Reforma da cobertura", exact: true }).click();
  await page.waitForURL(/\/orcamentos\/revisao\//);
  const url = page.url();
  await outra.goto(url);
  await expect(outra.getByRole("heading", { name: "Sem acesso a este orçamento" })).toBeVisible();
  // o criador libera "pode ver e editar"
  await page.getByRole("button", { name: "Acesso" }).click();
  const dialogo = page.getByRole("dialog", { name: "Acesso ao orçamento" });
  await expect(dialogo.getByText("Criador — acesso total")).toBeVisible();
  await dialogo.getByLabel("Acesso de Colega Sem Acesso").selectOption("EDITAR");
  await page.screenshot({ path: "test-results/acesso-orcamento.png", fullPage: true });
  await dialogo.getByRole("button", { name: "Fechar" }).click();
  await expect(async () => {
    await outra.goto(url);
    await expect(outra.getByLabel("Quantidade 1.1")).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
  // só ver: abre, mas sem edição
  await page.getByRole("button", { name: "Acesso" }).click();
  await page.getByRole("dialog").getByLabel("Acesso de Colega Sem Acesso").selectOption("VER");
  await expect(async () => {
    await outra.reload();
    await expect(outra.getByRole("heading", { name: /Reforma da cobertura/ }).first()).toBeVisible({ timeout: 2000 });
    await expect(outra.getByLabel("Quantidade 1.1")).toHaveCount(0, { timeout: 1000 });
  }).toPass({ timeout: 15000 });
  // retirado: volta a ficar bloqueado
  await page.getByRole("dialog").getByLabel("Acesso de Colega Sem Acesso").selectOption("");
  await expect(async () => {
    await outra.reload();
    await expect(outra.getByRole("heading", { name: "Sem acesso a este orçamento" })).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
});
