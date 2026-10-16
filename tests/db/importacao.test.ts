import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { executorPg, type Executor } from "@/lib/banco/executor";
import { identificar, lerEmLotes } from "@/lib/importacao/processar";
import { expandirPacotes } from "@/lib/importacao/leitores/pacote";
import {
  confirmarImportacao, descartarBase, ErroImportacao, gravarLote, iniciarImportacao, publicarBase, validarBase, validarImportacao,
} from "@/lib/importacao/servico";
import { amostraStaging, detalheImportacao, listarBases, listarImportacoes, verificacoes } from "@/lib/importacao/consultas";
import { arquivo, EMOP_DBFS, SINAPI_ZIP } from "../importacao/ajuda";
import { limparBanco, prisma } from "./ajuda";

let ex: Executor;
let usuarioId: string;

beforeAll(async () => { ex = await executorPg(process.env.DATABASE_URL!); });
afterAll(async () => { await ex.encerrar?.(); await prisma.$disconnect(); });
beforeEach(async () => {
  await limparBanco();
  for (const f of [{ codigo: "SINAPI", nome: "SINAPI" }, { codigo: "EMOP", nome: "EMOP" }]) await prisma.fonte.create({ data: f });
  usuarioId = (await prisma.usuario.create({ data: { email: "adm@t.com", nome: "Adm", senhaHash: "x", papel: "ADMIN" } })).id;
});

async function preparar(arquivos = EMOP_DBFS, opc: { retificacao?: string; autorizar?: boolean } = {}) {
  const originais = arquivos === EMOP_DBFS ? EMOP_DBFS.map((p) => arquivo(p)) : [arquivo(arquivos[0])];
  const id = await identificar(originais, { uf: "RJ" });
  const ini = await iniciarImportacao(ex, {
    ident: id.identificacao, usuarioId, arquivos: id.originais,
    retificacao: opc.retificacao ? { motivo: opc.retificacao } : null, autorizarDuplicidade: opc.autorizar,
  });
  await lerEmLotes(id, (l) => gravarLote(ex, ini.importacaoId, l), { tamanhoLote: 7 }); // lotes pequenos de propósito
  return { ...ini, id };
}

async function importarEPublicar(arquivos = EMOP_DBFS, opc: { retificacao?: string; autorizar?: boolean } = {}) {
  const p = await preparar(arquivos, opc);
  const v = await validarImportacao(ex, p.importacaoId);
  expect(v.status).toBe("VALIDADA");
  await confirmarImportacao(ex, p.importacaoId, { usuarioId, cienteAvisos: true });
  await validarBase(ex, p.baseRevisaoId, usuarioId);
  await publicarBase(ex, p.baseRevisaoId, usuarioId);
  return p;
}

const precos = (codigo: string) => ex.consulta<{ valor: string; regime: string | null; revisao: number; status: string }>(
  `SELECT p.valor::text, r.codigo AS regime, br.numero AS revisao, br.status::text
     FROM preco p JOIN item_referencia i ON i.id = p.item_id LEFT JOIN regime r ON r.id = p.regime_id
     JOIN base_revisao br ON br.id = p.base_revisao_id WHERE i.codigo = $1 ORDER BY br.numero, r.codigo`, [codigo]);

