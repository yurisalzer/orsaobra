import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executorPg, type Executor } from "@/lib/banco/executor";
import { listarPerfis, salvarPerfil } from "@/lib/orcamento/bdi";
import {
  adicionarItem, alterarItem, alterarObra, carregarRevisao, compararRevisoes, configurarRevisao, criarEtapa, criarObra, criarOrcamento,
  atualizarBdi, gerarVersaoRegime, duplicarOrcamento, excluirItem, excluirObra, excluirOrcamento, podeExcluirObra, fecharRevisao, listarOrcamentos, podeExcluirOrcamento, lerCronograma, moverEtapa, novaRevisao, salvarCronograma, trocarItem,
} from "@/lib/orcamento/servico";
import { arquivo, SINAPI_ZIP } from "../importacao/ajuda";
import { montarRelatorio } from "@/lib/relatorios/montar";
import { prisma } from "./ajuda";
import { carregarAmostras, importarPublicar } from "./carga";

let ex: Executor;
let u: string;
let rev: Record<string, string>;
const idDe = async (codigo: string) => (await prisma.itemReferencia.findFirstOrThrow({ where: { codigo } })).id;

beforeAll(async () => {
  ex = await executorPg(process.env.DATABASE_URL!);
  const c = await carregarAmostras(ex);
  u = c.usuarioId;
  rev = c.revisoes;
});
afterAll(async () => { await ex.encerrar?.(); await prisma.$disconnect(); });

const basesPadrao = () => [
  { baseRevisaoId: rev.EMOP, regime: "SEM_DESONERACAO" },
  { baseRevisaoId: rev.SINAPI, regime: "SEM_DESONERACAO" },
];

describe("perfis de BDI", () => {
  it("TCU calculado (arredondado a 2 casas) e informado", async () => {
    await salvarPerfil(ex, {
      nome: "Edificações (exemplo)", parcelas: [
        { tipo: "AC", nome: "Administração central", percentual: "4" }, { tipo: "S", nome: "Seguro", percentual: "0,4" },
        { tipo: "G", nome: "Garantia", percentual: "0,4" }, { tipo: "R", nome: "Risco", percentual: "1,27" },
        { tipo: "DF", nome: "Despesas financeiras", percentual: "1,23" }, { tipo: "L", nome: "Lucro", percentual: "7,4" },
        { tipo: "I", nome: "PIS", percentual: "0,65" }, { tipo: "I", nome: "COFINS", percentual: "3" }, { tipo: "I", nome: "ISS", percentual: "2" },
      ],
    }, u);
    await salvarPerfil(ex, { nome: "Diferenciado (equipamentos)", percentualInformado: "15,28", parcelas: [] }, u);
    const p = await listarPerfis(ex);
    expect(p.find((x) => x.nome.startsWith("Edificações"))?.bdiAplicado).toBe("22.23");
    expect(p.find((x) => x.nome.startsWith("Diferenciado"))?.bdiAplicado).toBe("15.28");
    await expect(salvarPerfil(ex, { nome: "edificações (EXEMPLO)", parcelas: [{ tipo: "L", nome: "L", percentual: "1" }] }, u)).rejects.toThrow(/Já existe/);
    await expect(salvarPerfil(ex, { nome: "Vazio", parcelas: [] }, u)).rejects.toThrow(/parcelas/);
  });
});

