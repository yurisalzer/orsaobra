"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { acaoExcluirObra, acaoExcluirOrcamento } from "./acoes";

/** Texto da confirmação: a exclusão é definitiva (inclusive das revisões fechadas). */
export function mensagemExclusao(titulo: string, temFechada: boolean) {
  return `ATENÇÃO: este procedimento EXCLUI EM DEFINITIVO o orçamento "${titulo}".\n\n` +
    `Serão apagadas todas as revisões${temFechada ? " — inclusive as FECHADAS" : ""}, etapas, itens, memórias de cálculo e o cronograma. ` +
    `Não será possível recuperar.\n\nDeseja realmente excluir?`;
}

export function ExcluirOrcamento({ orcamentoId, titulo, temFechada = false, botao = false, depois }: { orcamentoId: string; titulo: string; temFechada?: boolean; botao?: boolean; depois?: string }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const excluir = () => {
    if (!window.confirm(mensagemExclusao(titulo, temFechada))) return;
    iniciar(async () => {
      setErro(null);
      const r = await acaoExcluirOrcamento(orcamentoId);
      if (!r.ok) return setErro(r.erro);
      if (depois) router.push(depois);
      else router.refresh();
    });
  };
  return (
    <>
      <button onClick={excluir} disabled={pendente} aria-label={`Excluir orçamento ${titulo}`}
        className={botao ? "rounded-md border border-red-300 px-3 py-1.5 text-red-700 hover:bg-red-50 disabled:opacity-50" : "text-sm text-red-700 hover:underline disabled:opacity-50"}>
        {pendente ? "Excluindo…" : botao ? "Excluir orçamento" : "Excluir"}
      </button>
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
