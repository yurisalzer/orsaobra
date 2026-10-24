import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executorPg, type Executor } from "@/lib/banco/executor";
import { adicionarItem, carregarRevisao, criarEtapa, criarObra, criarOrcamento, excluirObra, fecharRevisao } from "@/lib/orcamento/servico";
import {
  alterarDadosContrato, alterarPrecoContratado, aplicarDescontoLinear, carregarContrato, confirmarContrato, criarContratoDaPlanilha, criarContratoDoOrcamento,
  excluirContrato, listarContratos, reabrirContrato, revisoesParaContrato,
} from "@/lib/contratos/servico";
import { calcularPrazos } from "@/lib/contratos/prazos";
import { prisma } from "./ajuda";
import { carregarAmostras } from "./carga";

let ex: Executor;
let u: string;
let outro: string;
let rev: Record<string, string>;
let r1: string;
let obra: string;
const idDe = async (codigo: string) => (await prisma.itemReferencia.findFirstOrThrow({ where: { codigo } })).id;
const adm = () => ({ id: u, administrador: false });

beforeAll(async () => {
  ex = await executorPg(process.env.DATABASE_URL!);
  const c = await carregarAmostras(ex);
  u = c.usuarioId;
  outro = (await prisma.usuario.create({ data: { email: "outro.contrato@t.com", nome: "Outro", senhaHash: "x" } })).id;
  rev = c.revisoes;
  obra = await criarObra(ex, { nome: "Ponte Regalo", codigo: "OB-17", processo: "SEI-17/2026" }, u);
  const o = await criarOrcamento(ex, { obraId: obra, titulo: "Ponte emergencial", bases: [{ baseRevisaoId: rev.EMOP, regime: "SEM_DESONERACAO" }, { baseRevisaoId: rev.SINAPI, regime: "SEM_DESONERACAO" }] }, u);
  r1 = o.revisaoId;
  let v = 1;
  const e1 = await criarEtapa(ex, r1, v, { titulo: "Serviços preliminares" }, u); v = e1.versao;
  const e2 = await criarEtapa(ex, r1, v, { titulo: "Ponte" }, u); v = e2.versao;
  const e21 = await criarEtapa(ex, r1, v, { paiId: e2.id, titulo: "Infraestrutura" }, u); v = e21.versao;
  v = (await adicionarItem(ex, r1, v, { etapaId: e1.id, itemReferenciaId: await idDe("01.001.0001-0"), quantidade: "3", memoriaQuantitativo: "1 + 2" }, u)).versao;
  v = (await adicionarItem(ex, r1, v, { etapaId: e21.id, itemReferenciaId: await idDe("104658"), quantidade: "12,5" }, u)).versao;
});
afterAll(async () => { await ex.encerrar?.(); await prisma.$disconnect(); });

