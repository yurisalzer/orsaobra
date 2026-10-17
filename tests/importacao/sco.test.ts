import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import fs from "node:fs";
import path from "node:path";
import { adaptadorScoXlsx } from "@/lib/importacao/adaptadores/sco-xlsx";
import { arquivoDeBytes } from "@/lib/importacao/leitores/arquivo";
import { identificar } from "@/lib/importacao/processar";
import { arquivo, coletor, SCO_XLSX } from "./ajuda";

const sco = (p?: ("O" | "D")[]) => SCO_XLSX(p).map((x) => arquivo(x));

async function lerTudo(pacotes?: ("O" | "D")[]) {
  const r = await adaptadorScoXlsx.identificar(sco(pacotes), { uf: "RJ" });
  if (!r?.ok) throw new Error(r ? r.motivo : "não identificou");
  const c = coletor();
  await adaptadorScoXlsx.ler(sco(pacotes), r.identificacao, c.emissor);
  return { ident: r.identificacao, ...c };
}

describe("adaptador SCO-Rio (amostra real 09/2026, pacotes O e D)", () => {
  it("identifica referência e regimes; aceita os ZIPs oficiais; recusa pacote incompleto", async () => {
    const r = await adaptadorScoXlsx.identificar(sco(), { uf: "RJ" });
    expect(r).toMatchObject({ ok: true, identificacao: { fonte: "SCO", uf: "RJ", competencia: "2026-09" } });
    if (!r?.ok) return;
    expect(r.identificacao.regimes.map((x) => x.codigo)).toEqual(["SEM_DESONERACAO", "COM_DESONERACAO"]);
    expect(r.identificacao.arquivos).toHaveLength(6);
    // só o O: um regime, com aviso
    const o = await adaptadorScoXlsx.identificar(sco(["O"]), { uf: "RJ" });
    expect(o).toMatchObject({ ok: true, identificacao: { regimes: [{ codigo: "SEM_DESONERACAO" }], observacoes: expect.arrayContaining([expect.stringMatching(/Somente o pacote onerado/)]) } });
    // os dois ZIPs como publicados
    const zip = (p: "O" | "D") => arquivoDeBytes(`ARQUIVOS-COM-CATALOGO-DAS-COMPOSICOES-${p}-EXCEL.zip`, zipSync(Object.fromEntries(SCO_XLSX([p]).map((f) => [path.basename(f), new Uint8Array(fs.readFileSync(f))]))));
    const id = await identificar([zip("O"), zip("D")], { uf: "RJ" });
    expect(id.identificacao.fonte).toBe("SCO");
    const inc = await adaptadorScoXlsx.identificar(sco().filter((a) => !a.nome.includes("FGV07")), { uf: "RJ" });
    expect(inc).toMatchObject({ ok: false, motivo: expect.stringMatching(/incompleto.*FGV07/) });
  });

  it("serviços com o código publicado (letra de revisão) e preço por regime; D com códigos próprios", async () => {
    const c = await lerTudo();
    const preco = (codigo: string) => c.precos.filter((p) => p.codigo === codigo).map((p) => `${p.regime}=${p.valor}`);
    expect(preco("AD 05.05.0050 (/)")).toEqual(["SEM_DESONERACAO=323.38"]);
    expect(preco("AD 04.05.0050 (/)")).toEqual(["COM_DESONERACAO=305.62"]);
    expect(preco("AD 05.05.0650 (B)")).toEqual(["SEM_DESONERACAO=337.02"]);
    expect(c.itens.find((i) => i.codigo === "AD 05.05.0650 (B)")).toMatchObject({ tipo: "COMPOSICAO", unidade: "m", grupo: "AD 05.05 Ensaios e Pesquisas em Solo" });
    expect(c.itens.find((i) => i.codigo === "AD 05.05.0650 (B)")!.atributos).toMatchObject({ "área": expect.stringMatching(/^AD Administração Local/), grupo: "AD 05 Ensaios e Sondagens" });
    // material comum aos dois pacotes: preço nos dois regimes; mão de obra com códigos próprios no D
    expect(preco("MAT006100")).toEqual(["SEM_DESONERACAO=112.7", "COM_DESONERACAO=112.7"]);
    expect(preco("MOD002450")).toEqual(["SEM_DESONERACAO=27.61"]);
    expect(preco("MOD902450")).toEqual(["COM_DESONERACAO=26.1"]);
    expect(c.itens.find((i) => i.codigo === "MOD002450" && i.prioridade === 10)).toMatchObject({ grupo: "Mão de Obra Direta", unidade: "h" });
    expect(c.itens.find((i) => i.codigo === "MOD902450" && i.prioridade === 10)).toMatchObject({ grupo: "Mão de Obra Direta" });
    expect(c.itens.find((i) => i.codigo === "RSE002700" && i.prioridade === 10)!.atributos).toEqual({ reutiliza: "SE 20.20.0050 (A)" });
    expect(c.ocorrencias).toEqual([]);
  });

  it("composições como publicadas; EVE em % sem preço em R$ e marcado na composição", async () => {
    const c = await lerTudo();
    const comp = (codigo: string) => c.componentes.filter((x) => x.composicao === codigo).map((x) => `${x.componenteCodigo}:${x.coeficiente}${x.situacao ? `:${x.situacao}` : ""}`);
    expect(comp("AD 05.05.0706 (A)")).toEqual(["MOD002450:2.5", "MOD002550:2.5", "MOI002200:0.2", "EVE000050:3:% sobre a mão de obra"]);
    expect(comp("AD 05.05.0050 (/)")).toEqual(["RSE002700:1.85:Reutilização"]);
    expect(comp("AD 04.10.0050 (/)")).toEqual(["REQ903650:0.9091:Reutilização", "REQ903750:0.3896:Reutilização"]);
    expect(c.precos.filter((p) => p.codigo === "EVE000050").map((p) => p.valor)).toEqual([null, null]);
    expect(c.itens.find((i) => i.codigo === "EVE000050" && i.prioridade === 10)!.atributos).toEqual({ percentual_sobre_mao_de_obra: "3" });
    // serviço reutilizado como elementar (cabeçalho "(RSE006180)")
    expect(c.itens.find((i) => i.codigo === "AD 10.10.0100 (/)" && i.prioridade === 40)!.atributos).toEqual({ reutilizado_como: "RSE006180" });
  });

  it("regime desmarcado no assistente: o pacote não é lido", async () => {
    const r = await adaptadorScoXlsx.identificar(sco(), { uf: "RJ" });
    if (!r?.ok) throw new Error("não identificou");
    const c = coletor();
    await adaptadorScoXlsx.ler(sco(), { ...r.identificacao, regimes: r.identificacao.regimes.filter((g) => g.codigo === "SEM_DESONERACAO") }, c.emissor);
    expect(c.precos.some((p) => p.regime === "COM_DESONERACAO")).toBe(false);
    expect(c.itens.some((i) => i.codigo.startsWith("AD 04"))).toBe(false);
  });
});
