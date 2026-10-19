import { exigirUsuario } from "@/lib/auth/sessao";
import { MODULOS_CONTATO } from "@/lib/contato/contato";
import { FormContato } from "./FormContato";

export const metadata = { title: "Contato — Orçamento de Obras" };

export default async function PaginaContato() {
  const u = await exigirUsuario();
  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-2xl font-semibold">Contato</h1>
      <p className="text-sm text-slate-600">Dúvidas, sugestões ou problemas? Envie sua mensagem; a resposta chegará no e-mail informado.</p>
      <FormContato nome={u.nome} email={u.email} modulos={[...MODULOS_CONTATO]} />
    </div>
  );
}
