import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executorPg, type Executor } from "@/lib/banco/executor";
import { alterarDadosContrato, carregarContrato, confirmarContrato, criarContratoDaPlanilha, reabrirContrato } from "@/lib/contratos/servico";
import { listarRegimes } from "@/lib/contratos/regimes";
import { criarObra } from "@/lib/orcamento/servico";
import {
  acrescentarMedicao, alterarPeriodo, carregarMedicao, excluirUltimaPrevista, fecharMedicao, iniciarMedicao, painelMedicoes, planejarMedicoes, reabrirMedicao, salvarLancamentos,
} from "@/lib/medicoes/servico";
import { dadosBoletim, dadosDesembolso, estadoDesembolso, salvarDesembolso } from "@/lib/medicoes/relatorios";
import { limparBanco, prisma } from "./ajuda";

let ex: Executor;
let u: string;
let outro: string;
const admin = (id: string) => ({ id, administrador: false });

beforeAll(async () => {
  ex = await executorPg(process.env.DATABASE_URL!);
  await limparBanco();
  u = (await prisma.usuario.create({ data: { email: "medicoes@t.com", nome: "Fiscal", senhaHash: "x" } })).id;
  outro = (await prisma.usuario.create({ data: { email: "outro-med@t.com", nome: "Outro", senhaHash: "x" } })).id;
});
afterAll(async () => { await ex.encerrar?.(); await prisma.$disconnect(); });

/** Contrato vigente com 2 itens: 10 m² × 33,33 (= 333,30) e 3 un × 100,00 (= 300,00). */
async function contrato(numero: string, regime: "QUANTIDADE" | "PERCENTUAL") {
  const regimes = await listarRegimes(ex);
  const r = regimes.find((x) => x.medicao === regime)!;
  const obra = await criarObra(ex, { nome: `Obra ${numero}` }, u);
  const id = await criarContratoDaPlanilha(ex, { obraId: obra, numero, objeto: "Reforma", regimeId: r.id, dataOs: "2026-10-10" }, {
    arquivo: "p.xlsx", grupos: [{ chave: "g", titulo: "SERVIÇOS", paiChave: null }],
    itens: [
      { grupoChave: "g", numero: "1.1", codigo: null, fonte: null, descricao: "Piso", unidade: "M2", quantidade: "10", precoUnitario: "33.33", total: null },
      { grupoChave: "g", numero: "1.2", codigo: null, fonte: null, descricao: "Porta", unidade: "UN", quantidade: "3", precoUnitario: "100", total: null },
    ],
  }, u);
  const e = await carregarContrato(ex, id);
  await confirmarContrato(ex, id, e.contrato.versao, admin(u));
  const itens = (await carregarContrato(ex, id)).itens;
  return { id, piso: itens[0].id, porta: itens[1].id, regimes };
}

