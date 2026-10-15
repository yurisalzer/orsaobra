"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { entrar } from "@/lib/auth/sessao";

const esquema = z.object({
  email: z.string().email("Informe um e-mail válido.").max(200),
  senha: z.string().min(1, "Informe a senha.").max(200),
});

export interface EstadoLogin {
  erro?: string;
}

export async function acaoEntrar(_: EstadoLogin, form: FormData): Promise<EstadoLogin> {
  const dados = esquema.safeParse({ email: form.get("email"), senha: form.get("senha") });
  if (!dados.success) return { erro: dados.error.issues[0].message };
  const r = await entrar(dados.data.email, dados.data.senha);
  if (!r.ok) return { erro: r.mensagem };
  redirect("/");
}
