import { notFound } from "next/navigation";
import { z } from "zod";
import { exigirUsuario } from "@/lib/auth/sessao";
import { executor } from "@/lib/banco/servidor";
import { cabecalhoItem, linhasDaVersao } from "@/lib/referencia/item";
import { EditorProprio } from "../../EditorProprio";

/** "1.2790000000" → "1,279" (sem perder zeros da parte inteira). */
const paraEdicao = (c: string) => (c.includes(".") ? c.replace(/0+$/, "").replace(/\.$/, "") : c).replace(".", ",");

export default async function Editar({ params }: { params: Promise<{ id: string }> }) {
  await exigirUsuario("ORCAMENTISTA");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const ex = await executor();
  const item = await cabecalhoItem(ex, id);
  if (!item || !item.proprio) notFound();
  const linhas = item.proprio.composicaoVersaoId ? await linhasDaVersao(ex, item.proprio.composicaoVersaoId, null) : [];
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Editar {item.tipo === "INSUMO" ? "insumo" : "composição"} próprio — <span className="font-mono">{item.codigo}</span></h1>
      <p className="text-sm text-slate-600">Salvar cria a versão {item.proprio.versao + 1}. A versão atual fica guardada (orçamentos já fechados não mudam).</p>
      <EditorProprio inicial={{
        tipo: item.tipo, itemId: id, versao: item.proprio.versao, codigo: item.codigo, descricao: item.descricao, unidade: item.unidade ?? "",
        componentes: linhas.map((l) => ({ itemId: l.itemId, fonte: l.fonte, tipo: l.tipo, codigo: l.codigo, descricao: l.descricao, unidade: l.unidade, coeficiente: paraEdicao(l.coeficiente) })),
      }} />
    </div>
  );
}