describe("medições", () => {
  it("planejamento: 10 medições de 30 dias, ajuste de período (até 30 dias), acrescentar e excluir", async () => {
    const { id } = await contrato("M-1", "QUANTIDADE");
    await expect(planejarMedicoes(ex, id, { inicio: "2026-10-10", quantidade: 3, dias: 31, servicoContinuo: false }, u)).rejects.toThrow(/1 a 30 dias/);
    await planejarMedicoes(ex, id, { inicio: "2026-10-10", quantidade: 10, dias: 30, servicoContinuo: false }, u);
    let p = await painelMedicoes(ex, id);
    expect(p.medicoes).toHaveLength(10);
    expect(p.medicoes[0]).toMatchObject({ numero: 1, inicio: "2026-10-10", fim: "2026-11-08", dias: 30, situacao: "PREVISTA" });
    expect(p.medicoes[9]).toMatchObject({ numero: 10, inicio: "2027-07-07", fim: "2027-08-05" });

    // 1ª encurtada para 20 dias: as seguintes acompanham, mantendo 30 dias
    await alterarPeriodo(ex, p.medicoes[0].id, "2026-10-29", u);
    await expect(alterarPeriodo(ex, p.medicoes[1].id, "2026-12-01", u)).rejects.toThrow(/no máximo 30 dias/);
    p = await painelMedicoes(ex, id);
    expect(p.medicoes[0]).toMatchObject({ fim: "2026-10-29", dias: 20 });
    expect(p.medicoes[1]).toMatchObject({ inicio: "2026-10-30", fim: "2026-11-28", dias: 30 });

    await acrescentarMedicao(ex, id, u);
    p = await painelMedicoes(ex, id);
    expect(p.medicoes).toHaveLength(11);
    expect(p.medicoes[10].inicio).toBe(p.medicoes[9].fim.replace(/\d{2}$/, (d) => String(+d + 1).padStart(2, "0")));
    await excluirUltimaPrevista(ex, id, u);
    expect((await painelMedicoes(ex, id)).medicoes).toHaveLength(10);
  });

  it("serviço contínuo: medições mensais dia a dia (10/10/2026 a 09/11/2026)", async () => {
    const { id } = await contrato("M-2", "PERCENTUAL");
    await planejarMedicoes(ex, id, { inicio: "2026-10-10", quantidade: 12, dias: null, servicoContinuo: true }, u);
    const p = await painelMedicoes(ex, id);
    expect(p.contrato.continuo).toBe(true);
    expect(p.medicoes.slice(0, 2).map((m) => [m.inicio, m.fim])).toEqual([["2026-10-10", "2026-11-09"], ["2026-11-10", "2026-12-09"]]);
    expect(p.medicoes[11]).toMatchObject({ inicio: "2027-09-10", fim: "2027-10-09" });
    await expect(alterarPeriodo(ex, p.medicoes[0].id, "2026-11-01", u)).rejects.toThrow(/mensais/);
  });

  it("preço unitário: lança quantidade, não passa do contratado, fecha a diferença de arredondamento; fechada trava; reabre só a última", async () => {
    const { id, piso, porta } = await contrato("M-3", "QUANTIDADE");
    await planejarMedicoes(ex, id, { inicio: "2026-10-10", quantidade: 3, dias: 30, servicoContinuo: false }, u);
    const [m1, m2] = (await painelMedicoes(ex, id)).medicoes;
    await expect(iniciarMedicao(ex, m2.id, u)).rejects.toThrow(/Feche as medições anteriores/);
    await iniciarMedicao(ex, m1.id, u);
    let e = await carregarMedicao(ex, m1.id);
    await expect(salvarLancamentos(ex, m1.id, e.medicao.versao, [{ itemId: piso, valor: "10,5" }], u)).rejects.toThrow(/passaria do contratado/);
    let v = await salvarLancamentos(ex, m1.id, e.medicao.versao, [{ itemId: piso, valor: "3,333" }, { itemId: porta, valor: "1" }], u);
    await expect(salvarLancamentos(ex, m1.id, e.medicao.versao, [], u)).rejects.toThrow(/alterada por outra pessoa/);
    e = await carregarMedicao(ex, m1.id);
    // 3,333 × 33,33 = 111,08889 → 111,09
    expect(e.linhas.map((l) => [l.atualQtd, l.atualValor])).toEqual([["3.3330", "111.09"], ["1.0000", "100.00"]]);
    expect(e.totais.atual).toBe("211.09");
    await expect(iniciarMedicao(ex, m2.id, u)).rejects.toThrow(/Feche/);
    await fecharMedicao(ex, m1.id, v, "Primeira", u);

    // trava no banco
    await expect(ex.transacao([{ sql: `UPDATE medicao_item SET valor = 1 WHERE medicao_id = $1`, params: [m1.id] }])).rejects.toThrow(/fechada/);
    await expect(alterarPeriodo(ex, m1.id, "2026-10-20", u)).rejects.toThrow(/fechada/);
    // planilha contratual não reabre com medição iniciada
    await expect(reabrirContrato(ex, id, admin(u))).rejects.toThrow(/medição iniciada/);

    await iniciarMedicao(ex, m2.id, u);
    e = await carregarMedicao(ex, m2.id);
    expect(e.linhas[0]).toMatchObject({ anteriorQtd: "3.3330", anteriorValor: "111.09" });
    // completa o piso: 6,667 × 33,33 = 222,21 (arredondado), mas fecha 333,30 − 111,09 = 222,21
    v = await salvarLancamentos(ex, m2.id, e.medicao.versao, [{ itemId: piso, valor: "6,667" }, { itemId: porta, valor: "2" }], u);
    e = await carregarMedicao(ex, m2.id);
    expect(e.totais).toMatchObject({ contratado: "633.30", acumulado: "633.30", saldo: "0.00", percentualAcumulado: "100" });
    // vazio retira o lançamento
    v = await salvarLancamentos(ex, m2.id, v, [{ itemId: porta, valor: "" }], u);
    expect((await carregarMedicao(ex, m2.id)).linhas[1].atualQtd).toBeNull();
    v = await salvarLancamentos(ex, m2.id, v, [{ itemId: porta, valor: "2" }], u);
    await fecharMedicao(ex, m2.id, v, null, u);

    const p = await painelMedicoes(ex, id);
    expect(p.medicoes.map((m) => [m.situacao, m.valor, m.acumulado])).toEqual([["FECHADA", "211.09", "211.09"], ["FECHADA", "422.21", "633.30"], ["PREVISTA", "0", "633.30"]]);
    expect(p.totais).toMatchObject({ medido: "633.30", saldo: "0.00" });

    await expect(reabrirMedicao(ex, m1.id, admin(u))).rejects.toThrow(/última medição fechada/);
    await expect(reabrirMedicao(ex, m2.id, admin(outro))).rejects.toThrow(/Só quem cadastrou/);
    await reabrirMedicao(ex, m2.id, admin(u));
    expect((await carregarMedicao(ex, m2.id)).medicao.situacao).toBe("EM_ELABORACAO");

    // replanejar mantém as iniciadas/fechadas e recomeça depois delas
    await planejarMedicoes(ex, id, { inicio: "2030-01-01", quantidade: 4, dias: 15, servicoContinuo: false }, u);
    const p2 = await painelMedicoes(ex, id);
    expect(p2.medicoes.map((m) => [m.numero, m.situacao, m.inicio, m.dias])).toEqual([
      [1, "FECHADA", "2026-10-10", 30], [2, "EM_ELABORACAO", "2026-11-09", 30], [3, "PREVISTA", "2026-12-09", 15], [4, "PREVISTA", "2026-12-24", 15],
    ]);
    await expect(planejarMedicoes(ex, id, { inicio: "2026-10-10", quantidade: 1, dias: 30, servicoContinuo: false }, u)).rejects.toThrow(/não pode ser menor/);
  });

  it("demais regimes: lança percentual até 100%; critério não muda com lançamento", async () => {
    const { id, piso, regimes } = await contrato("M-4", "PERCENTUAL");
    await planejarMedicoes(ex, id, { inicio: "2026-10-10", quantidade: 2, dias: 30, servicoContinuo: false }, u);
    const [m1] = (await painelMedicoes(ex, id)).medicoes;
    await iniciarMedicao(ex, m1.id, u);
    let e = await carregarMedicao(ex, m1.id);
    await expect(salvarLancamentos(ex, m1.id, e.medicao.versao, [{ itemId: piso, valor: "100,5" }], u)).rejects.toThrow(/passaria de 100%/);
    await salvarLancamentos(ex, m1.id, e.medicao.versao, [{ itemId: piso, valor: "33,3333" }], u);
    e = await carregarMedicao(ex, m1.id);
    // 333,30 × 33,3333% = 111,09989 → 111,10
    expect(e.linhas[0]).toMatchObject({ atualPct: "33.3333", atualQtd: null, atualValor: "111.10" });

    const c = await carregarContrato(ex, id);
    const unitario = regimes.find((r) => r.medicao === "QUANTIDADE")!;
    const outroPct = regimes.find((r) => r.medicao === "PERCENTUAL" && r.id !== c.contrato.regimeId)!;
    await expect(alterarDadosContrato(ex, id, c.contrato.versao, { numero: "M-4", objeto: "Reforma", regimeId: unitario.id }, u)).rejects.toThrow(/mesmo critério/);
    await alterarDadosContrato(ex, id, c.contrato.versao, { numero: "M-4", objeto: "Reforma", regimeId: outroPct.id }, u);
  });

  it("medição não começa com a planilha em cadastro", async () => {
    const regimes = await listarRegimes(ex);
    const obra = await criarObra(ex, { nome: "Obra X" }, u);
    const id = await criarContratoDaPlanilha(ex, { obraId: obra, numero: "M-5", objeto: "Objeto X", regimeId: regimes[0].id }, {
      arquivo: "p.xlsx", grupos: [{ chave: "g", titulo: "G", paiChave: null }],
      itens: [{ grupoChave: "g", numero: "1", codigo: null, fonte: null, descricao: "Item", unidade: "UN", quantidade: "1", precoUnitario: "1", total: null }],
    }, u);
    await planejarMedicoes(ex, id, { inicio: "2026-10-10", quantidade: 1, dias: 30, servicoContinuo: false }, u);
    const [m] = (await painelMedicoes(ex, id)).medicoes;
    expect((await carregarMedicao(ex, m.id)).podeIniciar).toMatch(/confirmada/);
    await expect(iniciarMedicao(ex, m.id, u)).rejects.toThrow(/confirmada/);
  });

  it("boletim de medição e cronograma de desembolso (realizado + previsto fechando 100%)", async () => {
    const regimes = await listarRegimes(ex);
    const obra = await criarObra(ex, { nome: "Obra Boletim" }, u);
    const id = await criarContratoDaPlanilha(ex, { obraId: obra, numero: "M-6", objeto: "Reforma da ponte", regimeId: regimes[0].id, dataOs: "2026-10-10", prazoExecucaoDias: 90, empresa: "Construtora X" }, {
      arquivo: "p.xlsx",
      grupos: [{ chave: "a", titulo: "PISOS", paiChave: null }, { chave: "b", titulo: "ESQUADRIAS", paiChave: null }, { chave: "b1", titulo: "Portas", paiChave: "b" }],
      itens: [
        { grupoChave: "a", numero: "1.1", codigo: "01.001", fonte: null, descricao: "Piso", unidade: "M2", quantidade: "10", precoUnitario: "33.33", total: null },
        { grupoChave: "b1", numero: "2.1.1", codigo: null, fonte: null, descricao: "Porta", unidade: "UN", quantidade: "3", precoUnitario: "100", total: null },
      ],
    }, u);
    await confirmarContrato(ex, id, (await carregarContrato(ex, id)).contrato.versao, admin(u));
    const [piso, porta] = (await carregarContrato(ex, id)).itens.map((i) => i.id);
    await planejarMedicoes(ex, id, { inicio: "2026-10-10", quantidade: 3, dias: 30, servicoContinuo: false }, u);
    const [m1, m2] = (await painelMedicoes(ex, id)).medicoes;
    await iniciarMedicao(ex, m1.id, u);
    const v = await salvarLancamentos(ex, m1.id, (await carregarMedicao(ex, m1.id)).medicao.versao, [{ itemId: piso, valor: "3,333" }, { itemId: porta, valor: "1" }], u);
    await fecharMedicao(ex, m1.id, v, "Obs", u);

    const b = await dadosBoletim(ex, m1.id);
    expect(b.contrato).toMatchObject({ numero: "M-6", empresa: "Construtora X", termino: "2027-01-07", porQuantidade: true });
    expect(b.medicao).toMatchObject({ numero: 1, situacao: "FECHADA", observacao: "Obs" });
    expect(b.linhas.map((l) => (l.tipo === "grupo" ? [l.numero, l.titulo, l.contratado, l.medido, l.saldo, l.percentual] : [l.numero, l.antes, l.medido, l.saldo, l.valorMedido, l.valorSaldo, l.percentual]))).toEqual([
      ["1", "PISOS", "333.30", "111.09", "222.21", "33.33"],
      ["1.1", "10", "3.333", "6.667", "111.09", "222.21", "33.33"],
      ["2", "ESQUADRIAS", "300.00", "100.00", "200.00", "33.33"],
      ["2.1", "Portas", "300.00", "100.00", "200.00", "33.33"],
      ["2.1.1", "3", "1", "2", "100.00", "200.00", "33.33"],
    ]);
    expect(b.totais).toMatchObject({ contratado: "633.30", medicao: "211.09", acumulado: "211.09", saldo: "422.21", percentualAcumulado: "33.33" });

    // cronograma: sem previsto salvo, sugestão uniforme fechando 100%
    let e = await estadoDesembolso(ex, id);
    expect(e.ultimaFechada).toBe(1);
    expect(e.grupos.map((g) => [g.numero, g.titulo, g.total])).toEqual([["1", "PISOS", "333.30"], ["2", "ESQUADRIAS", "300.00"]]);
    const [ga, gb] = e.grupos;
    expect(e.realizado[ga.id][1]).toBe("111.09");
    expect(e.origem[ga.id]).toBe("uniforme");
    const somaPct = (g: string) => Object.values(e.previsto[g]).reduce((a, x) => a + Number(x), 0) + Number(e.realizado[g][1]) / Number(e.grupos.find((x) => x.id === g)!.total) * 100;
    expect(somaPct(ga.id)).toBeCloseTo(100, 3);

    await expect(salvarDesembolso(ex, id, { [ga.id]: { 2: "50" }, [gb.id]: { 2: "66,6667" } }, u)).rejects.toThrow(/PISOS\) soma 83,33%/);
    await salvarDesembolso(ex, id, { [ga.id]: { 2: "50", 3: "16,67" }, [gb.id]: { 2: "66,6667", 3: "" } }, u);
    e = await estadoDesembolso(ex, id);
    expect(e.origem[ga.id]).toBe("salvo");
    expect(e.previsto[gb.id]).toEqual({ 2: "66.6667", 3: "0" });

    const d = await dadosDesembolso(ex, id, 1);
    expect(d.rotuloPeriodos).toBe("PERÍODOS DE 30 DIAS");
    expect(d.grupos.map((g) => g.valores)).toEqual([["111.09", "166.65", "55.56"], ["100.00", "200.00", "0.00"]]);
    expect(d.mensal).toEqual(["211.09", "366.65", "55.56"]);
    expect(d.acumulado).toEqual(["211.09", "577.74", "633.30"]);
    expect(d.total).toBe("633.30");
    expect(d.periodos.map((p) => p.realizado)).toEqual([true, false, false]);
    await expect(dadosDesembolso(ex, id, m2.numero)).rejects.toThrow(/medição fechada/);
  });
});
