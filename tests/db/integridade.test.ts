import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { criarFonteERegime, limparBanco, prisma } from "./ajuda";

beforeEach(limparBanco);
afterAll(() => prisma.$disconnect());

async function baseComPreco(status: "EM_IMPORTACAO" | "PUBLICADA" = "EM_IMPORTACAO") {
  const { fonte, regime } = await criarFonteERegime();
  const base = await prisma.baseMensal.create({ data: { fonteId: fonte.id, uf: "RJ", competencia: new Date("2026-01-01") } });
  const rev = await prisma.baseRevisao.create({ data: { baseId: base.id, numero: 0 } });
  const item = await prisma.itemReferencia.create({ data: { fonteId: fonte.id, tipo: "INSUMO", codigo: "00000370" } });
  const versao = await prisma.itemVersao.create({ data: { itemId: item.id, descricao: "AREIA MÉDIA", unidade: "M3", hash: "a".repeat(64) } });
  await prisma.preco.create({ data: { baseRevisaoId: rev.id, itemId: item.id, itemVersaoId: versao.id, regimeId: regime.id, valor: new Prisma.Decimal("123.4567") } });
  if (status === "PUBLICADA") await prisma.baseRevisao.update({ where: { id: rev.id }, data: { status } });
  return { fonte, regime, base, rev, item, versao };
}

describe("catálogo e bases", () => {
  it("preserva zeros à esquerda nos códigos", async () => {
    const { item } = await baseComPreco();
    const lido = await prisma.itemReferencia.findUniqueOrThrow({ where: { id: item.id } });
    expect(lido.codigo).toBe("00000370");
    expect(await prisma.itemReferencia.count({ where: { codigo: "370" } })).toBe(0);
  });

  it("precisão NUMERIC sem perda", async () => {
    const { rev, item, regime } = await baseComPreco();
    const p = await prisma.preco.findUniqueOrThrow({ where: { baseRevisaoId_itemId_regimeId: { baseRevisaoId: rev.id, itemId: item.id, regimeId: regime.id } } });
    expect(p.valor.toString()).toBe("123.4567");
  });

  it("competência duplicada (mesma fonte/UF/mês) é rejeitada", async () => {
    const { fonte } = await baseComPreco();
    await expect(prisma.baseMensal.create({ data: { fonteId: fonte.id, uf: "RJ", competencia: new Date("2026-01-01") } }))
      .rejects.toThrow();
  });

  it("competência deve ser o dia 1", async () => {
    const { fonte } = await criarFonteERegime();
    await expect(prisma.baseMensal.create({ data: { fonteId: fonte.id, uf: "RJ", competencia: new Date("2026-02-15") } }))
      .rejects.toThrow(/competencia_dia1/);
  });

  it("preço negativo é rejeitado", async () => {
    const { rev, item, versao, fonte } = await baseComPreco();
    const r2 = await prisma.regime.create({ data: { fonteId: fonte.id, codigo: "R2", nome: "R2" } });
    await expect(prisma.preco.create({ data: { baseRevisaoId: rev.id, itemId: item.id, itemVersaoId: versao.id, regimeId: r2.id, valor: -1 } }))
      .rejects.toThrow(/nao_negativo/);
  });

  it("base publicada é imutável; retificação cria nova revisão", async () => {
    const { rev, item, regime, base } = await baseComPreco("PUBLICADA");
    await expect(prisma.preco.updateMany({ where: { baseRevisaoId: rev.id }, data: { valor: 1 } })).rejects.toThrow(/publicada/);
    await expect(prisma.preco.deleteMany({ where: { baseRevisaoId: rev.id } })).rejects.toThrow(/publicada/);
    // só uma revisão publicada por base
    const ret = await prisma.baseRevisao.create({ data: { baseId: base.id, numero: 1, motivo: "Retificação" } });
    await expect(prisma.baseRevisao.update({ where: { id: ret.id }, data: { status: "PUBLICADA" } })).rejects.toThrow();
    // fluxo correto: substitui a anterior e publica a retificação, numa transação
    await prisma.$transaction([
      prisma.baseRevisao.update({ where: { id: rev.id }, data: { status: "SUBSTITUIDA" } }),
      prisma.baseRevisao.update({ where: { id: ret.id }, data: { status: "PUBLICADA" } }),
    ]);
    // o preço da revisão original continua lá, intacto
    const p = await prisma.preco.findFirstOrThrow({ where: { baseRevisaoId: rev.id, itemId: item.id, regimeId: regime.id } });
    expect(p.valor.toString()).toBe("123.4567");
  });
});

