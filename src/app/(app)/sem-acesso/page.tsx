import Link from "next/link";
import { PERMISSOES } from "@/lib/auth/permissoes";

export default async function SemAcesso({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const { p } = await searchParams;
  const perm = PERMISSOES.find((x) => x.codigo === p);
  return (
    <div className="mx-auto max-w-lg space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-6">
      <h1 className="text-xl font-semibold">Acesso não liberado</h1>
      <p className="text-sm text-slate-700">
        Seu usuário não tem a permissão {perm ? <strong>“{perm.nome}”</strong> : "necessária"} para abrir esta página. Peça ao administrador do sistema para liberá-la em “Usuários”.
      </p>
      <Link href="/" className="inline-block text-sm text-marca-700 underline">Voltar ao início</Link>
    </div>
  );
}
