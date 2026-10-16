import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";
import { adaptadorEmopDbf, formatarCodigoEmop, juntarDescricao, regimeEmop } from "@/lib/importacao/adaptadores/emop-dbf";
import { adaptadorSinapiXlsx2025 } from "@/lib/importacao/adaptadores/sinapi-xlsx-2025";
import { arquivoDeBytes } from "@/lib/importacao/leitores/arquivo";
import { expandirPacotes } from "@/lib/importacao/leitores/pacote";
import { identificar } from "@/lib/importacao/processar";
import { arquivo, coletor, EMOP_DBFS, SINAPI_ZIP } from "./ajuda";

const emop = () => EMOP_DBFS.map((p) => arquivo(p));

describe("EMOP — regras do Catálogo de Referência", () => {
  it("regime pelo dígito final", () => {
    expect(regimeEmop("01.001.0001-0")).toBe("SEM_DESONERACAO");
    expect(regimeEmop("19.004.0001-4")).toBe("SEM_DESONERACAO");
    expect(regimeEmop("01.001.0001-A")).toBe("COM_DESONERACAO");
    expect(regimeEmop("19.004.0001-E")).toBe("COM_DESONERACAO");
    expect(regimeEmop("01.001.0001-5")).toBeNull(); // dígito 5/F é do orçamentista, não da EMOP
    expect(regimeEmop("01.001.0001-F")).toBeNull();
  });
  it("código do REUT e junção de descrições", () => {
    expect(formatarCodigoEmop("0100100751")).toBe("01.001.0075-1");
    expect(formatarCodigoEmop("010010075B")).toBe("01.001.0075-B");
    expect(juntarDescricao(["AREIA LAVADA, GROSSA, PARA REGIAO METROP", "OLITANA DO RIO DE JANEIRO   "])).toBe("AREIA LAVADA, GROSSA, PARA REGIAO METROPOLITANA DO RIO DE JANEIRO");
    expect(juntarDescricao(["FAMILIA 01.050      ", "PROJETOS E CONSULTORIA   ", "     "])).toBe("FAMILIA 01.050 PROJETOS E CONSULTORIA");
    expect(juntarDescricao([null, "   "])).toBeNull();
  });
});

