"use client";

import { useEffect, useState } from "react";

export type Tema = "auto" | "claro" | "escuro";
const CHAVE = "tema";

/** Aplica o tema no <html> (o mesmo cálculo do script que roda antes da pintura). */
export function aplicarTema(t: Tema) {
  const escuro = t === "escuro" || (t === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.tema = escuro ? "escuro" : "claro";
}

/** Script embutido no <head>: evita a tela "piscar" clara antes de aplicar o tema escuro. */
export const SCRIPT_TEMA = `(function(){try{var t=localStorage.getItem("${CHAVE}")||"auto";var e=t==="escuro"||(t==="auto"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.tema=e?"escuro":"claro";}catch(_){}})();`;

function lerTema(): Tema {
  try {
    const t = localStorage.getItem(CHAVE);
    return t === "claro" || t === "escuro" ? t : "auto";
  } catch {
    return "auto";
  }
}

/** Escolha do tema: claro, escuro ou automático (segue o tema do computador). */
export function TemaSeletor() {
  const [tema, setTema] = useState<Tema>("auto");
  useEffect(() => { setTema(lerTema()); }, []);
  // no automático, acompanha a troca de tema do sistema sem recarregar
  useEffect(() => {
    if (tema !== "auto") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const mudar = () => aplicarTema("auto");
    mq.addEventListener("change", mudar);
    return () => mq.removeEventListener("change", mudar);
  }, [tema]);

  const escolher = (t: Tema) => {
    setTema(t);
    try { if (t === "auto") localStorage.removeItem(CHAVE); else localStorage.setItem(CHAVE, t); } catch { /* navegação privada */ }
    aplicarTema(t);
  };

  return (
    <label className="flex items-center gap-1 text-slate-600">
      <span aria-hidden="true">{tema === "escuro" ? "🌙" : tema === "claro" ? "☀️" : "🖥️"}</span>
      <span className="sr-only">Tema</span>
      <select value={tema} onChange={(e) => escolher(e.target.value as Tema)} aria-label="Tema"
        className="rounded-md border border-slate-300 bg-white px-1.5 py-0.5 text-sm text-slate-700">
        <option value="auto">Automático (sistema)</option>
        <option value="claro">Claro</option>
        <option value="escuro">Escuro</option>
      </select>
    </label>
  );
}
