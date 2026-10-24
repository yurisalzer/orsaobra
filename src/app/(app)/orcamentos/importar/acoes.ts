"use server";

import { z } from "zod";
import { semAcessoRevisao } from "@/lib/acesso-sessao";
import { ErroPermissao, exigirPermissao } from "@/lib/auth/sessao";
import { executor } from "@/lib/banco/servidor";
import { conferirCodigos, criarEtapasImportadas, importarItens } from "@/lib/orcamento/importar/servidor";
import { ErroOrcamento } from "@/lib/orcamento/servico";

type Resultado<T> = { ok: true; dados: T } | { ok: false; erro: string };

async function executar<T>(f: (usuarioId: string) => Promise<T>): Promise<Resultado<T>> {
  try {
    const u = await exigirPermissao("ORCAMENTOS_EDITAR");
    return { ok: true, dados: await f(u.id) };
  } catch (e) {
    if ((e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e;
    if (e instanceof ErroPermissao || e instanceof ErroOrcamento) return { ok: false, erro: e.message };
    if (e instanceof z.ZodError) return { ok: false, erro: e.issues[0]?.message ?? "Dados inválidos." };
    const msg = (e as Error).message ?? "";
    if (/alterado por outra pessoa|fechada/.test(msg)) return { ok: false, erro: msg.replace(/^.*?ERROR:\s*/, "") };
    console.error(e);
    return { ok: false, erro: "Não foi possível concluir. Tente novamente." };
  }
}

const uuid = z.string().uuid();
const bases = z.array(z.object({ baseRevisaoId: uuid, regime: z.string().max(40).nullable() })).max(10);

export async function acaoConferirCodigos(b: { baseRevisaoId: string; regime: string | null }[], codigos: string[]) {
  return executar(async () => conferirCodigos(await executor(), bases.parse(b), z.array(z.string().max(60)).max(400).parse(codigos)));
}

export async function acaoCriarEtapas(revisaoId: string, versao: number, etapas: { chave: string; titulo: string; paiChave: string | null }[], origem: { arquivo: string; linhas: number; itens: number }) {
  const negado = await semAcessoRevisao(revisaoId, "editar");
  if (negado) return negado;
  return executar(async (u) => criarEtapasImportadas(await executor(), uuid.parse(revisaoId), z.number().int().parse(versao),
    z.array(z.object({ chave: z.string().max(20), titulo: z.string().max(400), paiChave: z.string().max(20).nullable() })).max(2000).parse(etapas),
    z.object({ arquivo: z.string().max(200), linhas: z.number().int(), itens: z.number().int() }).parse(origem), u));
}

export async function acaoImportarItens(revisaoId: string, versao: number, itens: { ref: number; etapaId: string; itemReferenciaId: string | null; quantidade: string; informado?: { codigo: string; descricao: string; unidade: string; custo: string; arquivo: string } | null }[]) {
  const negado = await semAcessoRevisao(revisaoId, "editar");
  if (negado) return negado;
  return executar(async (u) => importarItens(await executor(), uuid.parse(revisaoId), z.number().int().parse(versao),
    z.array(z.object({
      ref: z.number().int(), etapaId: uuid, itemReferenciaId: uuid.nullable(), quantidade: z.string().max(30),
      informado: z.object({ codigo: z.string().max(60), descricao: z.string().max(2000), unidade: z.string().max(20), custo: z.string().max(40), arquivo: z.string().max(200) }).nullable().optional(),
    })).max(200).parse(itens), u));
}
