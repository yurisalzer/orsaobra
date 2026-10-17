import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const EMAIL = "admin.importacao@exemplo.com.br";
const SENHA = "SenhaForte2026";
const FIX = path.join(process.cwd(), "tests", "fixtures");
const EMOP = ["EMOP", "DIPR", "COMP", "MAT", "ELEM", "REUT"].map((t) => path.join(FIX, `${t}0926.dbf`));
const RAR_REAL = process.env.AMOSTRAS_REAIS ? fs.readdirSync(process.env.AMOSTRAS_REAIS).find((f) => f.endsWith(".rar")) : undefined;

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

test.beforeAll(() => {
  execSync("npx dotenv -e .env.test -- tsx tests/e2e/preparar-banco.ts", { stdio: "inherit" });
  execSync(`npx dotenv -e .env.test -- tsx scripts/criar-admin.ts ${EMAIL} "Admin Importação"`, { env: { ...process.env, ADMIN_SENHA: SENHA }, stdio: "inherit" });
});

async function entrar(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Início" })).toBeVisible();
}

const ROTULO = { SINAPI: "SINAPI (Caixa)", EMOP: "EMOP-RJ", SICRO: "SICRO (DNIT)" };

type Arquivo = string | { name: string; mimeType: string; buffer: Buffer };

async function ateIniciar(page: Page, fonte: "SINAPI" | "EMOP" | "SICRO", arquivos: Arquivo[], competencia = "09/2026") {
  await page.goto("/importacao/nova");
  await page.getByLabel(ROTULO[fonte]).check();
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByLabel("Arquivos oficiais").setInputFiles(arquivos as Parameters<Page["setInputFiles"]>[1]);
  await page.getByRole("button", { name: "Analisar arquivos" }).click();
  await expect(page.getByText("Competência (lida do arquivo)")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(competencia, { exact: true })).toBeVisible();
  const iniciar = page.getByRole("button", { name: "Iniciar importação" });
  await expect(iniciar).toBeDisabled(); // exige confirmar a competência
  await page.getByLabel(`Confirmo que a competência é ${competencia}`).check();
  await iniciar.click();
}

async function importar(page: Page, fonte: "SINAPI" | "EMOP" | "SICRO", arquivos: Arquivo[], competencia?: string) {
  await ateIniciar(page, fonte, arquivos, competencia);
  await expect(page.getByRole("heading", { name: "7. Resultado da validação" })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole("heading", { name: /8. Pré-visualização/ })).toBeVisible();
}

