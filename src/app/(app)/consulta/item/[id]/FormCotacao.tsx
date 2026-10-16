"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acaoRegistrarCotacao } from "../../../composicoes/acoes";

export function FormCotacao({ itemId }: { itemId: string }) {
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();
  const campo = "rounded-md border border-slate-300 px-2 py-1 text-sm";
  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-2"
      action={(f) => iniciar(async () => {
        setErro(null);
        const r = await acaoRegistrarCotacao({
          itemId, data: String(f.get("data")), valor: String(f.get("valor")), fonteCotacao: String(f.get("fonte")), observacao: String(f.get("obs") || "") || null,
        });
        if (!r.ok) setErro(r.erro); else router.refresh();
      })}
    >
      <label className="text-xs">Data<br /><input name="data" type="date" required className={campo} /></label>
      <label className="text-xs">Valor (R$)<br /><input name="valor" required inputMode="decimal" placeholder="0,00" className={`${campo} w-28`} /></label>
      <label className="text-xs">Fonte da cotação<br /><input name="fonte" required placeholder="Fornecedor, site, NF..." className={campo} /></label>
      <label className="text-xs">Observação<br /><input name="obs" className={campo} /></label>
      <button disabled={pendente} className="rounded-md bg-marca-600 px-3 py-1.5 text-sm text-white disabled:opacity-50">Registrar cotação</button>
      {erro && <p role="alert" className="w-full text-sm text-red-700">{erro}</p>}
    </form>
  );
}
