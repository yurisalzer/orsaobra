"use client";

export interface FormContrato { numero: string; objeto: string; empresa: string; cnpj: string; dataAssinatura: string; dataOs: string; prazoDias: string }
export const CONTRATO_VAZIO: FormContrato = { numero: "", objeto: "", empresa: "", cnpj: "", dataAssinatura: "", dataOs: "", prazoDias: "" };

/** Formato aceito pelas ações do servidor. */
export const paraAcao = (f: FormContrato) => ({
  numero: f.numero, objeto: f.objeto, empresa: f.empresa || null, cnpj: f.cnpj || null,
  dataAssinatura: f.dataAssinatura || null, dataOs: f.dataOs || null, prazoDias: f.prazoDias.trim() ? Number(f.prazoDias) : null,
});

const campo = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50";

/** Dados do contrato (número, objeto, empresa, datas e prazo). */
export function CamposContrato({ valor, onChange, desabilitado = false }: { valor: FormContrato; onChange: (v: FormContrato) => void; desabilitado?: boolean }) {
  const p = (k: keyof FormContrato) => ({ value: valor[k], disabled: desabilitado, onChange: (e: { target: { value: string } }) => onChange({ ...valor, [k]: e.target.value }) });
  return (
    <div className="grid gap-3 sm:grid-cols-[10rem_1fr_12rem]">
      <label className="text-sm">Nº do contrato<input {...p("numero")} maxLength={60} placeholder="ex.: 017/2026" className={campo} /></label>
      <label className="text-sm">Empresa contratada<input {...p("empresa")} maxLength={300} className={campo} /></label>
      <label className="text-sm">CNPJ<input {...p("cnpj")} maxLength={20} inputMode="numeric" className={campo} /></label>
      <label className="text-sm sm:col-span-3">Objeto (nome da obra)<textarea {...p("objeto")} maxLength={2000} rows={2} className={campo} /></label>
      <label className="text-sm">Data de assinatura<input type="date" {...p("dataAssinatura")} className={campo} /></label>
      <label className="text-sm">Ordem de serviço (início)<input type="date" {...p("dataOs")} className={campo} /></label>
      <label className="text-sm">Prazo (dias)<input {...p("prazoDias")} inputMode="numeric" maxLength={5} className={campo} /></label>
    </div>
  );
}
