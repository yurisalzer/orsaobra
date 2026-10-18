"use client";

import { useActionState } from "react";
import { acaoReenviar, type EstadoCadastro } from "../acoes";

export function FormReenviar() {
  const [estado, acao, pendente] = useActionState<EstadoCadastro, FormData>(acaoReenviar, {});
  if (estado.enviado) {
    return (
      <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
        Se houver um cadastro aguardando confirmação para {estado.email}, um novo link foi enviado. Verifique também a caixa de spam.
      </p>
    );
  }
  return (
    <form action={acao} className="space-y-4">
      <p className="text-sm text-slate-600">Informe o e-mail usado no cadastro para receber um novo link de confirmação.</p>
      <label className="block">
        <span className="text-sm font-medium text-slate-700">E-mail</span>
        <input name="email" type="email" required maxLength={200} autoComplete="email"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 focus:border-marca-600 focus:outline-none focus:ring-1 focus:ring-marca-600" />
      </label>
      {estado.erro && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{estado.erro}</p>}
      <button type="submit" disabled={pendente} className="w-full rounded-md bg-marca-600 px-4 py-2 font-medium text-white hover:bg-marca-700 disabled:opacity-60">
        {pendente ? "Enviando…" : "Reenviar e-mail"}
      </button>
    </form>
  );
}
