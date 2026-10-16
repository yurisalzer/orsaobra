"use client";

import { useActionState } from "react";
import { acaoTrocarSenha, type EstadoSenha } from "./acoes";

export function FormSenha() {
  const [estado, acao, pendente] = useActionState<EstadoSenha, FormData>(acaoTrocarSenha, {});
  const campo = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2";
  return (
    <form action={acao} className="max-w-sm space-y-3">
      <label className="block text-sm">Senha atual<input name="atual" type="password" required autoComplete="current-password" className={campo} /></label>
      <label className="block text-sm">Nova senha (mín. 10 caracteres, letras e números)<input name="nova" type="password" required autoComplete="new-password" className={campo} /></label>
      <label className="block text-sm">Repita a nova senha<input name="repetir" type="password" required autoComplete="new-password" className={campo} /></label>
      {estado.erro && <p role="alert" className="text-sm text-red-700">{estado.erro}</p>}
      {estado.ok && <p role="status" className="text-sm text-green-700">Senha alterada.</p>}
      <button disabled={pendente} className="rounded-md bg-marca-600 px-4 py-2 text-sm text-white disabled:opacity-50">Alterar senha</button>
    </form>
  );
}
