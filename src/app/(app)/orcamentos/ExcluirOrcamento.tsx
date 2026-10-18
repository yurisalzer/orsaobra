"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { acaoExcluirObra, acaoExcluirOrcamento } from "./acoes";

export function ExcluirOrcamento({ orcamentoId, titulo }: { orcamentoId: string; titulo: string }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const excluir = () => {
    if (!window.confirm(`Excluir o orçamento "${titulo}"?\n\nTodas as revisões, etapas, itens e o cronograma serão apagados. Esta ação não pode ser desfeita.`)) return;
    iniciar(async () => {
      setErro(null);
      const r = await acaoExcluirOrcamento(orcamentoId);
      if (!r.ok) return setErro(r.erro);
      router.refresh();
    });
  };
  return (
    <>
      <button onClick={excluir} disabled={pendente} aria-label={`Excluir orçamento ${titulo}`}
        className="text-sm text-red-700 hover:underline disabled:opacity-50">{pendente ? "Excluindo…" : "Excluir"}</button>
      {erro && <span role="alert" className="ml-2 text-xs text-red-700">{erro}</span>}
    </>
  );
}

export function ExcluirObra({ obraId, nome }: { obraId: string; nome: string }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const excluir = () => {
    if (!window.confirm(`Excluir a obra "${nome}"?\n\nA obra não tem orçamentos. Esta ação não pode ser desfeita.`)) return;
    iniciar(async () => {
      setErro(null);
      const r = await acaoExcluirObra(obraId);
      if (!r.ok) return setErro(r.erro);
      router.refresh();
    });
  };
  return (
    <>
      <button onClick={excluir} disabled={pendente} aria-label={`Excluir obra ${nome}`} className="text-sm text-red-700 hover:underline disabled:opacity-50">{pendente ? "Excluindo…" : "Excluir obra"}</button>
      {erro && <span role="alert" className="ml-2 text-xs text-red-700">{erro}</span>}
    </>
  );
}