describe("contratos — planilha contratual", () => {
  it("prazos: término = início + prazo − 1 dia; aviso quando a execução passa da vigência", () => {
    // O.S. em 14/08/2023 com 360 + 300 dias termina em 03/06/2025 (planilha de medição do contrato 045/2023)
    expect(calcularPrazos({ dataOs: "2023-08-14", prazoExecucaoDias: 660 }).terminoExecucao).toBe("2025-06-03");
    expect(calcularPrazos({ dataAssinatura: "2026-01-31", prazoVigenciaDias: 30 }).terminoVigencia).toBe("2026-03-01");
    expect(calcularPrazos({ dataAssinatura: "2026-05-15", prazoVigenciaDias: 10, dataOs: "2026-05-19", prazoExecucaoDias: 30 }).execucaoAlemDaVigencia).toBe(true);
    expect(calcularPrazos({ dataOs: "2026-05-19" }).terminoExecucao).toBeNull();
  });

  let contrato: string;

  it("do orçamento: exige revisão fechada e copia todas as características, com preço contratado = orçado", async () => {
    await expect(criarContratoDoOrcamento(ex, r1, { numero: "017/2026", objeto: "Ponte Regalo (Sana) — emergencial" }, u)).rejects.toThrow(/revisão fechada/);
    const e = await carregarRevisao(ex, r1);
    await fecharRevisao(ex, r1, e.revisao.versao, u);
    expect((await revisoesParaContrato(ex)).map((x) => x.revisaoId)).toContain(r1);
    contrato = await criarContratoDoOrcamento(ex, r1, { numero: "017/2026", objeto: "Ponte Regalo (Sana) — emergencial", empresa: "Construtora X", cnpj: "12345678000190", dataOs: "2026-05-19", prazoExecucaoDias: 30,
      dataAssinatura: "2026-05-15", prazoVigenciaDias: 120, processo: " SEI-170001/000017/2026 ", endereco: "Estrada do Sana, s/nº — Macaé/RJ", responsavelTecnico: "Eng. Fulano de Tal", artRrt: "ART 2026123456",
      emailContato: "Obra@Construtora.com.br", telefoneContato: "22999998888" }, u);
    await expect(criarContratoDoOrcamento(ex, r1, { numero: "017/2026", objeto: "Duplicado" }, u)).rejects.toThrow(/Já existe o contrato nº 017\/2026/);
    const c = await carregarContrato(ex, contrato);
    const orc = await carregarRevisao(ex, r1);
    expect(c.contrato).toMatchObject({ numero: "017/2026", origem: "ORCAMENTO", situacao: "EM_CADASTRO", cnpj: "12.345.678/0001-90", obraNome: "Ponte Regalo", prazoExecucaoDias: 30, dataOs: "2026-05-19",
      prazoVigenciaDias: 120, dataAssinatura: "2026-05-15", processo: "SEI-170001/000017/2026", endereco: "Estrada do Sana, s/nº — Macaé/RJ", responsavelTecnico: "Eng. Fulano de Tal", artRrt: "ART 2026123456",
      emailContato: "obra@construtora.com.br", telefoneContato: "(22) 99999-8888" });
    await expect(criarContratoDoOrcamento(ex, r1, { numero: "018/2026", objeto: "x x x", emailContato: "invalido" }, u)).rejects.toThrow(/E-mail de contato inválido/);
    await expect(criarContratoDoOrcamento(ex, r1, { numero: "018/2026", objeto: "x x x", telefoneContato: "123" }, u)).rejects.toThrow(/Telefone de contato inválido/);
    expect(c.grupos.map((g) => `${g.numero} ${g.titulo}`)).toEqual(["1 Serviços preliminares", "2 Ponte", "2.1 Infraestrutura"]);
    expect(c.itens.map((i) => i.numero)).toEqual(orc.itens.map((i) => i.numero).sort());
    const emop = c.itens.find((i) => i.codigo === "01.001.0001-0")!;
    const io = orc.itens.find((i) => i.codigo === "01.001.0001-0")!;
    expect(emop).toMatchObject({
      fonte: "EMOP", quantidade: "3.0000", precoUnitario: Number(io.precoUnitario).toFixed(4), precoOrcado: Number(io.precoUnitario).toFixed(4),
      valorTotal: io.precoTotal, memoriaQuantitativo: "1 + 2", itemReferenciaId: io.itemReferenciaId,
    });
    expect(c.totais.contratado).toBe(orc.totais.total);
    expect(c.totais.desconto).toBe("0");
  });

  it("preço contratado editável (item e desconto linear), dados do contrato e confirmação com trava", async () => {
    let c = await carregarContrato(ex, contrato);
    let v = c.contrato.versao;
    const it = c.itens.find((i) => i.codigo === "104658")!;
    v = await alterarPrecoContratado(ex, contrato, v, it.id, "100,005", u).catch((e) => { expect(e.message).toMatch(/4 casas|inválido/); return v; });
    v = await alterarPrecoContratado(ex, contrato, v, it.id, "100,50", u);
    c = await carregarContrato(ex, contrato);
    expect(c.itens.find((i) => i.id === it.id)).toMatchObject({ precoUnitario: "100.5000", valorTotal: "1256.25" });
    await expect(alterarPrecoContratado(ex, contrato, v - 1, it.id, "1", u)).rejects.toThrow(/alterado por outra pessoa/);
    // desconto linear de 10% sobre o orçado, truncando
    v = await aplicarDescontoLinear(ex, contrato, v, "10", "TRUNCAR", u);
    c = await carregarContrato(ex, contrato);
    for (const i of c.itens) {
      const esperado = Math.floor(Number(i.precoOrcado) * 0.9 * 100) / 100;
      expect(Number(i.precoUnitario)).toBeCloseTo(esperado, 4);
    }
    expect(Number(c.totais.desconto)).toBeGreaterThan(9.9);
    v = await alterarDadosContrato(ex, contrato, v, { numero: "017/2026", objeto: "PONTE REGALO (SANA) - EMERGENCIAL", empresa: "Construtora X" }, u);
    // só o criador ou o administrador confirma
    await expect(confirmarContrato(ex, contrato, v, { id: outro, administrador: false })).rejects.toThrow(/Só quem cadastrou/);
    await confirmarContrato(ex, contrato, v, adm());
    c = await carregarContrato(ex, contrato);
    expect(c.contrato.situacao).toBe("VIGENTE");
    await expect(alterarPrecoContratado(ex, contrato, c.contrato.versao, it.id, "1", u)).rejects.toThrow(/vigente/);
    // o banco também barra alteração direta
    await expect(prisma.contratoItem.update({ where: { id: it.id }, data: { quantidade: 99 } })).rejects.toThrow(/vigente/);
    await expect(excluirContrato(ex, contrato, adm())).rejects.toThrow(/vigente/);
    await expect(excluirObra(ex, obra, { id: u, administrador: true })).rejects.toThrow(/orçamentos|contratos/);
    await reabrirContrato(ex, contrato, { id: outro, administrador: true });
    expect((await carregarContrato(ex, contrato)).contrato.situacao).toBe("EM_CADASTRO");
    expect(await prisma.auditoria.count({ where: { entidadeId: contrato, acao: { in: ["CONTRATO_CRIADO", "CONTRATO_DESCONTO_LINEAR", "CONTRATO_CONFIRMADO", "CONTRATO_REABERTO"] } } })).toBe(4);
  });

  it("da planilha importada: preços idênticos ao arquivo, total da proposta preservado e sem edição de preço", async () => {
    const id = await criarContratoDaPlanilha(ex, { obraId: obra, numero: "045/2023", objeto: "Praça e CRAS no Miramar" }, {
      arquivo: "proposta.xlsx",
      grupos: [{ chave: "g1", titulo: "SERVIÇOS ADMINISTRATIVOS", paiChave: null }, { chave: "g2", titulo: "Geral", paiChave: "g1" }],
      itens: [
        { grupoChave: "g2", numero: "1", codigo: "01.090.0000-0", fonte: null, descricao: "INDICE GERAL P/ADMINISTRACAO LOCAL", unidade: "UN", quantidade: "100", precoUnitario: "4352", total: "435200" },
        { grupoChave: "g2", numero: "2", codigo: "02.006.0015-0", fonte: null, descricao: "ALUGUEL CONTAINER", unidade: "UNXM", quantidade: "12", precoUnitario: "100", total: "1200.50" },
        { grupoChave: "g2", numero: "3", codigo: "00.000.0000-0", fonte: null, descricao: "ACERTO DE EMPENHO", unidade: "UNID", quantidade: "189", precoUnitario: "0.01", total: null },
      ],
    }, u);
    const c = await carregarContrato(ex, id);
    expect(c.contrato).toMatchObject({ origem: "PLANILHA", arquivoOrigem: "proposta.xlsx" });
    expect(c.itens.map((i) => [i.precoUnitario, i.valorTotal])).toEqual([["4352.0000", "435200.00"], ["100.0000", "1200.50"], ["0.0100", "1.89"]]);
    expect(c.totais.contratado).toBe("436402.39");
    expect(c.totais.divergentesArquivo).toBe(1);
    await expect(alterarPrecoContratado(ex, id, c.contrato.versao, c.itens[0].id, "1", u)).rejects.toThrow(/proposta/);
    await expect(criarContratoDaPlanilha(ex, { obraId: obra, numero: "046/2023", objeto: "Outro" }, {
      arquivo: "x.pdf", grupos: [{ chave: "g", titulo: "G", paiChave: null }],
      itens: [{ grupoChave: "g", numero: "1", codigo: null, fonte: null, descricao: "Item", unidade: "M", quantidade: "1", precoUnitario: "1.23456", total: null }],
    }, u)).rejects.toThrow(/mais de 4 casas/);
    expect((await listarContratos(ex, "miramar")).map((x) => x.numero)).toEqual(["045/2023"]);
    await expect(excluirContrato(ex, id, { id: outro, administrador: false })).rejects.toThrow(/Só quem cadastrou/);
    await excluirContrato(ex, id, adm());
    expect(await prisma.contrato.count({ where: { id } })).toBe(0);
  });
});
