import { exigirUsuario } from "@/lib/auth/sessao";
import { EditorProprio } from "../EditorProprio";

export default async function Nova({ searchParams }: { searchParams: Promise<{ tipo?: string }> }) {
  await exigirUsuario("ORCAMENTISTA");
  const tipo = (await searchParams).tipo === "INSUMO" ? "INSUMO" : "COMPOSICAO";
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{tipo === "INSUMO" ? "Novo insumo próprio" : "Nova composição própria"}</h1>
      <EditorProprio inicial={{ tipo, itemId: null, versao: null, codigo: "", descricao: "", unidade: "", componentes: [] }} />
    </div>
  );
}
