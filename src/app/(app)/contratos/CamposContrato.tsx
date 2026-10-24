"use client";

import { calcularPrazos, dataBr } from "@/lib/contratos/prazos";

export interface FormContrato {
  numero: string; processo: string; objeto: string; empresa: string; cnpj: string; dataAssinatura: string; dataOs: string; prazoExecucaoDias: string; prazoVigenciaDias: string;
  endereco: string; responsavelTecnico: string; artRrt: string; emailContato: string; telefoneContato: string;
}
export const CONTRATO_VAZIO: FormContrato = {
  numero: "", processo: "", objeto: "", empresa: "", cnpj: "", dataAssinatura: "", dataOs: "", prazoExecucaoDias: "", prazoVigenciaDias: "",
  endereco: "", responsavelTecnico: "", artRrt: "", emailContato: "", telefoneContato: "",
};

const dias = (s: string) => (s.trim() && /^\d+$/.test(s.trim()) ? Number(s.trim()) : null);

/** Formato aceito pelas ações do servidor. */
export const paraAcao = (f: FormContrato) => ({
  numero: f.numero, processo: f.processo || null, objeto: f.objeto, empresa: f.empresa || null, cnpj: f.cnpj || null,
  dataAssinatura: f.dataAssinatura || null, dataOs: f.dataOs || null, prazoExecucaoDias: dias(f.prazoExecucaoDias), prazoVigenciaDias: dias(f.prazoVigenciaDias),
  endereco: f.endereco || null, responsavelTecnico: f.responsavelTecnico || null, artRrt: f.artRrt || null, emailContato: f.emailContato || null, telefoneContato: f.telefoneContato || null,
});

const campo = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50";

/** Dados do contrato: identificação, prazos (com términos calculados), endereço e responsável técnico. */
export function CamposContrato({ valor, onChange, desabilitado = false }: { valor: FormContrato; onChange: (v: FormContrato) => void; desabilitado?: boolean }) {
  const p = (k: keyof FormContrato) => ({ value: valor[k], disabled: desabilitado, onChange: (e: { target: { value: string } }) => onChange({ ...valor, [k]: e.target.value }) });
  const pr = calcularPrazos({ dataAssinatura: valor.dataAssinatura, dataOs: valor.dataOs, prazoExecucaoDias: dias(valor.prazoExecucaoDias), prazoVigenciaDias: dias(valor.prazoVigenciaDias) });
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr_12rem]">
        <label className="text-sm">Nº do contrato<input {...p("numero")} maxLength={60} placeholder="ex.: 017/2026" className={campo} /></label>
        <label className="text-sm">Empresa contratada<input {...p("empresa")} maxLength={300} className={campo} /></label>
        <label className="text-sm">CNPJ<input {...p("cnpj")} maxLength={20} inputMode="numeric" className={campo} /></label>
        <label className="text-sm">Nº do processo<input {...p("processo")} maxLength={100} placeholder="ex.: SEI-120001/000123/2026" className={campo} /></label>
        <label className="text-sm sm:col-span-2">Objeto (nome da obra)<textarea {...p("objeto")} maxLength={2000} rows={2} className={campo} /></label>
        <label className="text-sm sm:col-span-3">Endereço da obra<input {...p("endereco")} maxLength={300} placeholder="Rua, número, bairro, município/UF" className={campo} /></label>
      </div>

      <fieldset className="rounded-lg border border-slate-200 p-3">
        <legend className="px-1 text-sm font-medium">Prazos</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase text-slate-500">Prazo contratual (vigência)</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm">Data de assinatura<input type="date" {...p("dataAssinatura")} className={campo} /></label>
              <label className="text-sm">Prazo contratual (dias)<input {...p("prazoVigenciaDias")} inputMode="numeric" maxLength={5} className={campo} /></label>
            </div>
            <p className="text-sm" aria-live="polite">Término da vigência: <strong>{dataBr(pr.terminoVigencia)}</strong></p>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase text-slate-500">Prazo de execução</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm">Ordem de serviço (início)<input type="date" {...p("dataOs")} className={campo} /></label>
              <label className="text-sm">Prazo de execução (dias)<input {...p("prazoExecucaoDias")} inputMode="numeric" maxLength={5} className={campo} /></label>
            </div>
            <p className="text-sm" aria-live="polite">Término da execução: <strong>{dataBr(pr.terminoExecucao)}</strong></p>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-500">Dias corridos, contando o dia de início (término = início + prazo − 1 dia).</p>
        {pr.execucaoAlemDaVigencia && <p role="alert" className="mt-1 text-sm text-amber-800">⚠ A execução termina depois do fim da vigência do contrato.</p>}
      </fieldset>

      <fieldset className="rounded-lg border border-slate-200 p-3">
        <legend className="px-1 text-sm font-medium">Responsável técnico da contratada</legend>
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <label className="text-sm">Nome do responsável técnico<input {...p("responsavelTecnico")} maxLength={200} className={campo} /></label>
          <label className="text-sm">ART / RRT<input {...p("artRrt")} maxLength={60} className={campo} /></label>
          <label className="text-sm">E-mail de contato<input type="email" {...p("emailContato")} maxLength={200} className={campo} /></label>
          <label className="text-sm">Telefone de contato<input type="tel" {...p("telefoneContato")} maxLength={20} placeholder="(22) 99999-9999" className={campo} /></label>
        </div>
      </fieldset>
    </div>
  );
}