describe("adaptador EMOP (amostra real 09/2026)", () => {
  it("identifica competência, regimes e arquivos", async () => {
    const r = await adaptadorEmopDbf.identificar(emop(), { uf: "RJ" });
    expect(r?.ok).toBe(true);
    if (!r?.ok) return;
    expect(r.identificacao.competencia).toBe("2026-09");
    expect(r.identificacao.regimes.map((x) => x.codigo)).toEqual(["SEM_DESONERACAO", "COM_DESONERACAO"]);
    expect(r.identificacao.dataEmissao).toBe("2026-10-05");
  });

  it("lê serviços, preços, analíticas; separa índices; preserva zeros à esquerda", async () => {
    const r = await adaptadorEmopDbf.identificar(emop(), { uf: "RJ" });
    if (!r?.ok) throw new Error("não identificou");
    const c = coletor();
    await adaptadorEmopDbf.ler(emop(), r.identificacao, c.emissor);
    const servico = c.itens.find((i) => i.codigo === "01.001.0001-0")!;
    expect(servico).toMatchObject({ tipo: "COMPOSICAO", descricao: "LIMITE DE PLASTICIDADE", unidade: "UN" });
    const preco = c.precos.find((p) => p.codigo === "01.001.0001-0")!;
    expect(preco).toMatchObject({ regime: "SEM_DESONERACAO", valor: "211.97" });
    expect(c.precos.find((p) => p.codigo === "01.001.0001-A")).toMatchObject({ regime: "COM_DESONERACAO", valor: "202.69" });
    // índice setorial não vira item nem preço
    expect(c.itens.some((i) => i.codigo.startsWith("05.100.9999"))).toBe(false);
    expect(c.ocorrencias.filter((o) => o.regra === "INDICE_SETORIAL").map((o) => o.valor)).toEqual(["8683.00", "8137.00"]);
    // elementares: código com zeros à esquerda, preço único (regime nulo)
    const elem = c.precos.filter((p) => p.tipo === "INSUMO");
    expect(elem.every((p) => p.regime === null && /^\d{5}$/.test(p.codigo))).toBe(true);
    expect(elem.some((p) => p.codigo.startsWith("0"))).toBe(true);
    // insumo publicado sem unidade: unidade nula, nunca presumida
    expect(c.itens.find((i) => i.codigo === "01294")?.unidade).toBeNull();
    // componentes com quantidade e percentual exatos (texto, sem float)
    const comPct = c.componentes.find((x) => x.percentual && Number(x.percentual) > 0)!;
    expect(comPct.coeficiente).toMatch(/^\d+(\.\d+)?$/);
    expect(comPct.percentual).toBe("3");
    // recálculo de conferência
    const rec = c.ocorrencias.find((o) => o.regra === "RECALCULO_RESUMO")!;
    expect(rec.mensagem).toMatch(/0 divergentes/);
    expect(c.ocorrencias.filter((o) => o.severidade === "ERRO")).toEqual([]);
  });

  it("recusa conjunto incompleto e competências misturadas", async () => {
    const r1 = await adaptadorEmopDbf.identificar(emop().filter((a) => !a.nome.startsWith("COMP")), { uf: "RJ" });
    expect(r1).toMatchObject({ ok: false, motivo: expect.stringMatching(/faltam COMPMMAA/) });
    const outros = emop();
    outros[0] = { ...outros[0], nome: "EMOP0826.dbf" };
    const r2 = await adaptadorEmopDbf.identificar(outros, { uf: "RJ" });
    expect(r2).toMatchObject({ ok: false, motivo: expect.stringMatching(/competências diferentes/) });
    const r3 = await adaptadorEmopDbf.identificar(emop(), { uf: "SP" });
    expect(r3).toMatchObject({ ok: false });
  });

  it("recusa DBF com campos diferentes do layout conhecido", async () => {
    const arqs = emop();
    const elem = arqs.find((a) => a.nome.startsWith("ELEM"))!;
    const bytes = new Uint8Array(await elem.bytes());
    bytes.set(new TextEncoder().encode("VALOR\0"), 32 + 32); // renomeia o campo PRECO
    arqs[arqs.indexOf(elem)] = arquivoDeBytes(elem.nome, bytes);
    const r = await adaptadorEmopDbf.identificar(arqs, { uf: "RJ" });
    expect(r).toMatchObject({ ok: false, motivo: expect.stringMatching(/ELEM: campos ausentes.*PRECO:N/) });
  });

  it("aceita os DBFs dentro de um ZIP", async () => {
    const zip = zipSync(Object.fromEntries(EMOP_DBFS.map((p) => [`boletim/${path.basename(p)}`, new Uint8Array(fs.readFileSync(p))])));
    const id = await identificar([arquivoDeBytes("emop.zip", zip)], { uf: "RJ" });
    expect(id.identificacao.fonte).toBe("EMOP");
    expect(id.originais[0].sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("adaptador SINAPI (amostra real 09/2026)", () => {
  const sinapi = async () => expandirPacotes([arquivo(SINAPI_ZIP)]);

  it("identifica e lê só a UF RJ, com os 3 regimes", async () => {
    const arqs = await sinapi();
    const r = await adaptadorSinapiXlsx2025.identificar(arqs, { uf: "RJ" });
    if (!r?.ok) throw new Error(r ? r.motivo : "não identificou");
    expect(r.identificacao.competencia).toBe("2026-09");
    expect(r.identificacao.regimes.map((x) => x.codigo)).toEqual(["SEM_DESONERACAO", "COM_DESONERACAO", "SEM_ENCARGOS"]);
    const c = coletor();
    await adaptadorSinapiXlsx2025.ler(arqs, r.identificacao, c.emissor);
    expect(c.ocorrencias.filter((o) => o.severidade === "ERRO")).toEqual([]);
    // código extraído da fórmula HYPERLINK/MATCH (valor gravado é 0)
    const comps = new Set(c.precos.filter((p) => p.tipo === "COMPOSICAO").map((p) => p.codigo));
    expect([...comps].sort()).toEqual(["104658", "105006", "88316"]);
    // custo zerado = sem custo (nota oficial)
    const zerada = c.precos.filter((p) => p.codigo === "105006");
    expect(zerada).toHaveLength(3);
    expect(zerada.every((p) => p.valor === null && (p.atributos as Record<string, string>).sem_custo)).toBe(true);
    // preço em branco no RJ = sem preço
    expect(c.precos.filter((p) => p.codigo === "37600").every((p) => p.valor === null)).toBe(true);
    // cada insumo tem preço nos 3 regimes
    const regimes = new Set(c.precos.filter((p) => p.tipo === "INSUMO").map((p) => p.regime));
    expect([...regimes].sort()).toEqual(["COM_DESONERACAO", "SEM_DESONERACAO", "SEM_ENCARGOS"]);
    // analítica com ordem sequencial e coeficientes exatos
    const a = c.componentes.filter((x) => x.composicao === "104658");
    expect(a.map((x) => x.ordem)).toEqual(a.map((_, i) => i + 1));
    expect(a.find((x) => x.componenteCodigo === "88316")).toMatchObject({ componenteTipo: "COMPOSICAO", coeficiente: "1.279" });
  });

  it("recusa competência divergente entre nome e conteúdo", async () => {
    const arqs = await sinapi();
    const renomeado = { ...arqs[0], nome: "SINAPI_Referência_2026_08.xlsx" };
    const r = await adaptadorSinapiXlsx2025.identificar([renomeado], { uf: "RJ" });
    expect(r).toMatchObject({ ok: false, motivo: expect.stringMatching(/diverge do nome/) });
  });

  it("recusa UF inexistente no cabeçalho ao ler", async () => {
    const arqs = await sinapi();
    const r = await adaptadorSinapiXlsx2025.identificar(arqs, { uf: "XX" });
    if (!r?.ok) throw new Error("deveria identificar");
    await expect(adaptadorSinapiXlsx2025.ler(arqs, r.identificacao, coletor().emissor)).rejects.toThrow(/UF XX não encontrada/);
  });
});

describe("arquivos inválidos", () => {
  it("arquivo desconhecido não é aceito por nenhum adaptador", async () => {
    const lixo = arquivoDeBytes("planilha.xlsx", strToU8("não é um xlsx"));
    await expect(identificar([lixo], { uf: "RJ" })).rejects.toThrow(/Layout não reconhecido/);
  });
  it("ZIP corrompido", async () => {
    const bytes = new Uint8Array(fs.readFileSync(SINAPI_ZIP)).slice(0, 2000);
    await expect(identificar([arquivoDeBytes("SINAPI.zip", bytes)], { uf: "RJ" })).rejects.toThrow(/ZIP inválido/);
  });
  it("ZIP com caminho perigoso é rejeitado", async () => {
    const zip = zipSync({ "../../etc/x.dbf": strToU8("x") });
    await expect(expandirPacotes([arquivoDeBytes("a.zip", zip)])).rejects.toThrow(/Caminho inválido/);
  });
  it("DBF truncado gera erro na leitura", async () => {
    const arqs = emop();
    const i = arqs.findIndex((a) => a.nome.startsWith("COMP"));
    const b = await arqs[i].bytes();
    arqs[i] = arquivoDeBytes(arqs[i].nome, b.slice(0, b.length - 40));
    const r = await adaptadorEmopDbf.identificar(arqs, { uf: "RJ" });
    if (!r?.ok) throw new Error("deveria identificar");
    await expect(adaptadorEmopDbf.ler(arqs, r.identificacao, coletor().emissor)).rejects.toThrow(/truncado|incompleto/);
  });
});

// Arquivos oficiais completos (opcional): defina AMOSTRAS_REAIS com a pasta que contém o RAR e o ZIP originais.
const reais = process.env.AMOSTRAS_REAIS;
describe.skipIf(!reais)("arquivos oficiais completos 09/2026", () => {
  it("EMOP: totais conhecidos", async () => {
    const rar = fs.readdirSync(reais!).find((f) => f.endsWith(".rar"))!;
    const id = await identificar([arquivo(path.join(reais!, rar))], { uf: "RJ" });
    const c = coletor();
    await id.adaptador.ler(id.entradas, id.identificacao, c.emissor);
    expect({ itens: c.itens.length, precos: c.precos.length, componentes: c.componentes.length }).toEqual({ itens: 29458, precos: 29458, componentes: 103866 });
  }, 120_000);
  it("SINAPI: totais conhecidos", async () => {
    const zip = fs.readdirSync(reais!).find((f) => /SINAPI.*\.zip$/.test(f))!;
    const id = await identificar([arquivo(path.join(reais!, zip))], { uf: "RJ" });
    const c = coletor();
    await id.adaptador.ler(id.entradas, id.identificacao, c.emissor);
    expect(c.precos.length).toBe(46431);
    expect(c.precos.filter((p) => p.valor === null).length).toBe(10659);
    expect(c.componentes.length).toBe(56568);
  }, 120_000);
});