describe("fluxo completo de importação (EMOP)", () => {
  it("staging → validação → confirmação → validação humana → publicação", async () => {
    const p = await preparar();
    // nada nas tabelas definitivas antes da confirmação
    expect(await prisma.preco.count()).toBe(0);
    const v = await validarImportacao(ex, p.importacaoId);
    expect(v).toMatchObject({ status: "VALIDADA", erros: 0 });
    expect(v.avisos).toBeGreaterThan(0); // 01294 publicado sem unidade
    await expect(confirmarImportacao(ex, p.importacaoId, { usuarioId, cienteAvisos: false })).rejects.toThrow(/ciência/);
    await confirmarImportacao(ex, p.importacaoId, { usuarioId, cienteAvisos: true });

    expect(await precos("01.001.0001-0")).toEqual([{ valor: "211.9700", regime: "SEM_DESONERACAO", revisao: 0, status: "EM_IMPORTACAO" }]);
    expect((await precos("01.001.0001-A"))[0]).toMatchObject({ valor: "202.6900", regime: "COM_DESONERACAO" });
    const elem = await prisma.itemReferencia.findFirstOrThrow({ where: { codigo: "01294" }, include: { versoes: true } });
    expect(elem.versoes[0].unidade).toBeNull();
    expect(await prisma.itemReferencia.count({ where: { codigo: { startsWith: "05.100.9999" } } })).toBe(0);
    const comp = await prisma.composicaoComponente.findFirstOrThrow({ where: { percentual: { gt: 0 } } });
    expect(comp.percentual!.toString()).toBe("3");
    // staging limpo
    expect(Number((await ex.consulta<{ n: string }>(`SELECT count(*) n FROM staging.stg_item`))[0].n)).toBe(0);

    // base só fica disponível após validação humana + publicação
    await expect(publicarBase(ex, p.baseRevisaoId, usuarioId)).rejects.toThrow(/validadas/);
    await validarBase(ex, p.baseRevisaoId, usuarioId);
    await publicarBase(ex, p.baseRevisaoId, usuarioId);
    expect((await precos("01.001.0001-0"))[0].status).toBe("PUBLICADA");
    const acoes = (await prisma.auditoria.findMany({ orderBy: { id: "asc" } })).map((a) => a.acao);
    expect(acoes).toEqual(["IMPORTACAO_INICIADA", "IMPORTACAO_CONFIRMADA", "BASE_VALIDADA", "BASE_PUBLICADA"]);
  });

  it("arquivo já importado é bloqueado; com autorização, segue como retificação", async () => {
    await importarEPublicar();
    await expect(preparar()).rejects.toThrow(/já importado/);
    await expect(preparar(EMOP_DBFS, { autorizar: true })).rejects.toThrow(/já está publicada/);
    const ret = await importarEPublicar(EMOP_DBFS, { autorizar: true, retificacao: "Errata publicada pela EMOP" });
    expect(ret.numeroRevisao).toBe(1);
    const p = await precos("01.001.0001-0");
    // a revisão original continua intacta (SUBSTITUIDA) e a retificação é a publicada
    expect(p.map((x) => [x.revisao, x.status])).toEqual([[0, "SUBSTITUIDA"], [1, "PUBLICADA"]]);
    // estruturas de composição idênticas são reaproveitadas, não duplicadas
    const [g] = await ex.consulta<{ resumo: { gravado: { versoesComposicaoNovas: number } } }>(`SELECT resumo FROM importacao WHERE id = $1`, [ret.importacaoId]);
    expect(g.resumo.gravado.versoesComposicaoNovas).toBe(0);
    expect(await prisma.composicaoVersao.count()).toBe(6);
    const dup = await prisma.importacao.findUniqueOrThrow({ where: { id: ret.importacaoId } });
    expect(dup.duplicidadeAutorizada).toBe(true);
  });

  it("não permite duas revisões pendentes ao mesmo tempo", async () => {
    const p = await preparar();
    await validarImportacao(ex, p.importacaoId);
    await confirmarImportacao(ex, p.importacaoId, { usuarioId, cienteAvisos: true });
    await expect(preparar(EMOP_DBFS, { autorizar: true })).rejects.toThrow(/aguardando validação/);
    await descartarBase(ex, p.baseRevisaoId, usuarioId, "teste");
    expect(await prisma.preco.count()).toBe(0); // descarte remove os preços não publicados
  });

  it("erros bloqueiam a confirmação", async () => {
    const p = await preparar();
    await gravarLote(ex, p.importacaoId, {
      componentes: [{ arquivo: "x", composicao: "01.001.0001-0", regime: null, ordem: 99, componenteTipo: "INSUMO", componenteCodigo: "99999", coeficienteTexto: "1", coeficiente: "1" }],
      precos: [{ arquivo: "x", tipo: "INSUMO", codigo: "00001X", regime: null, valorTexto: "-1", valor: "-1" }],
    });
    const v = await validarImportacao(ex, p.importacaoId);
    expect(v.status).toBe("COM_ERROS");
    const regras = (await prisma.verificacaoImportacao.findMany({ where: { severidade: "ERRO" } })).map((x) => x.regra).sort();
    expect(regras).toEqual(["COMPONENTE_INEXISTENTE", "PRECO_NEGATIVO", "PRECO_SEM_ITEM"]);
    await expect(confirmarImportacao(ex, p.importacaoId, { usuarioId, cienteAvisos: true })).rejects.toThrow(ErroImportacao);
    expect(await prisma.preco.count()).toBe(0);
  });

  it("falha durante a gravação desfaz tudo (rollback) e registra a falha", async () => {
    const p = await preparar();
    await validarImportacao(ex, p.importacaoId);
    // provoca falha no meio da transação: regime inexistente aparece após a validação
    await ex.consulta(`UPDATE staging.stg_preco SET regime_codigo = 'REGIME_FANTASMA' WHERE importacao_id = $1 AND codigo = '01.001.0002-0'`, [p.importacaoId]);
    await expect(confirmarImportacao(ex, p.importacaoId, { usuarioId, cienteAvisos: true })).rejects.toThrow(/nada foi gravado/);
    expect(await prisma.preco.count()).toBe(0);
    expect(await prisma.itemReferencia.count()).toBe(0);
    expect(await prisma.composicaoVersao.count()).toBe(0);
    expect(await prisma.regime.count()).toBe(0);
    const imp = await prisma.importacao.findUniqueOrThrow({ where: { id: p.importacaoId } });
    expect(imp.status).toBe("FALHOU");
    // nova tentativa funciona normalmente
    await importarEPublicar(EMOP_DBFS, { autorizar: true });
    expect(await prisma.preco.count()).toBeGreaterThan(0);
  });

  it("detecta referência circular entre composições", async () => {
    const p = await preparar();
    await gravarLote(ex, p.importacaoId, {
      itens: [
        { arquivo: "x", tipo: "COMPOSICAO", codigo: "C1", descricao: "c1", unidade: "UN", prioridade: 1 },
        { arquivo: "x", tipo: "COMPOSICAO", codigo: "C2", descricao: "c2", unidade: "UN", prioridade: 1 },
      ],
      componentes: [
        { arquivo: "x", composicao: "C1", regime: null, ordem: 1, componenteTipo: "COMPOSICAO", componenteCodigo: "C2", coeficienteTexto: "1", coeficiente: "1" },
        { arquivo: "x", composicao: "C2", regime: null, ordem: 1, componenteTipo: "COMPOSICAO", componenteCodigo: "C1", coeficienteTexto: "1", coeficiente: "1" },
      ],
    });
    await validarImportacao(ex, p.importacaoId);
    const c = await prisma.verificacaoImportacao.findMany({ where: { regra: "REFERENCIA_CIRCULAR" } });
    expect(c.length).toBeGreaterThan(0);
    expect(c[0].mensagem).toMatch(/C1 → C2 → C1|C2 → C1 → C2/);
  });
});

