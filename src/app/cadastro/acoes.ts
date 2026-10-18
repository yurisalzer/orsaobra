"use server";

import { criarCadastro, ErroCadastro, reenviarConfirmacao } from "@/lib/auth/cadastro";
import { ipAtual, urlBase } from "@/lib/auth/requisicao";
import { executor } from "@/lib/banco/servidor";

export interface EstadoCadastro {
  erro?: string;
  enviado?: boolean;
  email?: string;
}

const texto = (f: FormData, k: string, max = 200) => String(f.get(k) ?? "").slice(0, max);

export async function acaoCadastrar(_: EstadoCadastro, form: FormData): Promise<EstadoCadastro> {
  // campo invisível: só robôs preenchem
  if (texto(form, "site")) return { enviado: true, email: texto(form, "email") };
  try {
    await criarCadastro(await executor(), {
      nome: texto(form, "nome", 150), email: texto(form, "email"), senha: texto(form, "senha"),
      confirmacaoSenha: texto(form, "confirmacao"), cpf: texto(form, "cpf", 20), telefone: texto(form, "telefone", 30),
    }, { ip: await ipAtual(), urlBase: await urlBase() });
    return { enviado: true, email: texto(form, "email").trim().toLowerCase() };
  } catch (e) {
    if (e instanceof ErroCadastro) return { erro: e.message };
    console.error(e);
    return { erro: "Não foi possível concluir o cadastro. Tente novamente." };
  }
}

export async function acaoReenviar(_: EstadoCadastro, form: FormData): Promise<EstadoCadastro> {
  try {
    await reenviarConfirmacao(await executor(), texto(form, "email"), { ip: await ipAtual(), urlBase: await urlBase() });
    return { enviado: true, email: texto(form, "email").trim().toLowerCase() };
  } catch (e) {
    if (e instanceof ErroCadastro) return { erro: e.message };
    console.error(e);
    return { erro: "Não foi possível reenviar. Tente novamente." };
  }
}
