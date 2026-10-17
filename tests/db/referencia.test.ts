import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executorPg, type Executor } from "@/lib/banco/executor";
import { dec } from "@/lib/calculo/decimal";
import { identificar, lerEmLotes } from "@/lib/importacao/processar";
import { confirmarImportacao, gravarLote, iniciarImportacao, publicarBase, validarBase, validarImportacao } from "@/lib/importacao/servico";
import { basePadraoPorFonte, basesDisponiveis } from "@/lib/referencia/bases";
import { buscarItens } from "@/lib/referencia/busca";
import { analiticaOficial, cabecalhoItem, historicoPrecos, usadoEm } from "@/lib/referencia/item";
import { precificar, type ContextoPreco } from "@/lib/referencia/precificacao";
import { ErroProprio, listarProprios, registrarCotacao, salvarComposicaoPropria, salvarInsumoProprio } from "@/lib/referencia/proprios";
import { arquivo, EMOP_DBFS, SINAPI_ZIP } from "../importacao/ajuda";
import { limparBanco, prisma } from "./ajuda";

let ex: Executor;
let usuarioId: string;
let revs: Record<string, string>;
const idDe = async (codigo: string) => (await prisma.itemReferencia.findFirstOrThrow({ where: { codigo } })).id;

beforeAll(async () => {
  ex = await executorPg(process.env.DATABASE_URL!);
  await limparBanco();
  for (const f of [{ codigo: "SINAPI", nome: "SINAPI" }, { codigo: "EMOP", nome: "EMOP" }, { codigo: "PROPRIA", nome: "Própria", oficial: false }]) await prisma.fonte.create({ data: f });
  usuarioId = (await prisma.usuario.create({ data: { email: "o@t.com", nome: "Orç", senhaHash: "x", papel: "ADMIN" } })).id;
  for (const arqs of [EMOP_DBFS.map((p) => arquivo(p)), [arquivo(SINAPI_ZIP)]]) {
    const id = await identificar(arqs, { uf: "RJ" });
    const ini = await iniciarImportacao(ex, { ident: id.identificacao, usuarioId, arquivos: id.originais });
    await lerEmLotes(id, (l) => gravarLote(ex, ini.importacaoId, l));
    await validarImportacao(ex, ini.importacaoId);
    await confirmarImportacao(ex, ini.importacaoId, { usuarioId, cienteAvisos: true });
    await validarBase(ex, ini.baseRevisaoId, usuarioId);
    await publicarBase(ex, ini.baseRevisaoId, usuarioId);
  }
  revs = Object.fromEntries(Object.entries(basePadraoPorFonte(await basesDisponiveis(ex))).map(([k, v]) => [k, v.revisaoId]));
});
afterAll(async () => { await ex.encerrar?.(); await prisma.$disconnect(); });

const ctx = (regimeSinapi = "SEM_DESONERACAO", regimeEmop = "SEM_DESONERACAO", data = "2026-10-01"): ContextoPreco => ({
  bases: [
    { fonte: "SINAPI", baseRevisaoId: revs.SINAPI, regime: regimeSinapi },
    { fonte: "EMOP", baseRevisaoId: revs.EMOP, regime: regimeEmop },
  ],
  dataReferencia: data,
});

