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
  await expect(page.getByText("Resultado: 2,5")).toBeVisible();
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
  await expect(page.getByText("Resultado: 200")).toBeVisible();
  await expect(page.getByText(/resultado escrito após "=" \(100\) difere do calculado/)).toBeVisible();
  await page.getByRole("button", { name: "Salvar memória" }).click();
  // quantidade 200 × 243,06 = 48.612,00
  await expect(page.getByLabel("Quantidade 2.1")).toHaveValue("200");
  await expect(page.getByRole("row", { name: /104658/ })).toContainText("R$ 48.612,00");
  await expect(page.getByText(/→ 200/)).toBeVisible();
  // ao incluir um item, a memória preenche a quantidade
  await page.getByRole("row", { name: /Acessibilidade/ }).getByRole("button", { name: "+ item" }).click();
  await page.getByLabel("Buscar serviço").fill("01.001.0002");
  await page.getByRole("option", { name: /01\.001\.0002/ }).click();
  await page.getByLabel("Memória de cálculo do novo item").fill("3 x 4,5");
  await expect(page.getByLabel("Quantidade do novo item")).toHaveValue("13,5");
  await page.getByRole("button", { name: "Adicionar", exact: true }).click();
  await expect(page.getByLabel("Quantidade 2.2")).toHaveValue("13,5");
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
  await expect(page.getByLabel("Quantidade 2.2")).toHaveValue("13,5");
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
