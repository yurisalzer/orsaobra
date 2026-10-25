"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Conselho, EmpresaCompleta, ResponsavelTecnico } from "@/lib/empresas/servico";
import { acaoAlterarEmpresa, acaoAtivarEmpresa, acaoCriarEmpresa } from "./acoes";

const CONSELHOS: { codigo: Conselho; nome: string }[] = [
  { codigo: "CREA", nome: "CREA" }, { codigo: "CAU", nome: "CAU" }, { codigo: "CFT", nome: "CFT/CRT" }, { codigo: "OUTRO", nome: "Outro" },
];
const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];

type Rt = { [K in keyof ResponsavelTecnico]: K extends "principal" ? boolean : K extends "conselho" ? Conselho : string };
type Form = {
  razaoSocial: string; nomeFantasia: string; cnpj: string; inscricaoEstadual: string; inscricaoMunicipal: string;
  cep: string; logradouro: string; numero: string; complemento: string; bairro: string; municipio: string; uf: string;
  telefone: string; email: string; representanteNome: string; representanteCpf: string; representanteCargo: string; observacoes: string;
  responsaveis: Rt[];
};

const RT_VAZIO: Rt = { nome: "", titulo: "", conselho: "CREA", registro: "", ufRegistro: "RJ", cpf: "", email: "", telefone: "", principal: false };
const mascaraCnpj = (d: string) => d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
const mascaraCpf = (d: string) => d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
const mascaraCep = (d: string) => d.replace(/^(\d{5})(\d{3})$/, "$1-$2");

function paraForm(e: EmpresaCompleta | null): Form {
  const s = (v: string | null | undefined) => v ?? "";
  if (!e) {
    return {
      razaoSocial: "", nomeFantasia: "", cnpj: "", inscricaoEstadual: "", inscricaoMunicipal: "", cep: "", logradouro: "", numero: "", complemento: "",
      bairro: "", municipio: "", uf: "RJ", telefone: "", email: "", representanteNome: "", representanteCpf: "", representanteCargo: "", observacoes: "",
      responsaveis: [{ ...RT_VAZIO, principal: true }],
    };
  }
  return {
    razaoSocial: e.razaoSocial, nomeFantasia: s(e.nomeFantasia), cnpj: mascaraCnpj(e.cnpj), inscricaoEstadual: s(e.inscricaoEstadual), inscricaoMunicipal: s(e.inscricaoMunicipal),
    cep: e.cep ? mascaraCep(e.cep) : "", logradouro: s(e.logradouro), numero: s(e.numero), complemento: s(e.complemento), bairro: s(e.bairro), municipio: s(e.municipio), uf: s(e.uf),
    telefone: s(e.telefone), email: s(e.email), representanteNome: s(e.representanteNome), representanteCpf: e.representanteCpf ? mascaraCpf(e.representanteCpf) : "",
    representanteCargo: s(e.representanteCargo), observacoes: s(e.observacoes),
    responsaveis: e.responsaveis.map((r) => ({
      nome: r.nome, titulo: s(r.titulo), conselho: r.conselho, registro: r.registro, ufRegistro: s(r.ufRegistro), cpf: r.cpf ? mascaraCpf(r.cpf) : "",
      email: s(r.email), telefone: s(r.telefone), principal: r.principal,
    })),
  };
}

const campo = "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-50";