describe("bases e busca", () => {
  it("lista bases publicadas com regimes", async () => {
    const b = await basesDisponiveis(ex);
    expect(b.map((x) => `${x.fonte}:${x.competencia}:${x.regimes.length}`).sort()).toEqual(["EMOP:2026-09:2", "SINAPI:2026-09:3"]);
  });
  it("busca por código (zeros à esquerda), descrição sem acento e filtro de tipo", async () => {
    const r1 = await buscarItens(ex, { texto: "01.001.0001", revisoes: Object.values(revs), incluirProprios: false });
    expect(r1.itens.map((i) => i.codigo)).toEqual(["01.001.0001-0", "01.001.0001-A"]);
    expect(r1.itens[0].precos).toEqual({ SEM_DESONERACAO: "211.9700" });
    const r2 = await buscarItens(ex, { texto: "podotatil", revisoes: Object.values(revs), incluirProprios: false, tipo: "COMPOSICAO" });
    expect(r2.itens.some((i) => i.codigo === "104658" && i.temAnalitica)).toBe(true);
    const zero = (await buscarItens(ex, { texto: "019", revisoes: Object.values(revs), incluirProprios: false })).itens;
    expect(zero.every((i) => i.codigo.startsWith("019"))).toBe(true);
    expect((await buscarItens(ex, { texto: "a", revisoes: Object.values(revs), incluirProprios: false })).total).toBe(0);
  });
  it("busca vazia lista todos os itens das bases selecionadas (com filtros e paginação)", async () => {
    const todos = await buscarItens(ex, { texto: "", revisoes: Object.values(revs), incluirProprios: true, limite: 5 });
    const esperado = await prisma.itemReferencia.count({ where: { fonte: { codigo: { in: ["SINAPI", "EMOP"] } } } });
    expect(todos.total).toBe(esperado);
    expect(todos.itens).toHaveLength(5);
    const pag2 = await buscarItens(ex, { texto: "", revisoes: Object.values(revs), incluirProprios: true, limite: 5, pagina: 2 });
    expect(pag2.itens[0].codigo).not.toBe(todos.itens[0].codigo);
    const so = await buscarItens(ex, { texto: "   ", revisoes: [revs.EMOP], incluirProprios: false, tipo: "COMPOSICAO", limite: 200 });
    expect(so.itens.every((i) => i.fonte === "EMOP" && i.tipo === "COMPOSICAO")).toBe(true);
    expect(so.total).toBe(await prisma.itemReferencia.count({ where: { fonte: { codigo: "EMOP" }, tipo: "COMPOSICAO" } }));
    // insumo publicado sem preço no RJ (e não usado em composição) também aparece — por código e na listagem
    const semPreco = await buscarItens(ex, { texto: "37600", revisoes: Object.values(revs), incluirProprios: false });
    expect(semPreco.itens.map((i) => [i.codigo, JSON.stringify(i.precos)])).toEqual([["37600", "{}"]]);
  });

  it("inclusão no orçamento: só itens com preço no regime adotado", async () => {
    const busca = (texto: string, emop: string, sinapi = "SEM_DESONERACAO") => buscarItens(ex, {
      texto, revisoes: Object.values(revs), incluirProprios: false,
      regimeAdotado: [{ revisaoId: revs.EMOP, regime: emop }, { revisaoId: revs.SINAPI, regime: sinapi }],
    });
    expect((await busca("01.001.0001", "COM_DESONERACAO")).itens.map((i) => i.codigo)).toEqual(["01.001.0001-A"]);
    expect((await busca("01.001.0001", "SEM_DESONERACAO")).itens.map((i) => i.codigo)).toEqual(["01.001.0001-0"]);
    // insumos EMOP têm preço único (sem regime): aparecem em qualquer regime
    expect((await busca("02083", "COM_DESONERACAO")).total).toBe(1);
    // sem preço publicado (custo zerado / em branco no RJ) não aparece para inclusão
    expect((await busca("105006", "SEM_DESONERACAO")).total).toBe(0);
    expect((await busca("37600", "SEM_DESONERACAO")).total).toBe(0);
    // listagem completa respeita o filtro: nenhum código EMOP "-0" com regime "com desoneração"
    const todos = await buscarItens(ex, { texto: "", revisoes: [revs.EMOP], incluirProprios: false, limite: 200, regimeAdotado: [{ revisaoId: revs.EMOP, regime: "COM_DESONERACAO" }] });
    expect(todos.itens.filter((i) => i.tipo === "COMPOSICAO").every((i) => /[A-E]$/.test(i.codigo))).toBe(true);
  });

  it("busca só nas revisões selecionadas", async () => {
    const r = await buscarItens(ex, { texto: "104658", revisoes: [revs.EMOP], incluirProprios: false });
    expect(r.total).toBe(0);
  });
});

