import Link from "next/link";
import { exigirUsuario } from "@/lib/auth/sessao";
import { Assistente } from "./Assistente";

export default async function NovaImportacao() {
  await exigirUsuario("ADMIN");
  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Nova importação</h1>
        <Link href="/importacao" className="text-sm text-marca-700 underline">Voltar às bases</Link>
      </div>
      <Assistente />
    </div>
  );
}
