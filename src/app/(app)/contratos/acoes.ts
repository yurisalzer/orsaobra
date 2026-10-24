"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { semAcessoContrato, semAcessoRevisao } from "@/lib/acesso-sessao";
import { ErroPermissao, exigirPermissao, temPermissao } from "@/lib/auth/sessao";
import { executor } from "@/lib/banco/servidor";
import {
  alterarDadosContrato, alterarPrecoContratado, aplicarDescontoLinear, confirmarContrato, criarContratoDaPlanilha, criarContratoDoOrcamento, ErroContrato,
  excluirContrato, reabrirContrato,
} from "@/lib/contratos/servico";
import { criarObra, ErroOrcamento } from "@/lib/orcamento/servico";
import type { DadosNovaObra } from "../orcamentos/acoes";

type Resultado<T> = { ok: true; dados: T } | { ok: false; erro: string };
type Usuario = { id: string; administrador: boolean };

async function executar<T>(f: (u: Usuario) => Promise<T>, caminho = "/contratos"): Promise<Resultado<T>> {
  try {
    const u = await exigirPermissao("MEDICOES_EDITAR");
    const dados = await f({ id: u.id, administrador: temPermissao(u, "USUARIOS") });
    revalidatePath(caminho);
    return { ok: true, dados };
  } catch (e) {
    if ((e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e;
    if (e instanceof ErroPermissao || e instanceof ErroContrato || e instanceof ErroOrcamento) return { ok: false, erro: e.message };
    if (e instanceof z.ZodError) return { ok: false, erro: e.issues[0]?.message ?? "Dados inválidos." };
    const msg = (e as Error).message ?? "";
    if (/vigente|contrato_numero_key/.test(msg)) return { ok: false, erro: /contrato_numero_key/.test(msg) ? "Já existe um contrato com esse número." : msg.replace(/^.*?ERROR:\s*/, "") };
    console.error(e);
    return { ok: false, erro: "Não foi possível concluir a operação. Tente novamente." };
  }
}

const uuid = z.string().uuid();
const data = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).nullable().optional();
const dadosContrato = z.object({
  numero: z.string().max(60), objeto: z.string().max(2000), empresa: z.string().max(300).nullable().optional(), cnpj: z.string().max(30).nullable().optional(),
  dataAssinatura: data, dataOs: data, prazoExecucaoDias: z.number().int().nullable().optional(), prazoVigenciaDias: z.number().int().nullable().optional(),
  processo: z.string().max(100).nullable().optional(), endereco: z.string().max(300).nullable().optional(), responsavelTecnico: z.string().max(200).nullable().optional(), artRrt: z.string().max(60).nullable().optional(),
  emailContato: z.string().max(200).nullable().optional(), telefoneContato: z.string().max(30).nullable().optional(),
});
const novaObra = z.object({
  nome: z.string().max(200), codigo: z.string().max(60), processo: z.string().max(100), descricao: z.string().max(4000),
  endereco: z.string().max(300), municipio: z.string().max(100), orgaoSolicitante: z.string().max(200),
  cabecalhoId: z.union([z.literal(""), z.string().uuid()]),
});
type DadosForm = z.infer<typeof dadosContrato>;

export async function acaoCriarContratoDoOrcamento(revisaoId: string, d: DadosForm) {
  const negado = await semAcessoRevisao(revisaoId, "ver");
  if (negado) return negado;
  return executar(async (u) => criarContratoDoOrcamento(await executor(), uuid.parse(revisaoId), dadosContrato.parse(d), u.id));
}

export async function acaoCriarContratoDaPlanilha(d: DadosForm & { obraId: string | null; novaObra: DadosNovaObra | null; arredondamento: string }, p: {
  arquivo: string;
  grupos: { chave: string; titulo: string; paiChave: string | null }[];
  itens: { grupoChave: string; numero: string | null; codigo: string | null; fonte: string | null; descricao: string; unidade: string | null; quantidade: string; precoUnitario: string; total: string | null }[];
}) {
  return executar(async (u) => {
    const ex = await executor();
    const planilha = z.object({
      arquivo: z.string().max(200),
      grupos: z.array(z.object({ chave: z.string().max(20), titulo: z.string().max(500), paiChave: z.string().max(20).nullable() })).max(3000),
      itens: z.array(z.object({
        grupoChave: z.string().max(20), numero: z.string().max(40).nullable(), codigo: z.string().max(80).nullable(), fonte: z.string().max(40).nullable(),
        descricao: z.string().max(5000), unidade: z.string().max(30).nullable(), quantidade: z.string().max(40), precoUnitario: z.string().max(40), total: z.string().max(40).nullable(),
      })).max(5000),
    }).parse(p);
    const dados = dadosContrato.parse(d);
    const obraId = d.obraId ? uuid.parse(d.obraId) : await criarObra(ex, novaObra.parse(d.novaObra), u.id);
    return criarContratoDaPlanilha(ex, { ...dados, obraId, arredondamento: d.arredondamento === "TRUNCAR" ? "TRUNCAR" : "ARREDONDAR" }, planilha, u.id);
  });
}

export async function acaoAlterarDadosContrato(contratoId: string, versao: number, d: DadosForm) {
  const negado = await semAcessoContrato(contratoId, "editar");
  if (negado) return negado;
  return executar(async (u) => alterarDadosContrato(await executor(), uuid.parse(contratoId), z.number().int().parse(versao), dadosContrato.parse(d), u.id), `/contratos/${contratoId}`);
}

export async function acaoAlterarPreco(contratoId: string, versao: number, itemId: string, preco: string) {
  const negado = await semAcessoContrato(contratoId, "editar");
  if (negado) return negado;
  return executar(async (u) => alterarPrecoContratado(await executor(), uuid.parse(contratoId), z.number().int().parse(versao), uuid.parse(itemId), z.string().max(40).parse(preco), u.id), `/contratos/${contratoId}`);
}

export async function acaoDescontoLinear(contratoId: string, versao: number, percentual: string, modo: string) {
  const negado = await semAcessoContrato(contratoId, "editar");
  if (negado) return negado;
  return executar(async (u) => aplicarDescontoLinear(await executor(), uuid.parse(contratoId), z.number().int().parse(versao), z.string().max(20).parse(percentual), modo === "TRUNCAR" ? "TRUNCAR" : "ARREDONDAR", u.id), `/contratos/${contratoId}`);
}

export async function acaoConfirmarContrato(contratoId: string, versao: number) {
  return executar(async (u) => confirmarContrato(await executor(), uuid.parse(contratoId), z.number().int().parse(versao), u), `/contratos/${contratoId}`);
}

export async function acaoReabrirContrato(contratoId: string) {
  return executar(async (u) => reabrirContrato(await executor(), uuid.parse(contratoId), u), `/contratos/${contratoId}`);
}

export async function acaoExcluirContrato(contratoId: string) {
  return executar(async (u) => excluirContrato(await executor(), uuid.parse(contratoId), u));
}
