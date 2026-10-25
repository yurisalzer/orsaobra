"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ErroPermissao, exigirPermissao } from "@/lib/auth/sessao";
import { executor } from "@/lib/banco/servidor";
import { alterarEmpresa, criarEmpresa, definirEmpresaAtiva, ErroEmpresa, type DadosEmpresa } from "@/lib/empresas/servico";

type Resultado<T> = { ok: true; dados: T } | { ok: false; erro: string };

async function executar<T>(f: (usuarioId: string) => Promise<T>): Promise<Resultado<T>> {
  try {
    const u = await exigirPermissao("MEDICOES_EDITAR");
    const dados = await f(u.id);
    revalidatePath("/empresas");
    return { ok: true, dados };
  } catch (e) {
    if ((e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e;
    if (e instanceof ErroPermissao || e instanceof ErroEmpresa) return { ok: false, erro: e.message };
    if (e instanceof z.ZodError) return { ok: false, erro: e.issues[0]?.message ?? "Dados inválidos." };
    if (/empresa_cnpj_key/.test((e as Error).message ?? "")) return { ok: false, erro: "Já existe empresa cadastrada com esse CNPJ." };
    console.error(e);
    return { ok: false, erro: "Não foi possível concluir a operação. Tente novamente." };
  }
}

const txt = (n: number) => z.string().max(n).nullable().optional();
const dados = z.object({
  razaoSocial: z.string().max(300), nomeFantasia: txt(300), cnpj: z.string().max(30), inscricaoEstadual: txt(40), inscricaoMunicipal: txt(40),
  cep: txt(12), logradouro: txt(300), numero: txt(20), complemento: txt(120), bairro: txt(120), municipio: txt(120), uf: txt(2),
  telefone: txt(30), email: txt(200), representanteNome: txt(200), representanteCpf: txt(20), representanteCargo: txt(120), observacoes: txt(2000),
  responsaveis: z.array(z.object({
    nome: z.string().max(200), titulo: z.string().max(120).nullable(), conselho: z.enum(["CREA", "CAU", "CFT", "OUTRO"]), registro: z.string().max(40),
    ufRegistro: z.string().max(2).nullable(), cpf: z.string().max(20).nullable(), email: z.string().max(200).nullable(), telefone: z.string().max(30).nullable(), principal: z.boolean(),
  })).max(30),
});

export async function acaoCriarEmpresa(d: DadosEmpresa) {
  return executar(async (u) => criarEmpresa(await executor(), dados.parse(d), u));
}

export async function acaoAlterarEmpresa(id: string, versao: number, d: DadosEmpresa) {
  return executar(async (u) => alterarEmpresa(await executor(), z.string().uuid().parse(id), z.number().int().parse(versao), dados.parse(d), u));
}

export async function acaoAtivarEmpresa(id: string, ativo: boolean) {
  return executar(async (u) => definirEmpresaAtiva(await executor(), z.string().uuid().parse(id), z.boolean().parse(ativo), u));
}
