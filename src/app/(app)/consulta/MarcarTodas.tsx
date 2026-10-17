"use client";

import { useEffect, useRef, useState } from "react";

/** Caixa "Todas as bases": marca/desmarca as caixas name="f" do formulário e mostra o estado parcial. */
type Estado = "todas" | "algumas" | "nenhuma";

const caixas = (el: HTMLInputElement | null) => [...(el?.form?.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="f"]') ?? [])];
function estadoDe(el: HTMLInputElement | null): Estado {
  const c = caixas(el);
  const n = c.filter((x) => x.checked).length;
  return n === c.length ? "todas" : n === 0 ? "nenhuma" : "algumas";
}

export function MarcarTodas() {
  const ref = useRef<HTMLInputElement>(null);
  const [estado, setEstado] = useState<Estado>("todas");
  const atualizar = () => setEstado(estadoDe(ref.current));
  useEffect(() => {
    const el = ref.current;
    const form = el?.form;
    const aoMudar = () => setEstado(estadoDe(el));
    aoMudar();
    form?.addEventListener("change", aoMudar);
    return () => form?.removeEventListener("change", aoMudar);
  }, []);
  useEffect(() => { if (ref.current) ref.current.indeterminate = estado === "algumas"; }, [estado]);
  return (
    <label className="flex items-center gap-2 text-sm font-medium">
      <input ref={ref} type="checkbox" checked={estado === "todas"} aria-label="Marcar ou desmarcar todas as bases"
        onChange={(e) => { for (const c of caixas(ref.current)) c.checked = e.target.checked; atualizar(); }} />
      Todas as bases
    </label>
  );
}