export function FormEmpresa({ inicial, podeEditar }: { inicial: EmpresaCompleta | null; podeEditar: boolean }) {
  const [f, setF] = useState<Form>(paraForm(inicial));
  const [versao, setVersao] = useState(inicial?.versao ?? 1);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();
  const off = !podeEditar;

  const p = (k: Exclude<keyof Form, "responsaveis">, extra: Record<string, unknown> = {}) => ({
    value: f[k], disabled: off, onChange: (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); setAviso(null); }, ...extra,
  });
  const rt = (i: number, m: Partial<Rt>) => { setF({ ...f, responsaveis: f.responsaveis.map((r, j) => (j === i ? { ...r, ...m } : r)) }); setAviso(null); };
  const principal = (i: number) => setF({ ...f, responsaveis: f.responsaveis.map((r, j) => ({ ...r, principal: j === i })) });

  const paraAcao = () => {
    const n = (v: string) => v.trim() || null;
    return {
      razaoSocial: f.razaoSocial, nomeFantasia: n(f.nomeFantasia), cnpj: f.cnpj, inscricaoEstadual: n(f.inscricaoEstadual), inscricaoMunicipal: n(f.inscricaoMunicipal),
      cep: n(f.cep), logradouro: n(f.logradouro), numero: n(f.numero), complemento: n(f.complemento), bairro: n(f.bairro), municipio: n(f.municipio), uf: n(f.uf),
      telefone: n(f.telefone), email: n(f.email), representanteNome: n(f.representanteNome), representanteCpf: n(f.representanteCpf), representanteCargo: n(f.representanteCargo),
      observacoes: n(f.observacoes),
      responsaveis: f.responsaveis.map((r) => ({
        nome: r.nome, titulo: n(r.titulo), conselho: r.conselho, registro: r.registro, ufRegistro: n(r.ufRegistro), cpf: n(r.cpf), email: n(r.email), telefone: n(r.telefone), principal: r.principal,
      })),
    };
  };

  const salvar = () => iniciar(async () => {
    setErro(null);
    if (!inicial) {
      const r = await acaoCriarEmpresa(paraAcao());
      if (!r.ok) return setErro(r.erro);
      router.push(`/empresas/${r.dados}`);
      return;
    }
    const r = await acaoAlterarEmpresa(inicial.id, versao, paraAcao());
    if (!r.ok) return setErro(r.erro);
    setVersao(versao + 1);
    setAviso("Empresa salva.");
    router.refresh();
  });

  const ativar = () => iniciar(async () => {
    if (!inicial) return;
    if (inicial.ativo && !window.confirm(`Desativar a empresa ${inicial.razaoSocial}? Ela deixa de aparecer para novos contratos (os contratos existentes não mudam).`)) return;
    const r = await acaoAtivarEmpresa(inicial.id, !inicial.ativo);
    if (!r.ok) return setErro(r.erro);
    setVersao(versao + 1);
    router.refresh();
  });

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-medium">Dados da empresa</h2>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_14rem]">
          <label className="text-sm">Razão social *<input {...p("razaoSocial")} maxLength={300} className={campo} /></label>
          <label className="text-sm">Nome fantasia<input {...p("nomeFantasia")} maxLength={300} className={campo} /></label>
          <label className="text-sm">CNPJ *<input {...p("cnpj")} maxLength={18} inputMode="numeric" placeholder="00.000.000/0000-00" className={campo} /></label>
          <label className="text-sm">Inscrição estadual<input {...p("inscricaoEstadual")} maxLength={40} className={campo} /></label>
          <label className="text-sm">Inscrição municipal<input {...p("inscricaoMunicipal")} maxLength={40} className={campo} /></label>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-medium">Endereço e contato</h2>
        <div className="grid gap-3 sm:grid-cols-[9rem_1fr_7rem_12rem]">
          <label className="text-sm">CEP<input {...p("cep")} maxLength={9} inputMode="numeric" placeholder="00000-000" className={campo} /></label>
          <label className="text-sm">Logradouro<input {...p("logradouro")} maxLength={300} placeholder="Rua, avenida, estrada..." className={campo} /></label>
          <label className="text-sm">Número<input {...p("numero")} maxLength={20} className={campo} /></label>
          <label className="text-sm">Complemento<input {...p("complemento")} maxLength={120} className={campo} /></label>
          <label className="text-sm">Bairro<input {...p("bairro")} maxLength={120} className={campo} /></label>
          <label className="text-sm sm:col-span-2">Município<input {...p("municipio")} maxLength={120} className={campo} /></label>
          <label className="text-sm">UF
            <select {...p("uf")} aria-label="UF" className={campo}><option value="">—</option>{UFS.map((u) => <option key={u}>{u}</option>)}</select>
          </label>
          <label className="text-sm sm:col-span-2">E-mail da empresa<input type="email" {...p("email")} maxLength={200} className={campo} /></label>
          <label className="text-sm sm:col-span-2">Telefone da empresa<input type="tel" {...p("telefone")} maxLength={20} placeholder="(22) 2222-2222" className={campo} /></label>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
        <div>
          <h2 className="font-medium">Responsáveis técnicos *</h2>
          <p className="text-xs text-slate-500">Profissionais legalmente habilitados que respondem tecnicamente pela empresa (registro no CREA, CAU ou CFT). O principal é sugerido ao vincular a empresa a um contrato.</p>
        </div>
        <ol className="space-y-3">
          {f.responsaveis.map((r, i) => (
            <li key={i} className="space-y-3 rounded-lg border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="radio" name="principal" checked={r.principal} disabled={off} onChange={() => principal(i)} aria-label={`Responsável técnico principal ${i + 1}`} />
                  Responsável técnico {i + 1}{r.principal ? " — principal" : ""}
                </label>
                {podeEditar && f.responsaveis.length > 1 && (
                  <button type="button" onClick={() => {
                    const resto = f.responsaveis.filter((_, j) => j !== i);
                    if (r.principal && resto.length) resto[0] = { ...resto[0], principal: true };
                    setF({ ...f, responsaveis: resto });
                  }} className="text-xs text-red-700 underline">remover</button>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
                <label className="text-sm">Nome completo *<input value={r.nome} disabled={off} onChange={(e) => rt(i, { nome: e.target.value })} maxLength={200} aria-label={`Nome do responsável técnico ${i + 1}`} className={campo} /></label>
                <label className="text-sm">Título profissional<input value={r.titulo} disabled={off} onChange={(e) => rt(i, { titulo: e.target.value })} maxLength={120} placeholder="Engenheiro civil" aria-label={`Título profissional ${i + 1}`} className={campo} /></label>
              </div>
              <div className="grid gap-3 sm:grid-cols-[9rem_1fr_7rem_12rem]">
                <label className="text-sm">Conselho *
                  <select value={r.conselho} disabled={off} onChange={(e) => rt(i, { conselho: e.target.value as Conselho })} aria-label={`Conselho ${i + 1}`} className={campo}>
                    {CONSELHOS.map((c) => <option key={c.codigo} value={c.codigo}>{c.nome}</option>)}
                  </select>
                </label>
                <label className="text-sm">Nº de registro no conselho *<input value={r.registro} disabled={off} onChange={(e) => rt(i, { registro: e.target.value })} maxLength={40} aria-label={`Registro no conselho ${i + 1}`} className={campo} /></label>
                <label className="text-sm">UF do registro
                  <select value={r.ufRegistro} disabled={off} onChange={(e) => rt(i, { ufRegistro: e.target.value })} aria-label={`UF do registro ${i + 1}`} className={campo}>
                    <option value="">—</option>{UFS.map((u) => <option key={u}>{u}</option>)}
                  </select>
                </label>
                <label className="text-sm">CPF<input value={r.cpf} disabled={off} onChange={(e) => rt(i, { cpf: e.target.value })} maxLength={14} inputMode="numeric" aria-label={`CPF do responsável técnico ${i + 1}`} className={campo} /></label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">E-mail<input type="email" value={r.email} disabled={off} onChange={(e) => rt(i, { email: e.target.value })} maxLength={200} aria-label={`E-mail do responsável técnico ${i + 1}`} className={campo} /></label>
                <label className="text-sm">Telefone<input type="tel" value={r.telefone} disabled={off} onChange={(e) => rt(i, { telefone: e.target.value })} maxLength={20} aria-label={`Telefone do responsável técnico ${i + 1}`} className={campo} /></label>
              </div>
            </li>
          ))}
        </ol>
        {podeEditar && <button type="button" onClick={() => setF({ ...f, responsaveis: [...f.responsaveis, { ...RT_VAZIO }] })} className="text-sm text-marca-700 underline">+ responsável técnico</button>}
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-medium">Representante legal</h2>
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem_14rem]">
          <label className="text-sm">Nome<input {...p("representanteNome")} maxLength={200} aria-label="Nome do representante legal" className={campo} /></label>
          <label className="text-sm">CPF<input {...p("representanteCpf")} maxLength={14} inputMode="numeric" aria-label="CPF do representante legal" className={campo} /></label>
          <label className="text-sm">Cargo<input {...p("representanteCargo")} maxLength={120} placeholder="Sócio-administrador" aria-label="Cargo do representante legal" className={campo} /></label>
          <label className="text-sm sm:col-span-3">Observações<textarea {...p("observacoes")} maxLength={2000} rows={2} className={campo} /></label>
        </div>
      </section>

      {erro && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{erro}</p>}
      {aviso && <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">{aviso}</p>}
      {podeEditar && (
        <div className="flex flex-wrap gap-2">
          <button onClick={salvar} disabled={pendente} className="rounded-md bg-marca-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {pendente ? "Salvando…" : inicial ? "Salvar alterações" : "Cadastrar empresa"}
          </button>
          {inicial && (
            <button onClick={ativar} disabled={pendente} className="rounded-md border border-slate-300 px-4 py-2 text-sm disabled:opacity-50">
              {inicial.ativo ? "Desativar empresa" : "Reativar empresa"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
