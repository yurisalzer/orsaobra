"use client";

import { useEffect, useState } from "react";
import { ehVersaoAntiga, tentarRecarregar } from "./recuperar-erro";

/** Mensagem amigável no lugar do "Application error" do navegador. */
export function TelaErro({ error, reset }: { error: Error & { digest?: string }; reset?: () => void }) {
  const [recarregando, setRecarregando] = useState(false);
  useEffect(() => {
    console.error(error);
    if (tentarRecarregar(error)) setRecarregando(true);
  }, [error]);
  const antiga = ehVersaoAntiga(error);
  return (
    <div className="mx-auto mt-16 max-w-lg rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
      <h1 className="text-lg font-semibold text-marca-900">{recarregando ? "Atualizando a página…" : "Algo deu errado nesta tela"}</h1>
      <p className="mt-2 text-sm text-slate-600">
        {antiga
          ? "O sistema foi atualizado enquanto esta página estava aberta. Recarregue para usar a versão nova."
          : "Ocorreu um erro inesperado no navegador. Seus dados salvos não foram afetados. Recarregue a página e tente de novo; se continuar, avise o administrador informando o que estava fazendo."}
      </p>
      {error.digest && <p className="mt-2 text-xs text-slate-400">Código do erro: {error.digest}</p>}
      <div className="mt-5 flex gap-2">
        <button onClick={() => window.location.reload()} className="rounded-md bg-marca-600 px-4 py-2 text-sm font-medium text-white hover:bg-marca-700">Recarregar a página</button>
        {reset && !antiga && <button onClick={reset} className="rounded-md border border-slate-300 px-4 py-2 text-sm">Tentar de novo</button>}
        <button onClick={() => window.location.assign("/")} className="rounded-md border border-slate-300 px-4 py-2 text-sm">Ir para o início</button>
      </div>
    </div>
  );
}