describe("composições", () => {
  it("rejeita autorreferência e alteração de componentes", async () => {
    const { fonte } = await criarFonteERegime();
    const c = await prisma.itemReferencia.create({ data: { fonteId: fonte.id, tipo: "COMPOSICAO", codigo: "0001" } });
    const i = await prisma.itemReferencia.create({ data: { fonteId: fonte.id, tipo: "INSUMO", codigo: "0002" } });
    const v = await prisma.composicaoVersao.create({ data: { itemId: c.id, origem: "OFICIAL", hash: "b".repeat(64) } });
    await expect(prisma.composicaoComponente.create({ data: { composicaoVersaoId: v.id, componenteItemId: c.id, coeficiente: 1, ordem: 1 } }))
      .rejects.toThrow(/si mesma/);
    const comp = await prisma.composicaoComponente.create({ data: { composicaoVersaoId: v.id, componenteItemId: i.id, coeficiente: new Prisma.Decimal("0.0000001234"), ordem: 1 } });
    expect(comp.coeficiente.toString()).toBe("1.234e-7");
    await expect(prisma.composicaoComponente.update({ where: { id: comp.id }, data: { coeficiente: 2 } })).rejects.toThrow(/imutáveis/);
  });
});

describe("orçamento fechado", () => {
  it("revisão fechada não aceita alterações em itens, etapas nem nela mesma", async () => {
    const { fonte } = await criarFonteERegime();
    const it0 = await prisma.itemReferencia.create({ data: { fonteId: fonte.id, tipo: "COMPOSICAO", codigo: "92873" } });
    const obra = await prisma.obra.create({ data: { nome: "Escola" } });
    const orc = await prisma.orcamento.create({ data: { obraId: obra.id, titulo: "Reforma" } });
    const rev = await prisma.orcamentoRevisao.create({ data: { orcamentoId: orc.id, numero: 1 } });
    const etapa = await prisma.etapa.create({ data: { revisaoId: rev.id, ordem: 1, titulo: "Serviços preliminares" } });
    const item = await prisma.itemOrcamento.create({
      data: {
        revisaoId: rev.id, etapaId: etapa.id, ordem: 1, itemReferenciaId: it0.id, codigo: "92873", descricao: "x", unidade: "M3",
        quantidade: 10, custoUnitario: 100, bdiPercentual: 25, precoUnitario: 125, precoTotal: 1250,
      },
    });
    await prisma.orcamentoRevisao.update({ where: { id: rev.id }, data: { status: "FECHADA", fechadaEm: new Date(), totalGeral: 1250 } });

    await expect(prisma.itemOrcamento.update({ where: { id: item.id }, data: { quantidade: 11 } })).rejects.toThrow(/fechada/);
    await expect(prisma.itemOrcamento.delete({ where: { id: item.id } })).rejects.toThrow(/fechada/);
    await expect(prisma.etapa.create({ data: { revisaoId: rev.id, ordem: 2, titulo: "Nova" } })).rejects.toThrow(/fechada/);
    await expect(prisma.orcamentoRevisao.update({ where: { id: rev.id }, data: { status: "EM_ELABORACAO" } })).rejects.toThrow(/fechada/);
    await expect(prisma.orcamentoRevisao.delete({ where: { id: rev.id } })).rejects.toThrow(/fechada/);

    // nova revisão pode ser criada a partir da fechada
    const rev2 = await prisma.orcamentoRevisao.create({ data: { orcamentoId: orc.id, numero: 2, revisaoOrigemId: rev.id } });
    expect(rev2.status).toBe("EM_ELABORACAO");
    const intacto = await prisma.itemOrcamento.findUniqueOrThrow({ where: { id: item.id } });
    expect(intacto.precoTotal.toString()).toBe("1250");
  });
});

describe("auditoria", () => {
  it("é somente inserção", async () => {
    const a = await prisma.auditoria.create({ data: { acao: "TESTE", entidade: "x" } });
    await expect(prisma.auditoria.update({ where: { id: a.id }, data: { acao: "Y" } })).rejects.toThrow(/auditoria/);
    await expect(prisma.auditoria.delete({ where: { id: a.id } })).rejects.toThrow(/auditoria/);
  });
});