describe("detalhe do item", () => {
  it("histórico de preços e analítica oficial", async () => {
    const id = await idDe("104658");
    const h = await historicoPrecos(ex, id, false);
    expect(h.map((x) => x.regime).sort()).toEqual(["COM_DESONERACAO", "SEM_DESONERACAO", "SEM_ENCARGOS"]);
    const a = await analiticaOficial(ex, id, revs.SINAPI, "SEM_DESONERACAO");
    expect(a?.linhas[0]).toMatchObject({ codigo: "88316", tipo: "COMPOSICAO", coeficiente: "1.2790000000" });
    // insumo não tem analítica: nada é inventado
    expect(await analiticaOficial(ex, await idDe("37600"), revs.SINAPI, "SEM_DESONERACAO")).toBeNull();
    const usado = await usadoEm(ex, await idDe("88316"), revs.SINAPI);
    expect(usado.map((u) => u.codigo)).toContain("104658");
    expect((await cabecalhoItem(ex, id, revs.SINAPI))?.descricao).toMatch(/^PISO PODOTÁTIL/);
  });
});

describe("precificação", () => {
  it("usa o preço publicado do regime escolhido; preço único quando a fonte não distingue", async () => {
    const [comp, emopServ, elem] = [await idDe("104658"), await idDe("01.001.0001-0"), await idDe("02083")];
    const sd = await precificar(ex, [comp, emopServ, elem], ctx("SEM_DESONERACAO"));
    const cd = await precificar(ex, [comp], ctx("COM_DESONERACAO"));
    expect(sd.get(comp)?.origem).toBe("PUBLICADO");
    expect(sd.get(comp)?.valor?.eq(cd.get(comp)!.valor!)).toBe(false);
    expect(sd.get(emopServ)?.valor?.toString()).toBe("211.97");
    expect(sd.get(elem)?.referencia).toMatch(/preço único/);
  });
  it("sem preço publicado ou sem base selecionada = AUSENTE (nunca zero)", async () => {
    const zerada = await idDe("105006");
    const r = await precificar(ex, [zerada], ctx());
    expect(r.get(zerada)).toMatchObject({ valor: null, origem: "AUSENTE" });
    const servico = await idDe("01.001.0001-0");
    const r2 = await precificar(ex, [servico], { bases: [], dataReferencia: "2026-10-01" });
    expect(r2.get(servico)?.pendencia).toMatch(/Nenhuma base EMOP/);
    // código EMOP "-0" consultado com regime "com desoneração": explica o motivo
    const r3 = await precificar(ex, [servico], ctx("SEM_DESONERACAO", "COM_DESONERACAO"));
    expect(r3.get(servico)).toMatchObject({ valor: null, pendencia: expect.stringMatching(/apenas no regime "Sem desoneração"/) });
  });
});