describe("orçamento completo", () => {
  let orcamentoId: string;
  let r1: string;
  let v = 1;
  let etapaId: string;
  const itens: Record<string, string> = {};

  it("cria obra, orçamento com bases publicadas e BDI global", async () => {
    const perfis = await listarPerfis(ex);
    const obra = await criarObra(ex, { nome: "Escola Municipal X", codigo: "OB-001", processo: "SEI-123/2026", descricao: "Reforma da escola", endereco: "Rua A, 1", municipio: "Niterói", orgaoSolicitante: "Secretaria de Educação" }, u);
    const r = await criarOrcamento(ex, { obraId: obra, titulo: "Reforma geral", bases: basesPadrao(), bdiPerfilId: perfis.find((x) => x.nome.startsWith("Edificações"))!.id }, u);
    orcamentoId = r.orcamentoId;
    r1 = r.revisaoId;
    const e = await carregarRevisao(ex, r1);
    expect(e.revisao).toMatchObject({ numero: 1, status: "EM_ELABORACAO", bdiPercentual: "22.230000" });
    expect(e.basesPadrao.map((b) => `${b.fonte}:${b.regime}`)).toEqual(["EMOP:SEM_DESONERACAO", "SINAPI:SEM_DESONERACAO"]);
    expect(e.orcamento).toMatchObject({ obraCodigo: "OB-001", processo: "SEI-123/2026", endereco: "Rua A, 1", municipio: "Niterói", orgaoSolicitante: "Secretaria de Educação" });
  });

  it("edita os dados da obra, com auditoria e detecção de edição simultânea", async () => {
    const obra = await criarObra(ex, { nome: "Obra Z", municipio: "Rio de Janeiro" }, u);
    const aberto = { nome: "Obra Z", municipio: "Rio de Janeiro" };
    await alterarObra(ex, obra, aberto, { nome: " Obra Z - Bloco A ", codigo: "OB-9", processo: "SEI-9/2026", orgaoSolicitante: "Secretaria de Obras", municipio: "" }, u);
    const o = await prisma.obra.findUniqueOrThrow({ where: { id: obra } });
    expect(o).toMatchObject({ nome: "Obra Z - Bloco A", codigo: "OB-9", processo: "SEI-9/2026", orgaoSolicitante: "Secretaria de Obras", municipio: null });
    const aud = await prisma.auditoria.findFirstOrThrow({ where: { entidadeId: obra, acao: "OBRA_ALTERADA" } });
    expect(aud.antes).toMatchObject({ nome: "Obra Z", municipio: "Rio de Janeiro" });
    // outra aba ainda com os dados antigos: não grava
    await expect(alterarObra(ex, obra, aberto, { nome: "Outro nome" }, u)).rejects.toThrow(/alterada por outra pessoa/);
    await expect(alterarObra(ex, obra, { nome: "Obra Z - Bloco A", codigo: "OB-9", processo: "SEI-9/2026", orgaoSolicitante: "Secretaria de Obras" }, { nome: "x" }, u)).rejects.toThrow(/nome da obra/);
    expect((await prisma.obra.findUniqueOrThrow({ where: { id: obra } })).nome).toBe("Obra Z - Bloco A");
  });

  it("edita o código do item mantendo quantidade, memória e posição", async () => {
    const obra = await criarObra(ex, { nome: "Obra T" }, u);
    const { revisaoId } = await criarOrcamento(ex, { obraId: obra, titulo: "Troca de código", bases: basesPadrao() }, u);
    const et = await criarEtapa(ex, revisaoId, (await carregarRevisao(ex, revisaoId)).revisao.versao, { titulo: "Etapa" }, u);
    const a = await adicionarItem(ex, revisaoId, et.versao, { etapaId: et.id, itemReferenciaId: await idDe("01.001.0001-0"), quantidade: "10", memoriaQuantitativo: "2 x 5" }, u);
    let vv = await trocarItem(ex, revisaoId, a.versao, a.id, await idDe("104658"), u);
    const e = await carregarRevisao(ex, revisaoId);
    expect(e.itens).toHaveLength(1);
    // 194,45 sem BDI; 10 × 194,45 = 1.944,50
    expect(e.itens[0]).toMatchObject({ id: a.id, numero: "1.1", fonte: "SINAPI", codigo: "104658", quantidade: "10.0000", memoriaQuantitativo: "2 x 5", custoUnitario: "194.4500", precoTotal: "1944.50" });
    expect(e.itens[0].referenciaPreco).toMatch(/SINAPI RJ 09\/2026 — Encargos sociais sem desoneração/);
    const aud = await prisma.auditoria.findFirstOrThrow({ where: { entidadeId: a.id, acao: "ITEM_CODIGO_TROCADO" } });
    expect(aud.antes).toMatchObject({ codigo: "01.001.0001-0" });
    // fora do regime adotado / sem preço: não troca
    await expect(trocarItem(ex, revisaoId, vv, a.id, await idDe("01.001.0001-A"), u)).rejects.toThrow(/apenas no regime "Com desoneração"/);
    await expect(trocarItem(ex, revisaoId, vv, a.id, await idDe("105006"), u)).rejects.toThrow(/Sem preço publicado/);
    // versão desatualizada (outra aba)
    await expect(trocarItem(ex, revisaoId, vv - 1, a.id, await idDe("01.001.0001-0"), u)).rejects.toThrow(/alterado por outra pessoa/);
    vv = await trocarItem(ex, revisaoId, vv, a.id, await idDe("01.001.0001-0"), u);
    expect((await carregarRevisao(ex, revisaoId)).itens[0]).toMatchObject({ codigo: "01.001.0001-0", custoUnitario: "211.9700", quantidade: "10.0000" });
  });

  it("não aceita base não publicada", async () => {
    const obra = await criarObra(ex, { nome: "Obra Y" }, u);
    const naoPublicada = await prisma.baseRevisao.create({ data: { baseId: (await prisma.baseRevisao.findUniqueOrThrow({ where: { id: rev.EMOP } })).baseId, numero: 9 } });
    await expect(criarOrcamento(ex, { obraId: obra, titulo: "Orçamento Y", bases: [{ baseRevisaoId: naoPublicada.id, regime: "SEM_DESONERACAO" }] }, u)).rejects.toThrow(/não está publicada/);
    await prisma.baseRevisao.delete({ where: { id: naoPublicada.id } });
  });

  it("etapas, subetapas e itens com valores exatos", async () => {
    const e1 = await criarEtapa(ex, r1, v, { titulo: "Serviços preliminares" }, u); v = e1.versao;
    const e2 = await criarEtapa(ex, r1, v, { titulo: "Acessibilidade" }, u); v = e2.versao;
    const sub = await criarEtapa(ex, r1, v, { paiId: e2.id, titulo: "Piso tátil" }, u); v = sub.versao;
    etapaId = e1.id;
    let a = await adicionarItem(ex, r1, v, { etapaId: e1.id, itemReferenciaId: await idDe("01.001.0001-0"), quantidade: "10", memoriaQuantitativo: "  2 ensaios × 5 amostras = 10  " }, u); v = a.versao; itens.emop = a.id;
    a = await adicionarItem(ex, r1, v, { etapaId: sub.id, itemReferenciaId: await idDe("104658"), quantidade: "12,5" }, u); v = a.versao; itens.sinapi = a.id;
    a = await adicionarItem(ex, r1, v, { etapaId: sub.id, itemReferenciaId: await idDe("36178"), quantidade: "3" }, u); v = a.versao; itens.insumo = a.id;
    const e = await carregarRevisao(ex, r1);
    const emop = e.itens.find((i) => i.id === itens.emop)!;
    // 211,97 × 1,2223 = 259,090931 → 259,09; 10 × 259,09 = 2.590,90
    expect(emop).toMatchObject({ numero: "1.1", custoUnitario: "211.9700", precoUnitario: "259.09", precoTotal: "2590.90", custoTotal: "2119.70", origemPreco: "PUBLICADO" });
    expect(emop.memoriaCalculo).toMatch(/211,97 × \(1 \+ 22,23% de BDI\) = R\$ 259,09/);
    expect(emop.memoriaQuantitativo).toBe("2 ensaios × 5 amostras = 10");
    expect(e.itens.find((i) => i.id === itens.sinapi)!.memoriaQuantitativo).toBeNull();
    const sin = e.itens.find((i) => i.id === itens.sinapi)!;
    // 194,45 × 1,2223 = 237,676235 → 237,68; 12,5 × 237,68 = 2.971,00
    expect(sin).toMatchObject({ numero: "2.1.1", custoUnitario: "194.4500", precoUnitario: "237.68", precoTotal: "2971.00", custoTotal: "2430.63" });
    expect(sin.referenciaPreco).toMatch(/SINAPI RJ 09\/2026 — Encargos sociais sem desoneração/);
    expect(e.etapas.map((x) => `${x.numero} ${x.titulo}`)).toEqual(["1 Serviços preliminares", "2 Acessibilidade", "2.1 Piso tátil"]);
    const etapa2 = e.etapas.find((x) => x.titulo === "Acessibilidade")!;
    const ins = e.itens.find((i) => i.id === itens.insumo)!;
    expect(etapa2.total).toBe((Number(sin.precoTotal) + Number(ins.precoTotal)).toFixed(2));
    expect(e.totais.total).toBe((2590.90 + 2971.00 + Number(ins.precoTotal)).toFixed(2));
  });

  it("recusa item sem preço e item de regime incompatível", async () => {
    await expect(adicionarItem(ex, r1, v, { etapaId, itemReferenciaId: await idDe("105006"), quantidade: "1" }, u)).rejects.toThrow(/Sem preço publicado/);
    await expect(adicionarItem(ex, r1, v, { etapaId, itemReferenciaId: await idDe("01.001.0001-A"), quantidade: "1" }, u)).rejects.toThrow(/apenas no regime "Com desoneração"/);
    // por item: escolher outra base/regime é permitido
    const a = await adicionarItem(ex, r1, v, { etapaId, itemReferenciaId: await idDe("01.001.0001-A"), quantidade: "1", base: { baseRevisaoId: rev.EMOP, regime: "COM_DESONERACAO" } }, u);
    v = a.versao;
    v = await excluirItem(ex, r1, v, a.id, u);
    await expect(adicionarItem(ex, r1, v, { etapaId, itemReferenciaId: await idDe("02083"), quantidade: "-1" }, u)).rejects.toThrow(/negativa/);
    await expect(adicionarItem(ex, r1, v, { etapaId, itemReferenciaId: await idDe("02083"), quantidade: "1,23456" }, u)).rejects.toThrow(/4 casas/);
  });

  it("memória de cálculo do quantitativo: editar, apagar, limite de tamanho", async () => {
    const memoria = "(30 m comprimento + 20 m largura) × 2 (perímetro) × 2 m altura = 200 m²\nDescontado portão: 0";
    v = await alterarItem(ex, r1, v, itens.sinapi, { memoriaQuantitativo: memoria }, u);
    let e = await carregarRevisao(ex, r1);
    expect(e.itens.find((i) => i.id === itens.sinapi)!.memoriaQuantitativo).toBe(memoria);
    // alterar só a memória não muda valores
    expect(e.itens.find((i) => i.id === itens.sinapi)!.precoTotal).toBe("2971.00");
    v = await alterarItem(ex, r1, v, itens.insumo, { memoriaQuantitativo: "temporária" }, u);
    v = await alterarItem(ex, r1, v, itens.insumo, { memoriaQuantitativo: "   " }, u);
    e = await carregarRevisao(ex, r1);
    expect(e.itens.find((i) => i.id === itens.insumo)!.memoriaQuantitativo).toBeNull();
    await expect(alterarItem(ex, r1, v, itens.insumo, { memoriaQuantitativo: "x".repeat(4001) }, u)).rejects.toThrow(/4.000/);
  });

  it("BDI individual por item, edição de quantidade e concorrência", async () => {
    const dif = (await listarPerfis(ex)).find((x) => x.nome.startsWith("Diferenciado"))!;
    v = await alterarItem(ex, r1, v, itens.sinapi, { bdiPerfilId: dif.id }, u);
    let e = await carregarRevisao(ex, r1);
    // 194,45 × 1,1528 = 224,16196 → 224,16; × 12,5 = 2.802,00
    expect(e.itens.find((i) => i.id === itens.sinapi)).toMatchObject({ bdiPercentual: "15.280000", precoUnitario: "224.16", precoTotal: "2802.00" });
    v = await alterarItem(ex, r1, v, itens.emop, { quantidade: "1.234,5678" }, u);
    e = await carregarRevisao(ex, r1);
    // 1.234,5678 × 259,09 = 319.864,15... → 319.864,17
    expect(e.itens.find((i) => i.id === itens.emop)).toMatchObject({ quantidade: "1234.5678", precoTotal: "319864.17" });
    await expect(alterarItem(ex, r1, v - 1, itens.emop, { quantidade: "1" }, u)).rejects.toThrow(/alterado por outra pessoa/);
    v = await moverEtapa(ex, r1, v, etapaId, 1, u);
    e = await carregarRevisao(ex, r1);
    expect(e.etapas.map((x) => x.titulo)[0]).toBe("Acessibilidade");
    v = await moverEtapa(ex, r1, v, etapaId, -1, u);
  });

  it("modo truncar recalcula todos os itens; BDI global não afeta item com BDI individual", async () => {
    v = await configurarRevisao(ex, r1, v, { arredondamento: "TRUNCAR" }, u);
    let e = await carregarRevisao(ex, r1);
    // 211,97 × 1,2223 = 259,090931 → truncado 259,09 (igual); 194,45 × 1,1528 = 224,16196 → 224,16
    expect(e.itens.find((i) => i.id === itens.emop)?.memoriaCalculo).toMatch(/truncado/);
    v = await configurarRevisao(ex, r1, v, { arredondamento: "ARREDONDAR", bdiPerfilId: null }, u);
    e = await carregarRevisao(ex, r1);
    expect(e.itens.find((i) => i.id === itens.emop)).toMatchObject({ bdiPercentual: "0.000000", precoUnitario: "211.97" });
    expect(e.itens.find((i) => i.id === itens.sinapi)).toMatchObject({ bdiPercentual: "15.280000" });
    const edif = (await listarPerfis(ex)).find((x) => x.nome.startsWith("Edificações"))!;
    v = await configurarRevisao(ex, r1, v, { bdiPerfilId: edif.id }, u);
  });

  it("cronograma físico-financeiro: validações e gravação", async () => {
    const e = await carregarRevisao(ex, r1);
    const [p1, p2] = e.etapas.filter((x) => x.paiId === null).sort((a, b) => a.ordem - b.ordem);
    const sub = e.etapas.find((x) => x.paiId !== null)!;
    await expect(salvarCronograma(ex, r1, v, { meses: 2, parcelas: [{ etapaId: p1.id, periodo: 1, percentual: "60" }, { etapaId: p1.id, periodo: 2, percentual: "50" }] }, u)).rejects.toThrow(/passa de 100%/);
    await expect(salvarCronograma(ex, r1, v, { meses: 2, parcelas: [{ etapaId: p1.id, periodo: 3, percentual: "10" }] }, u)).rejects.toThrow(/fora do prazo/);
    await expect(salvarCronograma(ex, r1, v, { meses: 2, parcelas: [{ etapaId: sub.id, periodo: 1, percentual: "10" }] }, u)).rejects.toThrow(/etapas principais/);
    await expect(salvarCronograma(ex, r1, v, { meses: 0, parcelas: [] }, u)).rejects.toThrow(/1 a 120/);
    v = await salvarCronograma(ex, r1, v, { meses: 3, parcelas: [
      { etapaId: p1.id, periodo: 1, percentual: "100" },
      { etapaId: p2.id, periodo: 2, percentual: "33,3333" }, { etapaId: p2.id, periodo: 3, percentual: "66,6667" }, { etapaId: p2.id, periodo: 1, percentual: "" },
    ] }, u);
    const c = await lerCronograma(ex, r1);
    expect(c.meses).toBe(3);
    expect(c.parcelas.map((x) => `${x.etapaId === p1.id ? "p1" : "p2"}:${x.periodo}:${x.percentual}`).sort()).toEqual(["p1:1:100.000000", "p2:2:33.333300", "p2:3:66.666700"]);
  });

  it("fechamento: totais, snapshot analítico e imutabilidade", async () => {
    const antes = await carregarRevisao(ex, r1);
    await fecharRevisao(ex, r1, v, u);
    const e = await carregarRevisao(ex, r1);
    expect(e.revisao.status).toBe("FECHADA");
    expect(e.totais.total).toBe(antes.totais.total);
    const r = await prisma.orcamentoRevisao.findUniqueOrThrow({ where: { id: r1 } });
    expect(r.totalGeral?.toFixed(2)).toBe(antes.totais.total);
    const an = e.itens.find((i) => i.id === itens.sinapi)!.analitico as { tipo: string; linhas: { codigo: string; coeficiente: string }[] };
    expect(an.tipo).toBe("OFICIAL");
    expect(an.linhas.map((l) => l.codigo)).toEqual(["88316", "88309", "36178", "34357", "34353"]);
    // dados da obra e perfis de BDI guardados no fechamento
    expect(r.obraSnapshot).toMatchObject({ nome: "Escola Municipal X", codigo: "OB-001", orgao_solicitante: "Secretaria de Educação" });
    expect((r.bdiSnapshot as { nome: string; bdiAplicado: string; parcelas: unknown[] }[]).map((p) => p.nome)).toEqual(expect.arrayContaining([expect.stringMatching(/^Edificações/)]));
    await expect(salvarCronograma(ex, r1, v + 1, { meses: 1, parcelas: [] }, u)).rejects.toThrow(/fechada/);
    await expect(alterarItem(ex, r1, v + 1, itens.emop, { quantidade: "1" }, u)).rejects.toThrow(/fechada/);
    await expect(alterarItem(ex, r1, v + 1, itens.emop, { memoriaQuantitativo: "mudança após fechar" }, u)).rejects.toThrow(/fechada/);
    await expect(prisma.itemOrcamento.update({ where: { id: itens.emop }, data: { memoriaQuantitativo: "x" } })).rejects.toThrow(/fechada/);
    await expect(prisma.itemOrcamento.update({ where: { id: itens.emop }, data: { quantidade: 1 } })).rejects.toThrow(/fechada/);
  });

  it("nova revisão atualizando para nova competência (retificação) sem alterar a anterior; comparação", async () => {
    // retificação SINAPI: 104658 (sem desoneração) +10%; 36178 deixa de ter preço sem desoneração
    const ret = await importarPublicar(ex, [arquivo(SINAPI_ZIP)], u, {
      retificacao: "Teste de retificação",
      ajustar: async (imp) => {
        await ex.consulta(`UPDATE staging.stg_preco SET valor = round(valor * 1.1, 2) WHERE importacao_id = $1 AND codigo = '104658' AND regime_codigo = 'SEM_DESONERACAO'`, [imp]);
        await ex.consulta(`UPDATE staging.stg_preco SET valor = NULL WHERE importacao_id = $1 AND codigo = '36178' AND regime_codigo = 'SEM_DESONERACAO'`, [imp]);
      },
    });
    const antes = await carregarRevisao(ex, r1);
    const n = await novaRevisao(ex, r1, { descricao: "Atualização para a retificação", novasBases: [{ baseRevisaoId: ret.baseRevisaoId, regime: "SEM_DESONERACAO" }] }, u);
    expect(n).toMatchObject({ numero: 2, pendentes: 1 });
    const e2 = await carregarRevisao(ex, n.revisaoId);
    const c2 = await lerCronograma(ex, n.revisaoId);
    expect(c2.meses).toBe(3);
    expect(c2.parcelas).toHaveLength(3);
    const sin = e2.itens.find((i) => i.codigo === "104658")!;
    expect(sin.custoUnitario).toBe("213.9000"); // 194,45 × 1,1 = 213,895 → 213,90
    expect(sin.baseRotulo).toMatch(/ret\.1/);
    const ins = e2.itens.find((i) => i.codigo === "36178")!;
    expect(ins.pendencia).toMatch(/Preço mantido da referência anterior/);
    expect(ins.custoUnitario).toBe(antes.itens.find((i) => i.codigo === "36178")!.custoUnitario);
    // memórias de cálculo acompanham a nova revisão
    expect(sin.memoriaQuantitativo).toMatch(/^\(30 m comprimento/);
    // EMOP não muda (base EMOP mantida)
    expect(e2.itens.find((i) => i.codigo === "01.001.0001-0")!.precoTotal).toBe(antes.itens.find((i) => i.codigo === "01.001.0001-0")!.precoTotal);
    // revisão 1 permanece idêntica
    const depois = await carregarRevisao(ex, r1);
    expect(depois.itens.map((i) => [i.codigo, i.precoTotal])).toEqual(antes.itens.map((i) => [i.codigo, i.precoTotal]));
    // não pode haver duas revisões em elaboração
    await expect(novaRevisao(ex, r1, { descricao: "outra" }, u)).rejects.toThrow(/Já existe uma revisão em elaboração/);
    // comparação
    const c = await compararRevisoes(ex, r1, n.revisaoId);
    expect(c.linhas.find((l) => l.codigo === "104658")?.situacao).toBe("ALTERADO");
    expect(c.linhas.find((l) => l.codigo === "01.001.0001-0")?.situacao).toBe("IGUAL");
    expect(c.diferencaTotal).toBe((Number(e2.totais.total) - Number(antes.totais.total)).toFixed(2));
  });

  it("duplicar orçamento", async () => {
    const d = await duplicarOrcamento(ex, r1, { titulo: "Reforma geral — cópia" }, u);
    const e = await carregarRevisao(ex, d.revisaoId);
    const o = await carregarRevisao(ex, r1);
    expect(e.revisao.status).toBe("EM_ELABORACAO");
    expect(e.orcamento.id).not.toBe(orcamentoId);
    expect(e.itens.map((i) => [i.numero, i.codigo, i.precoTotal])).toEqual(o.itens.map((i) => [i.numero, i.codigo, i.precoTotal]));
    expect(e.totais.total).toBe(o.totais.total);
  });
});

describe("pesquisar e excluir orçamentos", () => {
  let outro: string;
  const linha = async (titulo: string) => (await listarOrcamentos(ex)).find((l) => l.titulo === titulo)!;

  beforeAll(async () => {
    outro = (await prisma.usuario.create({ data: { email: "outro.orc@t.com", nome: "Outro Orçamentista", senhaHash: "x" } })).id;
  });

  it("pesquisa por nome, número/código e processo da obra, sem diferenciar acentos", async () => {
    const titulos = async (q: string) => [...new Set((await listarOrcamentos(ex, q)).map((l) => l.obra))];
    expect(await titulos("escola municipal")).toEqual(["Escola Municipal X"]);
    expect(await titulos("ob-001")).toEqual(["Escola Municipal X"]);
    expect(await titulos("SEI-123")).toEqual(["Escola Municipal X"]);
    expect(await titulos("niteroi")).toEqual([]); // cidade não entra na pesquisa
    expect(await titulos("reforma geral cópia")).toEqual(["Escola Municipal X"]); // título do orçamento
    expect((await listarOrcamentos(ex, "copia")).map((l) => l.titulo)).toEqual(["Reforma geral — cópia"]);
    expect(await titulos("100%_")).toEqual([]);
    expect((await listarOrcamentos(ex, "")).length).toBe((await listarOrcamentos(ex)).length);
  });

  it("só quem criou (ou o administrador) exclui, e só em elaboração", async () => {
    const copia = await linha("Reforma geral — cópia");
    const original = await linha("Reforma geral");
    expect(copia).toMatchObject({ criadoPorId: u, emElaboracao: true });
    expect(original.emElaboracao).toBe(false);
    expect(podeExcluirOrcamento(copia, { id: outro, administrador: false })).toBe(false);
    expect(podeExcluirOrcamento(copia, { id: outro, administrador: true })).toBe(true);
    expect(podeExcluirOrcamento(original, { id: u, administrador: true })).toBe(false);
    await expect(excluirOrcamento(ex, copia.orcamentoId!, { id: outro, administrador: false })).rejects.toThrow(/Só quem criou/);
    await expect(excluirOrcamento(ex, original.orcamentoId!, { id: u, administrador: true })).rejects.toThrow(/revisão fechada/);

    // orçamento do outro usuário, com etapas, itens e cronograma: o administrador exclui
    const obra = (await prisma.orcamento.findUniqueOrThrow({ where: { id: original.orcamentoId! } })).obraId;
    const r = await criarOrcamento(ex, { obraId: obra, titulo: "Para excluir", bases: [basesPadrao()[0]] }, outro);
    const et = await criarEtapa(ex, r.revisaoId, 1, { titulo: "Etapa" }, outro);
    await adicionarItem(ex, r.revisaoId, et.versao, { etapaId: et.id, itemReferenciaId: await idDe("01.001.0001-0"), quantidade: "2" }, outro);
    await excluirOrcamento(ex, r.orcamentoId, { id: u, administrador: true });
    expect(await prisma.orcamento.findUnique({ where: { id: r.orcamentoId } })).toBeNull();
    expect(await prisma.orcamentoRevisao.count({ where: { orcamentoId: r.orcamentoId } })).toBe(0);
    expect(await prisma.itemOrcamento.count({ where: { revisaoId: r.revisaoId } })).toBe(0);
    const aud = await prisma.auditoria.findFirstOrThrow({ where: { acao: "ORCAMENTO_EXCLUIDO", entidadeId: r.orcamentoId } });
    expect(aud).toMatchObject({ usuarioId: u, antes: { titulo: "Para excluir", revisoes: 1 } });

    // o criador exclui a própria cópia (feita de uma revisão fechada); a obra continua
    await excluirOrcamento(ex, copia.orcamentoId!, { id: u, administrador: false });
    expect(await linha("Reforma geral — cópia")).toBeUndefined();
    expect(await prisma.obra.findUnique({ where: { id: obra } })).not.toBeNull();
  });

  it("excluir o orçamento de origem não afeta uma cópia já fechada", async () => {
    const obra = await criarObra(ex, { nome: "Obra das cópias" }, u);
    const a = await criarOrcamento(ex, { obraId: obra, titulo: "Origem", bases: [basesPadrao()[0]] }, u);
    const et = await criarEtapa(ex, a.revisaoId, 1, { titulo: "Etapa única" }, u);
    await adicionarItem(ex, a.revisaoId, et.versao, { etapaId: et.id, itemReferenciaId: await idDe("01.001.0001-0"), quantidade: "1" }, u);
    const b = await duplicarOrcamento(ex, a.revisaoId, { titulo: "Cópia fechada" }, u);
    await fecharRevisao(ex, b.revisaoId, (await prisma.orcamentoRevisao.findUniqueOrThrow({ where: { id: b.revisaoId } })).versao, u);
    const antes = await carregarRevisao(ex, b.revisaoId);
    await excluirOrcamento(ex, a.orcamentoId, { id: u, administrador: false });
    const depois = await carregarRevisao(ex, b.revisaoId);
    expect(depois.revisao.status).toBe("FECHADA");
    expect(depois.totais.total).toBe(antes.totais.total);
  });

  it("exclui obra sem orçamentos: só quem cadastrou ou o administrador", async () => {
    const obra = await criarObra(ex, { nome: "Obra vazia", codigo: "OV-1" }, u);
    const l = (await listarOrcamentos(ex)).find((x) => x.obraId === obra)!;
    expect(l).toMatchObject({ obraCriadaPorId: u, orcamentoId: null });
    expect(podeExcluirObra({ obraCriadaPorId: u, orcamentos: 0 }, { id: outro, administrador: false })).toBe(false);
    expect(podeExcluirObra({ obraCriadaPorId: u, orcamentos: 0 }, { id: outro, administrador: true })).toBe(true);
    expect(podeExcluirObra({ obraCriadaPorId: u, orcamentos: 1 }, { id: u, administrador: true })).toBe(false);
    await expect(excluirObra(ex, obra, { id: outro, administrador: false })).rejects.toThrow(/Só quem cadastrou/);
    // com orçamento: recusa
    const comOrc = (await listarOrcamentos(ex)).find((x) => x.titulo === "Reforma geral")!.obraId;
    await expect(excluirObra(ex, comOrc, { id: u, administrador: true })).rejects.toThrow(/tem orçamentos/);
    await excluirObra(ex, obra, { id: u, administrador: false });
    expect(await prisma.obra.findUnique({ where: { id: obra } })).toBeNull();
    expect(await prisma.auditoria.findFirstOrThrow({ where: { acao: "OBRA_EXCLUIDA", entidadeId: obra } })).toMatchObject({ usuarioId: u, antes: { nome: "Obra vazia", codigo: "OV-1" } });
    // o administrador exclui obra de outro usuário
    const deOutro = await criarObra(ex, { nome: "Obra do outro" }, outro);
    await excluirObra(ex, deOutro, { id: u, administrador: true });
    expect(await prisma.obra.findUnique({ where: { id: deOutro } })).toBeNull();
  });
});

describe("perfil de BDI alterado depois de aplicado", () => {
  it("detecta a diferença, impede o fechamento e atualiza os itens", async () => {
    const global = await salvarPerfil(ex, { nome: "Global editável", percentualInformado: "20", parcelas: [] }, u);
    const dif = await salvarPerfil(ex, { nome: "Diferenciado editável", percentualInformado: "10", parcelas: [] }, u);
    const obra = await criarObra(ex, { nome: "Obra BDI" }, u);
    const o = await criarOrcamento(ex, { obraId: obra, titulo: "BDI que muda", bases: [basesPadrao()[0]], bdiPerfilId: global }, u);
    let v = 1;
    const et = await criarEtapa(ex, o.revisaoId, v, { titulo: "Etapa única" }, u); v = et.versao;
    const a = await adicionarItem(ex, o.revisaoId, v, { etapaId: et.id, itemReferenciaId: await idDe("01.001.0001-0"), quantidade: "1" }, u); v = a.versao;
    const b = await adicionarItem(ex, o.revisaoId, v, { etapaId: et.id, itemReferenciaId: await idDe("01.001.0001-0"), quantidade: "1" }, u); v = b.versao;
    v = await alterarItem(ex, o.revisaoId, v, b.id, { bdiPerfilId: dif }, u);
    expect((await carregarRevisao(ex, o.revisaoId)).divergenciasBdi).toEqual([]);

    // perfis editados na aba BDI
    await salvarPerfil(ex, { id: global, nome: "Global editável", percentualInformado: "25", parcelas: [] }, u);
    await salvarPerfil(ex, { id: dif, nome: "Diferenciado editável", percentualInformado: "12", parcelas: [] }, u);
    let e = await carregarRevisao(ex, o.revisaoId);
    expect(e.divergenciasBdi.map((d) => [d.nome, d.aplicado, d.atual, d.global, d.itens])).toEqual([
      ["Diferenciado editável", ["10.00"], "12.00", false, 1],
      ["Global editável", ["20.00"], "25.00", true, 0],
    ]);
    // valores ainda com o percentual antigo: 211,97 × 1,20 = 254,36 e × 1,10 = 233,17
    expect(e.itens.map((i) => i.precoUnitario)).toEqual(["254.36", "233.17"]);
    const rel = await montarRelatorio(ex, o.revisaoId, "bdi", { emitidoPor: "Teste", agora: new Date() });
    expect(JSON.stringify(rel)).toContain("ATENÇÃO: o perfil foi alterado depois de aplicado");
    await expect(fecharRevisao(ex, o.revisaoId, v, u)).rejects.toThrow(/Atualizar BDI/);

    v = await atualizarBdi(ex, o.revisaoId, v, u);
    e = await carregarRevisao(ex, o.revisaoId);
    expect(e.divergenciasBdi).toEqual([]);
    expect(e.revisao.bdiPercentual).toBe("25.000000");
    // 211,97 × 1,25 = 264,9625 → 264,96; × 1,12 = 237,4064 → 237,41
    expect(e.itens.map((i) => i.precoUnitario)).toEqual(["264.96", "237.41"]);
    expect(await prisma.auditoria.count({ where: { acao: "BDI_ATUALIZADO", entidadeId: o.revisaoId } })).toBe(1);
    await fecharRevisao(ex, o.revisaoId, v, u);
  });
});

describe("BDI do item: sem BDI ou percentual digitado", () => {
  it("zera ou informa o BDI do item; o global e o Atualizar BDI não mexem nele; perfil volta a valer ao escolher", async () => {
    const global = await salvarPerfil(ex, { nome: "Global vinte", percentualInformado: "20", parcelas: [] }, u);
    const obra = await criarObra(ex, { nome: "Obra BDI item" }, u);
    const o = await criarOrcamento(ex, { obraId: obra, titulo: "BDI por item", bases: [basesPadrao()[0]], bdiPerfilId: global }, u);
    let v = 1;
    const et = await criarEtapa(ex, o.revisaoId, v, { titulo: "Etapa única" }, u); v = et.versao;
    const ids: string[] = [];
    for (let k = 0; k < 3; k++) { const a = await adicionarItem(ex, o.revisaoId, v, { etapaId: et.id, itemReferenciaId: await idDe("01.001.0001-0"), quantidade: "1" }, u); v = a.versao; ids.push(a.id); }
    v = await alterarItem(ex, o.revisaoId, v, ids[1], { bdiInformado: "0" }, u);
    v = await alterarItem(ex, o.revisaoId, v, ids[2], { bdiInformado: "7,5" }, u);
    await expect(alterarItem(ex, o.revisaoId, v, ids[2], { bdiInformado: "-1" }, u)).rejects.toThrow(/negativo/);
    await expect(alterarItem(ex, o.revisaoId, v, ids[2], { bdiInformado: "abc" }, u)).rejects.toThrow(/Informe o percentual/);
    let e = await carregarRevisao(ex, o.revisaoId);
    // 211,97 × 1,20 = 254,36; × 1 = 211,97; × 1,075 = 227,867… → 227,87
    expect(e.itens.map((i) => [i.precoUnitario, i.bdiInformado])).toEqual([["254.36", false], ["211.97", true], ["227.87", true]]);
    // trocar o BDI global não altera os itens com BDI digitado
    const outro = await salvarPerfil(ex, { nome: "Global trinta", percentualInformado: "30", parcelas: [] }, u);
    v = await configurarRevisao(ex, o.revisaoId, v, { bdiPerfilId: outro }, u);
    v = await atualizarBdi(ex, o.revisaoId, v, u);
    e = await carregarRevisao(ex, o.revisaoId);
    expect(e.itens.map((i) => i.precoUnitario)).toEqual(["275.56", "211.97", "227.87"]);
    expect(e.divergenciasBdi).toEqual([]);
    // relatório de BDI lista os itens com BDI informado
    const rel = JSON.stringify(await montarRelatorio(ex, o.revisaoId, "bdi", { emitidoPor: "Teste", agora: new Date() }));
    expect(rel).toContain("Itens com BDI informado no item");
    // nova revisão copia o BDI digitado
    await fecharRevisao(ex, o.revisaoId, v, u);
    const n = await novaRevisao(ex, o.revisaoId, { descricao: "R2" }, u);
    let e2 = await carregarRevisao(ex, n.revisaoId);
    expect(e2.itens.map((i) => [i.bdiInformado, i.bdiPercentual])).toEqual([[false, "30.000000"], [true, "0.000000"], [true, "7.500000"]]);
    // voltar ao global
    await alterarItem(ex, n.revisaoId, e2.revisao.versao, e2.itens[1].id, { bdiPerfilId: null }, u);
    e2 = await carregarRevisao(ex, n.revisaoId);
    expect(e2.itens[1]).toMatchObject({ bdiInformado: false, bdiPerfilId: null, precoUnitario: "275.56" });
  });
});

describe("versão com/sem desoneração", () => {
  it("gera orçamento ligado no outro regime, troca o código EMOP pelo par e compara item a item", async () => {
    const obra = await criarObra(ex, { nome: "Obra regimes" }, u);
    const ret = (await prisma.orcamentoRevisao.findFirstOrThrow({ where: { orcamento: { titulo: "Reforma geral" } }, orderBy: { numero: "desc" } }));
    const sinapi = (await prisma.revisaoBasePadrao.findFirstOrThrow({ where: { revisaoId: ret.id, baseRevisao: { base: { fonte: { codigo: "SINAPI" } } } } })).baseRevisaoId;
    const o = await criarOrcamento(ex, { obraId: obra, codigo: "R-1", titulo: "Onerado", bases: [basesPadrao()[0], { baseRevisaoId: sinapi, regime: "SEM_DESONERACAO" }] }, u);
    let v = 1;
    const et = await criarEtapa(ex, o.revisaoId, v, { titulo: "Etapa única" }, u); v = et.versao;
    let a = await adicionarItem(ex, o.revisaoId, v, { etapaId: et.id, itemReferenciaId: await idDe("01.001.0001-0"), quantidade: "2", memoriaQuantitativo: "1 + 1" }, u); v = a.versao;
    a = await adicionarItem(ex, o.revisaoId, v, { etapaId: et.id, itemReferenciaId: await idDe("104658"), quantidade: "3" }, u); v = a.versao;
    v = await alterarItem(ex, o.revisaoId, v, a.id, { bdiInformado: "5" }, u);
    const antes = await carregarRevisao(ex, o.revisaoId);

    const g = await gerarVersaoRegime(ex, o.revisaoId, { regime: "COM_DESONERACAO", titulo: "Desonerado" }, u);
    expect(g).toMatchObject({ trocados: 1, pendentes: 0, semRegime: [] });
    const nova = await carregarRevisao(ex, g.revisaoId);
    expect(nova.basesPadrao.map((b) => b.regime)).toEqual(["COM_DESONERACAO", "COM_DESONERACAO"]);
    expect(nova.itens.map((i) => [i.codigo, i.quantidade, i.memoriaQuantitativo, i.bdiInformado])).toEqual([
      ["01.001.0001-A", "2.0000", "1 + 1", false], ["104658", "3.0000", null, true],
    ]);
    expect(nova.itens[0].custoUnitario).toBe("202.6900");
    expect(nova.itens[0].referenciaPreco).toMatch(/Com desoneração/);
    expect(nova.orcamento).toMatchObject({ codigo: "R-1", titulo: "Desonerado" });
    // o original não muda
    expect((await carregarRevisao(ex, o.revisaoId)).itens.map((i) => i.precoTotal)).toEqual(antes.itens.map((i) => i.precoTotal));
    // ligação nos dois sentidos
    expect(nova.orcamento.versoes).toMatchObject([{ orcamentoId: o.orcamentoId, origem: true, revisaoId: o.revisaoId }]);
    expect((await carregarRevisao(ex, o.revisaoId)).orcamento.versoes).toMatchObject([{ orcamentoId: g.orcamentoId, origem: false, regime: "COM_DESONERACAO" }]);
    // comparação entre as versões, pela posição do item
    const c = await compararRevisoes(ex, o.revisaoId, g.revisaoId);
    expect(c.entreVersoes).toBe(true);
    expect(c.linhas.map((l) => [l.situacao, l.codigo, l.codigoB ?? null])).toEqual([["ALTERADO", "01.001.0001-0", "01.001.0001-A"], ["ALTERADO", "104658", null]]);
    expect(c.diferencaTotal).toBe((Number(nova.totais.total) - Number(antes.totais.total)).toFixed(2));
    // revisões de orçamentos não ligados continuam recusadas
    const solto = await criarOrcamento(ex, { obraId: obra, titulo: "Solto", bases: [basesPadrao()[0]] }, u);
    await expect(compararRevisoes(ex, o.revisaoId, solto.revisaoId)).rejects.toThrow(/mesmo orçamento/);
    expect(await prisma.auditoria.count({ where: { acao: "VERSAO_REGIME_GERADA", entidadeId: g.orcamentoId } })).toBe(1);
  });
});

