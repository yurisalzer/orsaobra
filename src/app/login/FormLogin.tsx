"use client";

import Link from "next/link";
import { useActionState } from "react";
import { acaoEntrar, type EstadoLogin } from "./acoes";

export function FormLogin() {
  const [estado, acao, pendente] = useActionState<EstadoLogin, FormData>(acaoEntrar, {});
  return (
    <form action={acao} className="space-y-4">
      <label className="block">
        <span className="text-sm font-medium text-slate-700">E-mail</span>
        <input name="email" type="email" required autoComplete="username"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 focus:border-marca-600 focus:outline-none focus:ring-1 focus:ring-marca-600" />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-slate-700">Senha</span>
        <input name="senha" type="password" required autoComplete="current-password"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 focus:border-marca-600 focus:outline-none focus:ring-1 focus:ring-marca-600" />
      </label>
      {estado.erro && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {estado.erro}
          {estado.reenviar && <> <Link href="/cadastro/reenviar" className="font-medium underline">Reenviar o e-mail de confirmação</Link></>}
        </p>
      )}
      <button type="submit" disabled={pendente}
        className="w-full rounded-md bg-marca-600 px-4 py-2 font-medium text-white hover:bg-marca-700 disabled:opacity-60">
        {pendente ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
