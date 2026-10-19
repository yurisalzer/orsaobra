"use server";

import { exigirUsuario } from "@/lib/auth/sessao";
import { executor } from "@/lib/banco/servidor";
import { enviarContato, ErroContato } from "@/lib/contato/contato";

export interface EstadoContato { erro?: string; enviado?: boolean; entregue?: boolean }

const texto = (f: FormData, k: string, max: number) => String(f.get(k) ?? "").slice(0, max);

export async function acaoEnviarContato(_: EstadoContato, form: FormData): Promise<EstadoContato> {
  const u = await exigirUsuario();
  try {
    const status = await enviarContato(await executor(), {
      nome: texto(form, "nome", 150), contato: texto(form, "contato", 30), email: texto(form, "email", 200),
      modulo: texto(form, "modulo", 100), mensagem: texto(form, "mensagem", 6000),
    }, u);
    return { enviado: true, entregue: status === "ENVIADO" };
  } catch (e) {
    if (e instanceof ErroContato) return { erro: e.message };
    console.error(e);
    return { erro: "Não foi possível enviar. Tente novamente." };
  }
}
