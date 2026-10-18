import { exigirUsuario } from "@/lib/auth/sessao";
import { listarUsuarios } from "@/lib/auth/usuarios";
import { executor } from "@/lib/banco/servidor";
import { GestaoUsuarios } from "./GestaoUsuarios";

export const dynamic = "force-dynamic";

export default async function PaginaUsuarios() {
  const u = await exigirUsuario("USUARIOS");
  const usuarios = await listarUsuarios(await executor());
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Usuários e permissões</h1>
      <p className="text-sm text-slate-600">
        Marque o que cada usuário pode acessar. As mudanças valem imediatamente (na próxima página que o usuário abrir) e ficam registradas na auditoria.
      </p>
      <GestaoUsuarios usuarios={usuarios} euId={u.id} />
    </div>
  );
}
