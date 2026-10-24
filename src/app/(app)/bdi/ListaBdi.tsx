"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PerfilBdi } from "@/lib/orcamento/bdi";
import { acaoArquivarPerfil } from "../orcamentos/acoes";
import { EditorBdi } from "./EditorBdi";

const pct = (v: string) => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

export function ListaBdi({ perfis, podeEditar }: { perfis: PerfilBdi[]; podeEditar: boolean }) {
  const [editando, setEditando] = useState<PerfilBdi | "novo" | null>(null);
  const [, iniciar] = useTransition();
  const router = useRouter();
  return (
    <div className="space-y-4">
      {podeEditar && !editando && <button onClick={() => setEditando("novo")} className="rounded-md bg-marca-600 px-4 py-2 text-sm font-medium text-white">Novo perfil de BDI</button>}
      {editando && (
        <EditorBdi aoFechar={() => setEditando(null)} inicial={editando === "novo"
          ? { id: null, nome: "", descricao: null, percentualInformado: null, parcelas: [] }
          : { id: editando.id, nome: editando.nome, descricao: editando.descricao, percentualInformado: editando.percentualInformado, formula: editando.formula, parcelas: editando.parcelas }} />
      )}
      {perfis.length === 0 ? <p className="text-sm text-slate-500">Nenhum perfil cadastrado.</p> : perfis.map((p) => (
        <section key={p.id} className={`rounded-xl border border-slate-200 bg-white p-5 ${p.ativo ? "" : "opacity-60"}`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-medium">{p.nome} — <span className="text-marca-700">BDI {pct(p.bdiAplicado)}%</span>{!p.ativo && " (arquivado)"}</h2>
            {podeEditar && (
              <div className="flex gap-3 text-sm">
                <button className="text-marca-700 underline" onClick={() => setEditando(p)}>Editar</button>
                <button className="text-slate-600 underline" onClick={() => iniciar(async () => { await acaoArquivarPerfil(p.id, !p.ativo); router.refresh(); })}>{p.ativo ? "Arquivar" : "Reativar"}</button>
              </div>
            )}
          </div>
          {p.descricao && <p className="text-sm text-slate-600">{p.descricao}</p>}
          {p.percentualInformado ? <p className="mt-2 text-sm">Percentual informado diretamente.</p> : (<>
            <p className="mt-2 text-xs text-slate-600">{p.formula ? <>Fórmula personalizada: <code className="font-mono">BDI = {p.formula}</code></> : "Fórmula do Acórdão TCU 2.622/2013"}</p>
            <table className="mt-2 text-sm">
              <tbody>{p.parcelas.map((x, i) => <tr key={i}><td className="pr-3 text-slate-500">{x.tipo}</td><td className="pr-3">{x.nome}</td><td className="num">{pct(x.percentual)}%</td></tr>)}</tbody>
            </table>
          </>)}
          <p className="mt-2 text-xs text-slate-500">Calculado: {Number(p.bdiCalculado).toLocaleString("pt-BR", { maximumFractionDigits: 6 })}% · em uso em {p.emUso} revisão(ões)/item(ns)</p>
        </section>
      ))}
    </div>
  );
}
