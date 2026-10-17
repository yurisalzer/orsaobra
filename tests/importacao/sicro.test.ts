import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import fs from "node:fs";
import path from "node:path";
import { adaptadorSicroXlsx, type AnaliticaSicro } from "@/lib/importacao/adaptadores/sicro-xlsx";
import { arquivoDeBytes } from "@/lib/importacao/leitores/arquivo";
import { identificar } from "@/lib/importacao/processar";
import { arquivo, coletor, SICRO_XLSX } from "./ajuda";

const sicro = () => SICRO_XLSX.map((p) => arquivo(p));

describe("adaptador SICRO (amostra real RJ 07/2026)", () => {
  it("identifica UF, competência, regimes e os 7 relatórios", async () => {
    const r = await adaptadorSicroXlsx.identificar(sicro(), { uf: "RJ" });
    expect(r?.ok).toBe(true);
    if (!r?.ok) return;
    expect(r.identificacao).toMatchObject({ fonte: "SICRO", uf: "RJ", competencia: "2026-07" });
    expect(r.identificacao.regimes.map((x) => x.codigo)).toEqual(["SEM_DESONERACAO", "COM_DESONERACAO"]);
    expect(r.identificacao.arquivos).toHaveLength(7);
  });

  it("também reconhece os XLSX dentro de um ZIP; recusa pacote incompleto ou de outra UF", async () => {
    const zip = zipSync(Object.fromEntries(SICRO_XLSX.map((p) => [`rj-07-2026/${path.basename(p)}`, new Uint8Array(fs.readFileSync(p))])));
    const id = await identificar([arquivoDeBytes("rj-07-2026.zip", zip)], { uf: "RJ" });
    expect(id.identificacao.fonte).toBe("SICRO");
    const r = await adaptadorSicroXlsx.identificar(sicro().filter((a) => !a.nome.includes("Materiais")), { uf: "RJ" });
    expect(r).toMatchObject({ ok: false, motivo: expect.stringMatching(/faltam .*Materiais/) });
    const r2 = await adaptadorSicroXlsx.identificar(sicro(), { uf: "SP" });
    expect(r2).toMatchObject({ ok: false, motivo: expect.stringMatching(/UF RJ/) });
  });

  it("preços: composição só sem desoneração; mão de obra e equipamento nos dois regimes; material único; '-' = sem preço", async () => {
    const r = await adaptadorSicroXlsx.identificar(sicro(), { uf: "RJ" });
    if (!r?.ok) throw new Error("não identificou");
    const c = coletor();
    await adaptadorSicroXlsx.ler(sicro(), r.identificacao, c.emissor);
    const precos = (codigo: string) => c.precos.filter((p) => p.codigo === codigo).map((p) => `${p.regime}=${p.valor}`);
    expect(precos("0307731")).toEqual(["SEM_DESONERACAO=192.31"]);
    expect(precos("P9821")).toEqual(["SEM_DESONERACAO=40.25", "COM_DESONERACAO=38.0383"]);
    expect(precos("E9050")).toEqual(["SEM_DESONERACAO=421.0781", "COM_DESONERACAO=418.701"]);
    expect(precos("M0798")).toEqual(["null=147.6265"]);
    expect(precos("M0104")).toEqual(["null=null"]);
    expect(c.precos.find((p) => p.codigo === "E9050" && p.regime === "SEM_DESONERACAO")!.atributos).toMatchObject({ custo_produtivo: "421.0781", custo_improdutivo: "221.7255" });
    expect(c.itens.find((i) => i.codigo === "E9050")).toMatchObject({ tipo: "INSUMO", unidade: "h", grupo: "Equipamento" });
    expect(c.itens.find((i) => i.codigo === "0308308")).toMatchObject({ tipo: "COMPOSICAO", unidade: "un", grupo: "Composição" });
    expect(c.componentes).toEqual([]);
    expect(c.ocorrencias.filter((o) => o.severidade !== "INFO")).toEqual([]);
  });

  it("composição analítica guardada como publicada (equipamentos, mão de obra, FIC, materiais, auxiliares, tempo fixo, transporte)", async () => {
    const r = await adaptadorSicroXlsx.identificar(sicro(), { uf: "RJ" });
    if (!r?.ok) throw new Error("não identificou");
    const c = coletor();
    await adaptadorSicroXlsx.ler(sicro(), r.identificacao, c.emissor);
    const an = c.precos.find((p) => p.codigo === "0308308")!.atributos!.analitica_sicro as AnaliticaSicro;
    expect(an.fic).toBe("0.03317");
    expect(an.producao).toEqual({ quantidade: "2", unidade: "un" });
    expect(an.equipamentos[0]).toEqual({ codigo: "E9050", descricao: expect.stringMatching(/^Guindaste/), quantidade: "0.48193", operativa: "1", improdutiva: "0", custoProdutivo: "421.0781", custoImprodutivo: "221.7255", custoHorario: "202.9302" });
    expect(an.maoDeObra.map((m) => `${m.codigo}:${m.quantidade}:${m.custo}`)).toEqual(["P9801:4:129.2464", "P9830:1:43.5214"]);
    expect(an.auxiliares[0]).toMatchObject({ codigo: "1108059", quantidade: "0.02305", unidade: "m³", custoUnitario: "3342.67", custo: "77.0485" });
    expect(an.totais).toMatchObject({ equipamentos: "202.9302", maoDeObra: "172.7678", execucaoHorario: "375.698", execucaoUnitario: "187.849", fic: "4.6376" });
    expect(an.totais.total).toBe("5137.26");
    const neop = c.precos.find((p) => p.codigo === "0307731")!.atributos!.analitica_sicro as AnaliticaSicro;
    expect(neop.tempoFixo).toEqual([
      { item: "M0798", descricao: "Apoio de neoprene fretado - Caminhão carroceria 15 t", codigo: "5914655", quantidade: "0.0032", unidade: "t", custoUnitario: "41.14", custo: "0.1316" },
      { item: "M0786", descricao: "Placa de poliestireno expandido (EPS) - Caminhão carroceria 15 t", codigo: "5914655", quantidade: "0.00007", unidade: "t", custoUnitario: "41.14", custo: "0.0029" },
    ]);
    expect(neop.transporte[0]).toMatchObject({ item: "M0798", quantidade: "0.0032", unidade: "tkm", ln: "5914449", rp: "5914464", p: "5914479", custo: null });
    expect(neop.totais).toMatchObject({ material: "150.657", subtotal: "192.1785", tempoFixo: "0.1345", transporte: null, total: "192.31" });
  });
});