describe("consultas das telas de importação", () => {
  it("prévia, relatório e listas", async () => {
    const p = await preparar();
    await validarImportacao(ex, p.importacaoId);
    const amostra = await amostraStaging(ex, p.importacaoId, 100);
    expect(amostra.find((a) => a.codigo === "01.001.0001-0")?.precos).toEqual({ SEM_DESONERACAO: "211.9700" });
    const d = await detalheImportacao(ex, p.importacaoId);
    expect(d?.grupos.map((g) => `${g.severidade}:${g.regra}`)).toEqual(["AVISO:ITEM_SEM_UNIDADE", "INFO:INDICE_SETORIAL", "INFO:RECALCULO_RESUMO"]);
    expect(d?.arquivos).toHaveLength(6);
    expect((await verificacoes(ex, p.importacaoId))[0].severidade).toBe("AVISO");
    await confirmarImportacao(ex, p.importacaoId, { usuarioId, cienteAvisos: true });
    expect((await listarBases(ex))[0]).toMatchObject({ fonte: "EMOP", competencia: "09/2026", status: "EM_IMPORTACAO", importacoes_confirmadas: 1 });
    expect((await listarImportacoes(ex))[0]).toMatchObject({ status: "CONFIRMADA", erros: 0, avisos: 1 });
  });
});

describe("SINAPI (amostra real) no banco", () => {
  it("3 regimes, preços ausentes não gravados, analítica com subcomposição", async () => {
    await importarEPublicar([SINAPI_ZIP]);
    expect((await prisma.regime.findMany({ orderBy: { codigo: "asc" } })).map((r) => r.codigo)).toEqual(["COM_DESONERACAO", "SEM_DESONERACAO", "SEM_ENCARGOS"]);
    expect(await precos("105006")).toEqual([]); // custo zerado = sem custo
    expect(await precos("37600")).toEqual([]); // em branco no RJ
    expect((await precos("104658")).length).toBe(3);
    const v = await prisma.composicaoVersao.findFirstOrThrow({ where: { item: { codigo: "104658" } }, include: { componentes: { include: { componente: true }, orderBy: { ordem: "asc" } } } });
    expect(v.origem).toBe("OFICIAL");
    expect(v.componentes[0]).toMatchObject({ ordem: 1, tipoOriginal: "COMPOSICAO" });
    expect(v.componentes[0].componente.codigo).toBe("88316");
    expect(v.componentes[0].coeficiente.toString()).toBe("1.279");
    const ajuda = await expandirPacotes([arquivo(SINAPI_ZIP)]);
    expect(ajuda[0].nome).toBe("SINAPI_Referência_2026_09.xlsx");
  });
});
