"use client";

import { useState, useTransition } from "react";
import { acaoDescartarBase, acaoPublicarBase, acaoValidarBase } from "./acoes";

export function AcoesBase({ revisaoId, status, rotulo }: { revisaoId: string; status: string; rotulo: string }) {
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  const rodar = (f: () => Promise<{ ok: boolean; erro?: string }>, pergunta: string) => {
    if (!window.confirm(pergunta)) return;
    setErro(null);
    iniciar(async () => {
      const r = await f();
      if (!r.ok) setErro(r.erro ?? "Erro");
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "EM_IMPORTACAO" && (
        <button disabled={pendente} className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
          onClick={() => rodar(() => acaoValidarBase(revisaoId), `Confirma que conferiu os dados de ${rotulo} e que a base está correta?`)}>
          Validar
        </button>
      )}
      {status === "VALIDADA" && (
        <button disabled={pendente} className="rounded bg-green-700 px-2 py-1 text-xs text-white hover:bg-green-800"
          onClick={() => rodar(() => acaoPublicarBase(revisaoId), `Publicar ${rotulo}? Ela ficará disponível para novos orçamentos e não poderá mais ser alterada.`)}>
          Publicar
        </button>
      )}
      {(status === "EM_IMPORTACAO" || status === "VALIDADA") && (
        <button disabled={pendente} className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
          onClick={() => {
            const motivo = window.prompt(`Motivo do descarte de ${rotulo}:`);
            if (motivo) rodar(() => acaoDescartarBase(revisaoId, motivo), `Descartar ${rotulo}? Os dados importados desta revisão serão removidos.`);
          }}>
          Descartar
        </button>
      )}
      {pendente && <span className="text-xs text-slate-500">Processando…</span>}
      {erro && <span role="alert" className="text-xs text-red-700">{erro}</span>}
    </div>
  );
}