test("importa EMOP (DBFs), confirma, valida e publica a base", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await entrar(page);
  await importar(page, "EMOP", EMOP);
  const confirmar = page.getByRole("button", { name: "Confirmar importação" });
  await expect(confirmar).toBeDisabled(); // há avisos: exige ciência
  await page.getByLabel(/Li e estou ciente/).check();
  await page.screenshot({ path: "test-results/importacao-previa.png", fullPage: true });
  await confirmar.click();
  await expect(page.getByRole("heading", { name: "10. Importação gravada" })).toBeVisible({ timeout: 120_000 });

  await page.goto("/importacao");
  const linha = page.getByRole("row", { name: /EMOP\s+RJ\s+09\/2026/ });
  await expect(linha.getByText("Aguardando validação")).toBeVisible();
  await linha.getByRole("button", { name: "Validar" }).click();
  await expect(linha.getByText("Validada — aguardando publicação")).toBeVisible();
  await linha.getByRole("button", { name: "Publicar" }).click();
  await expect(linha.getByText("Publicada", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/importacao-bases.png", fullPage: true });

  await page.goto("/");
  await expect(page.getByRole("cell", { name: /EMOP-RJ/ })).toBeVisible();
});

test("reenviar o mesmo arquivo é bloqueado e exige autorização", async ({ page }) => {
  await entrar(page);
  await ateIniciar(page, "EMOP", EMOP);
  await expect(page.locator("main").getByRole("alert")).toContainText(/já importado/);
  await expect(page.getByLabel(/Autorizo reimportar/)).toBeVisible();
});

test("importa SINAPI (ZIP oficial recortado) e baixa o relatório em Excel", async ({ page }) => {
  await entrar(page);
  await importar(page, "SINAPI", [path.join(FIX, "SINAPI-2026-09-amostra.zip")]);
  await expect(page.getByText("PRECO_AUSENTE")).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Baixar em Excel" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^importacao-SINAPI-2026-09-.*\.xlsx$/);
  await page.getByLabel(/Li e estou ciente/).check();
  await page.getByRole("button", { name: "Confirmar importação" }).click();
  await expect(page.getByRole("heading", { name: "10. Importação gravada" })).toBeVisible({ timeout: 120_000 });
});

test("arquivo que não é oficial é recusado com mensagem clara", async ({ page }) => {
  await entrar(page);
  await page.goto("/importacao/nova");
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByLabel("Arquivos oficiais").setInputFiles({ name: "planilha.xlsx", mimeType: "application/octet-stream", buffer: Buffer.from("não é uma planilha") });
  await page.getByRole("button", { name: "Analisar arquivos" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(/Layout não reconhecido/);
});

test.describe(() => {
  test.skip(!RAR_REAL, "defina AMOSTRAS_REAIS para testar o RAR oficial completo");
  test("RAR oficial completo da EMOP é aberto no navegador (WebAssembly)", async ({ page }) => {
    await entrar(page);
    await page.goto("/importacao/nova");
    await page.getByLabel("EMOP-RJ").check();
    await page.getByRole("button", { name: "Continuar" }).click();
    await page.getByLabel("Arquivos oficiais").setInputFiles(path.join(process.env.AMOSTRAS_REAIS!, RAR_REAL!));
    await page.getByRole("button", { name: "Analisar arquivos" }).click();
    await expect(page.getByText("EMOP DBF (dBase III, CP850)")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText("COMP0926.dbf — Composições analíticas")).toBeVisible();
  });
});

test("importa SICRO (relatórios XLSX), valida e publica; composição publicada pelo DNIT na consulta", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await entrar(page);
  const dir = path.join(FIX, "sicro");
  // nomes com acento: enviados como conteúdo (a ferramenta de teste não os aceita por caminho)
  const arquivos = fs.readdirSync(dir).map((n) => ({ name: n, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: fs.readFileSync(path.join(dir, n)) }));
  await importar(page, "SICRO", arquivos, "07/2026");
  await page.getByLabel(/Li e estou ciente/).check();
  await page.getByRole("button", { name: "Confirmar importação" }).click();
  await expect(page.getByRole("heading", { name: "10. Importação gravada" })).toBeVisible({ timeout: 120_000 });
  await page.goto("/importacao");
  const linha = page.getByRole("row", { name: /SICRO\s+RJ\s+07\/2026/ });
  await linha.getByRole("button", { name: "Validar" }).click();
  await expect(linha.getByText("Validada — aguardando publicação")).toBeVisible();
  await linha.getByRole("button", { name: "Publicar" }).click();
  await expect(linha.getByText("Publicada", { exact: true })).toBeVisible();

  await page.goto("/consulta");
  await page.getByLabel("Buscar").fill("0308308");
  await page.getByRole("button", { name: "Buscar" }).click();
  await page.getByRole("link", { name: "0308308" }).click();
  await expect(page.getByRole("heading", { name: /Composição de custo unitário publicada pelo DNIT/ })).toBeVisible();
  await expect(page.getByText("A — Equipamentos")).toBeVisible();
  await expect(page.getByRole("cell", { name: "E9050" })).toBeVisible();
  await expect(page.getByText("R$ 5.137,26").first()).toBeVisible();
  await page.screenshot({ path: "test-results/sicro-composicao.png", fullPage: true });
});
