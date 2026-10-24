import { expect, test } from "@playwright/test";

const EMAIL = "orcamento.e2e@exemplo.com.br";
const SENHA = "SenhaForte2026";

test("tema claro, escuro e automático (segue o sistema); escolha lembrada", async ({ browser }) => {
  const ctx = await browser.newContext({ colorScheme: "dark" });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Início" })).toBeVisible();
  const tema = () => page.evaluate(() => document.documentElement.dataset.tema);
  // tela: textos 1 px maiores; impressão: tamanhos originais
  const tamanhos = () => page.evaluate(() => {
    const sm = document.querySelector("nav a")!;
    return [getComputedStyle(sm).fontSize, getComputedStyle(document.body).fontSize, getComputedStyle(document.querySelector("h1")!).fontSize];
  });
  expect(await tamanhos()).toEqual(["15px", "17px", "25px"]);
  await page.emulateMedia({ media: "print" });
  expect(await tamanhos()).toEqual(["14px", "16px", "24px"]);
  await page.emulateMedia({ media: "screen" });
  // automático: segue o sistema (escuro aqui)
  await expect(page.getByLabel("Tema")).toHaveValue("auto");
  expect(await tema()).toBe("escuro");
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(tema).toBe("claro");
  // escolha manual vale mesmo com o sistema em outro tema e fica lembrada
  await page.getByLabel("Tema").selectOption("escuro");
  expect(await tema()).toBe("escuro");
  await page.reload();
  expect(await tema()).toBe("escuro");
  await expect(page.getByLabel("Tema")).toHaveValue("escuro");
  const fundo = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(fundo).toBe("rgb(11, 18, 32)");
  for (const [rota, nome] of [["/orcamentos", "lista"], ["/bdi", "bdi"], ["/contratos", "contratos"]] as const) {
    await page.goto(rota);
    await page.screenshot({ path: `test-results/tema-escuro-${nome}.png`, fullPage: true });
  }
  await page.goto("/orcamentos");
  await page.getByRole("link", { name: "Reforma da cobertura", exact: true }).click();
  await expect(page.getByLabel("Quantidade 1.1")).toBeVisible();
  await page.screenshot({ path: "test-results/tema-escuro-orcamento.png", fullPage: true });
  await page.getByRole("link", { name: "Relatórios" }).click();
  await page.getByRole("button", { name: "Visualizar — Orçamento sintético" }).click();
  await expect(page.getByRole("region", { name: "Visualização — Orçamento sintético" })).toBeVisible();
  await page.screenshot({ path: "test-results/tema-escuro-relatorio.png", fullPage: true });
  await page.getByLabel("Tema").selectOption("claro");
  expect(await tema()).toBe("claro");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  expect(await tema()).toBe("claro");
  await page.getByLabel("Tema").selectOption("auto");
  expect(await tema()).toBe("escuro");
});
