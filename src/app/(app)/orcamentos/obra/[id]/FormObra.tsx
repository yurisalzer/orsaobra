"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { acaoAlterarObra, type DadosNovaObra } from "../../acoes";
import { CamposObra } from "../../CamposObra";

export function FormObra({ obraId, inicial }: { obraId: string; inicial: DadosNovaObra }) {
  const [valor, setValor] = useState(inicial);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();
  const alterado = (Object.keys(inicial) as (keyof DadosNovaObra)[]).some((k) => inicial[k] !== valor[k]);

  const salvar = () => iniciar(async () => {
    setErro(null);
    const r = await acaoAlterarObra(obraId, inicial, valor);
    if (!r.ok) return setErro(r.erro);
    router.push("/orcamentos");
  });

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <CamposObra valor={valor} onChange={setValor} />
      </section>
      {erro && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{erro}</p>}
      <div className="flex gap-2">
        <button onClick={salvar} disabled={pendente || !alterado} className="rounded-md bg-marca-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {pendente ? "Salvando…" : "Salvar alterações"}
        </button>
        <button onClick={() => router.back()} disabled={pendente} className="rounded-md border border-slate-300 px-4 py-2 text-sm">Cancelar</button>
      </div>
    </div>
  );
}
