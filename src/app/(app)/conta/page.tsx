import { exigirUsuario } from "@/lib/auth/sessao";
import { FormSenha } from "./FormSenha";

export default async function Conta() {
  const u = await exigirUsuario();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Minha conta</h1>
      <p className="text-sm text-slate-600">{u.nome} — {u.email}</p>
      <section className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="mb-3 font-medium">Alterar senha</h2><FormSenha /></section>
    </div>
  );
}
