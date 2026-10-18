import { exigirUsuario } from "@/lib/auth/sessao";
import { listarUsuarios } from "@/lib/auth/usuarios";
import { executor } from "@/lib/banco/servidor";
import { emailConfigurado, listarCaixaSaida } from "@/lib/email/enviar";
import { GestaoUsuarios } from "./GestaoUsuarios";

export const dynamic = "force-dynamic";

export default async function PaginaUsuarios() {
  const u = await exigirUsuario("USUARIOS");
  const ex = await executor();
  const [usuarios, emails] = await Promise.all([listarUsuarios(ex), listarCaixaSaida(ex, 30)]);
  const pendentes = usuarios.filter((x) => !x.aprovado && !x.ativo).length;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Usuários e permissões</h1>
      <p className="text-sm text-slate-600">
        Marque o que cada usuário pode acessar. As mudanças valem imediatamente (na próxima página que o usuário abrir) e ficam registradas na auditoria.
      </p>
      {pendentes > 0 && (
        <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {pendentes === 1 ? "1 cadastro aguarda" : `${pendentes} cadastros aguardam`} a liberação do acesso (destacados em amarelo na tabela).
        </p>
      )}
      <GestaoUsuarios usuarios={usuarios} euId={u.id} emails={emails} emailConfigurado={emailConfigurado()} />
    </div>
  );
}