describe("itens e composições próprios", () => {
  it("cotação por data, composição mista (SINAPI + EMOP + próprio) com valor exato", async () => {
    const ins = await salvarInsumoProprio(ex, { codigo: "P-INS-01", descricao: "Locação de andaime (cotação)", unidade: "MES" }, usuarioId);
    await registrarCotacao(ex, { itemId: ins, data: "2026-08-15", valor: "100,00", fonteCotacao: "Fornecedor A" }, usuarioId);
    await registrarCotacao(ex, { itemId: ins, data: "2026-09-20", valor: "123,4567", fonteCotacao: "Fornecedor B" }, usuarioId);
    const [s, e] = [await idDe("104658"), await idDe("01.001.0001-0")];
    const comp = await salvarComposicaoPropria(ex, {
      codigo: "P-COMP-01", descricao: "Serviço próprio misto", unidade: "UN",
      componentes: [{ itemId: s, coeficiente: "0,5" }, { itemId: e, coeficiente: "2" }, { itemId: ins, coeficiente: "0.0000001" }],
    }, usuarioId);
    const r = await precificar(ex, [comp, ins], ctx("SEM_DESONERACAO", "SEM_DESONERACAO", "2026-09-30"));
    const ps = (await precificar(ex, [s], ctx())).get(s)!.valor!;
    const esperado = ps.times("0.5").plus(dec("211.97").times(2)).plus(dec("123.4567").times("0.0000001"));
    expect(r.get(comp)?.origem).toBe("CALCULADO");
    expect(r.get(comp)?.valor?.toString()).toBe(esperado.toString());
    expect(r.get(ins)?.valor?.toString()).toBe("123.4567");
    // data anterior usa a cotação vigente naquela data
    expect((await precificar(ex, [ins], ctx("SEM_DESONERACAO", "SEM_DESONERACAO", "2026-09-01"))).get(ins)?.valor?.toString()).toBe("100");
    // componente sem preço → pendência explicada
    const semCusto = await salvarComposicaoPropria(ex, { codigo: "P-COMP-02", descricao: "Usa composição sem custo", unidade: "UN", componentes: [{ itemId: await idDe("105006"), coeficiente: "1" }] }, usuarioId);
    expect((await precificar(ex, [semCusto], ctx())).get(semCusto)?.pendencia).toMatch(/SINAPI 105006/);
  });

  it("composição própria pode conter outra própria; ciclo é recusado", async () => {
    const a = await salvarComposicaoPropria(ex, { codigo: "CICLO-A", descricao: "Composição A", unidade: "UN", componentes: [{ itemId: await idDe("01.001.0001-0"), coeficiente: "1" }] }, usuarioId);
    const b = await salvarComposicaoPropria(ex, { codigo: "CICLO-B", descricao: "Composição B", unidade: "UN", componentes: [{ itemId: a, coeficiente: "2" }] }, usuarioId);
    expect((await precificar(ex, [b], ctx())).get(b)?.valor?.toString()).toBe("423.94");
    await expect(salvarComposicaoPropria(ex, { itemId: a, codigo: "CICLO-A", descricao: "Composição A", unidade: "UN", componentes: [{ itemId: b, coeficiente: "1" }] }, usuarioId))
      .rejects.toThrow(/circular entre composições: CICLO-A → CICLO-B → CICLO-A/);
    await expect(salvarComposicaoPropria(ex, { itemId: a, codigo: "CICLO-A", descricao: "Composição A", unidade: "UN", componentes: [{ itemId: a, coeficiente: "1" }] }, usuarioId))
      .rejects.toThrow(/si mesma/);
  });

  it("versões preservadas, concorrência e códigos oficiais protegidos", async () => {
    const e = await idDe("01.001.0001-0");
    const id = await salvarComposicaoPropria(ex, { codigo: "VERS-1", descricao: "Versão 1", unidade: "M2", componentes: [{ itemId: e, coeficiente: "1" }] }, usuarioId);
    await salvarComposicaoPropria(ex, { itemId: id, versaoEsperada: 1, codigo: "VERS-1", descricao: "Versão 2", unidade: "M2", componentes: [{ itemId: e, coeficiente: "3" }] }, usuarioId);
    expect(await prisma.composicaoVersao.count({ where: { itemId: id } })).toBe(2);
    expect(await prisma.itemVersao.count({ where: { itemId: id } })).toBe(2);
    await expect(salvarComposicaoPropria(ex, { itemId: id, versaoEsperada: 1, codigo: "VERS-1", descricao: "Edição antiga", unidade: "M2", componentes: [{ itemId: e, coeficiente: "9" }] }, usuarioId))
      .rejects.toThrow(/alterado por outra pessoa/);
    await expect(salvarInsumoProprio(ex, { codigo: "02083", descricao: "Tentativa", unidade: "M3" }, usuarioId)).rejects.toThrow(/base oficial EMOP/);
    await expect(salvarInsumoProprio(ex, { codigo: "VERS-1", descricao: "Duplicado", unidade: "M3" }, usuarioId)).rejects.toThrow(ErroProprio);
    await expect(salvarComposicaoPropria(ex, { codigo: "X1", descricao: "Coef", unidade: "UN", componentes: [{ itemId: e, coeficiente: "0" }] }, usuarioId)).rejects.toThrow(/Coeficiente inválido/);
    const lista = await listarProprios(ex);
    expect(lista.find((x) => x.codigo === "VERS-1")).toMatchObject({ descricao: "Versão 2", versao: 2, componentes: 1 });
    // busca encontra itens próprios
    const r = await buscarItens(ex, { texto: "Versão", revisoes: [], incluirProprios: true });
    expect(r.itens.map((i) => `${i.fonte}:${i.codigo}`)).toContain("PROPRIA:VERS-1");
    // os componentes oficiais não podem ser alterados (versões são imutáveis)
    await expect(prisma.composicaoComponente.updateMany({ where: { composicaoVersao: { itemId: id } }, data: { coeficiente: 5 } })).rejects.toThrow();
  });
});
