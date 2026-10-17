"use client";

import type { DadosNovaObra } from "./acoes";

export const OBRA_VAZIA: DadosNovaObra = { nome: "", codigo: "", processo: "", descricao: "", endereco: "", municipio: "", orgaoSolicitante: "", cabecalhoId: "" };

const campo = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm";

/** Campos cadastrais da obra (usados ao criar e ao editar). */
export function CamposObra({ valor, onChange, cabecalhos }: { valor: DadosNovaObra; onChange: (v: DadosNovaObra) => void; cabecalhos: { id: string; nome: string; padrao: boolean }[] }) {
  const padrao = cabecalhos.find((c) => c.padrao);
  const p = (k: keyof DadosNovaObra) => ({ value: valor[k], onChange: (e: { target: { value: string } }) => onChange({ ...valor, [k]: e.target.value }) });
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_12rem_14rem]">
      <label className="text-sm">Nome da obra<input {...p("nome")} maxLength={200} className={campo} /></label>
      <label className="text-sm">Código da obra<input {...p("codigo")} maxLength={60} className={campo} /></label>
      <label className="text-sm">Processo<input {...p("processo")} maxLength={100} className={campo} /></label>
      <label className="text-sm sm:col-span-3">Descrição<textarea {...p("descricao")} maxLength={4000} rows={2} className={campo} /></label>
      <label className="text-sm">Endereço<input {...p("endereco")} maxLength={300} className={campo} /></label>
      <label className="text-sm">Cidade<input {...p("municipio")} maxLength={100} className={campo} /></label>
      <label className="text-sm">Órgão solicitante<input {...p("orgaoSolicitante")} maxLength={200} className={campo} /></label>
      <label className="text-sm sm:col-span-3">Cabeçalho dos relatórios
        <select value={valor.cabecalhoId} onChange={(e) => onChange({ ...valor, cabecalhoId: e.target.value })} aria-label="Cabeçalho dos relatórios" className={campo}>
          <option value="">{padrao ? `Padrão (${padrao.nome})` : "Padrão (nenhum cadastrado — sem timbre)"}</option>
          {cabecalhos.filter((c) => !c.padrao || valor.cabecalhoId === c.id).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        <span className="text-xs text-slate-500">Cadastre logos e textos em “Cabeçalhos”, no menu.</span>
      </label>
    </div>
  );
}
