"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { OpcoesDocumentoMedicao } from "@/lib/relatorios/medicao-pdf";
import { useRouter } from "next/navigation";
import { MAX_FISCAIS, MIN_FISCAIS, type AssinaturasMedicao } from "@/lib/medicoes/assinaturas";
import { acaoDadosBoletim, acaoDadosDesembolso, acaoSalvarAssinaturas } from "../acoes";

const NOTA_MODELO = "A soma dos valores dos pagamentos das faturas emitidas até a última medição não poderá ser superior a 90% (noventa por cento) do valor global do contrato.";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function baixar(dados: Blob, nome: string) {
  const url = URL.createObjectURL(dados);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function pdf(definicao: unknown): Promise<Blob> {
  const [{ default: pdfMake }, vfs] = await Promise.all([import("pdfmake/build/pdfmake"), import("pdfmake/build/vfs_fonts")]);
  const pm = pdfMake as unknown as { addVirtualFileSystem: (v: unknown) => void; createPdf: (d: unknown) => { getBlob: () => Promise<Blob> } };
  pm.addVirtualFileSystem((vfs as { default?: unknown }).default ?? vfs);
  return pm.createPdf(definicao).getBlob();
}

const nomeArquivo = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "_").replace(/_+/g, "_");

interface Campos { empenho: string; nota: string }
type Fiscal = { nome: string; cargo: string };

export function DocumentosMedicao({ contratoId, contratoNumero, medicaoId, numero, assinaturas, podeEditar }: {
  contratoId: string; contratoNumero: string; medicaoId: string; numero: number; assinaturas: AssinaturasMedicao; podeEditar: boolean;
}) {
  const chave = `documentos-medicao:${contratoId}`;
  const router = useRouter();
  const [campos, setCampos] = useState<Campos>({ empenho: "", nota: "" });
  const completar = (f: Fiscal[]) => [...f, ...Array.from({ length: Math.max(0, MAX_FISCAIS - f.length) }, () => ({ nome: "", cargo: "" }))].slice(0, MAX_FISCAIS);
  const [fiscais, setFiscais] = useState<Fiscal[]>(() => completar(assinaturas.fiscais));
  const [empresa, setEmpresa] = useState(assinaturas.empresa);
  const [salvas, setSalvas] = useState(assinaturas.salvas);
  const [gerando, setGerando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  // empenho e nota ficam guardados no navegador, por contrato (as assinaturas, no contrato)
  useEffect(() => {
    try { const s = localStorage.getItem(chave); if (s) { const v = JSON.parse(s); setCampos({ empenho: v.empenho ?? "", nota: v.nota ?? "" }); } } catch { /* sem armazenamento */ }
  }, [chave]);
  const alterar = (k: keyof Campos, v: string) => setCampos((c) => {
    const novo = { ...c, [k]: v };
    try { localStorage.setItem(chave, JSON.stringify(novo)); } catch { /* sem armazenamento */ }
    return novo;
  });
  const alterarFiscal = (i: number, k: keyof Fiscal, v: string) => { setSalvas(false); setFiscais((f) => f.map((x, j) => (j === i ? { ...x, [k]: v } : x))); };
  const alterarEmpresa = (k: keyof AssinaturasMedicao["empresa"], v: string) => { setSalvas(false); setEmpresa((e) => ({ ...e, [k]: v })); };
  const comNome = fiscais.filter((f) => f.nome.trim());

  /** Grava as assinaturas no contrato (se mudaram); devolve false se houve erro. */
  const salvarAssinaturas = async (msg = true): Promise<boolean> => {
    // sem permissão de edição os campos ficam travados: vale o que está gravado
    if (salvas || !podeEditar) return true;
    const r = await acaoSalvarAssinaturas(contratoId, { fiscais, empresa });
    if (!r.ok) { setErro(r.erro); return false; }
    setFiscais(completar(r.dados.fiscais));
    setEmpresa(r.dados.empresa);
    setSalvas(true);
    if (msg) setAviso("Assinaturas salvas no contrato.");
    router.refresh();
    return true;
  };

  const gerar = async (doc: "boletim" | "desembolso", formato: "pdf" | "xlsx") => {
    setErro(null);
    setAviso(null);
    if (comNome.length < MIN_FISCAIS) return setErro(`Informe no mínimo ${MIN_FISCAIS} fiscais (nome) para gerar o documento.`);
    setGerando(`${doc}-${formato}`);
    try {
      if (!(await salvarAssinaturas(false))) return;
      const r = doc === "boletim" ? await acaoDadosBoletim(contratoId, medicaoId) : await acaoDadosDesembolso(contratoId, numero);
      if (!r.ok) return setErro(r.erro);
      const op: OpcoesDocumentoMedicao = {
        empenho: campos.empenho, nota: campos.nota, rodape: r.dados.rodape,
        fiscais: comNome, empresa,
      };
      const base = nomeArquivo(doc === "boletim" ? `Boletim_medicao_${numero}_contrato_${contratoNumero}` : `Cronograma_desembolso_medicao_${numero}_contrato_${contratoNumero}`);
      if (formato === "pdf") {
        const { definicaoBoletim, definicaoDesembolso } = await import("@/lib/relatorios/medicao-pdf");
        const def = "boletim" in r.dados ? definicaoBoletim(r.dados.boletim, op) : definicaoDesembolso(r.dados.desembolso, op);
        baixar(await pdf(def), `${base}.pdf`);
      } else {
        const [{ default: ExcelJS }, { gerarBoletimXlsx, gerarDesembolsoXlsx }] = await Promise.all([import("exceljs"), import("@/lib/relatorios/medicao-xlsx")]);
        const buf = "boletim" in r.dados ? await gerarBoletimXlsx(ExcelJS, r.dados.boletim, op) : await gerarDesembolsoXlsx(ExcelJS, r.dados.desembolso, op);
        baixar(new Blob([buf], { type: XLSX }), `${base}.xlsx`);
      }
    } catch (e) {
      console.error(e);
      setErro("Não foi possível gerar o arquivo.");
    } finally {
      setGerando(null);
    }
  };

  const entrada = (rotulo: string, valor: string, mudar: (v: string) => void, largura = "w-56", placeholder?: string, travado = !podeEditar) => (
    <label className="flex flex-col gap-1 text-sm">
      <span>{rotulo}</span>
      <input value={valor} placeholder={placeholder} readOnly={travado} onChange={(e) => mudar(e.target.value)}
        className={`${largura} rounded-md border border-slate-300 px-2 py-1.5`} />
    </label>
  );
  const botao = (doc: "boletim" | "desembolso", formato: "pdf" | "xlsx", texto: string) => (
    <button disabled={!!gerando} onClick={() => gerar(doc, formato)} className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${formato === "pdf" ? "bg-marca-600 text-white" : "border border-slate-300"}`}>
      {gerando === `${doc}-${formato}` ? "Gerando…" : texto}
    </button>
  );

  return (
    <section aria-label="Documentos da medição" className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="font-semibold">Documentos da medição</h2>
      {entrada("Nº do empenho (opcional)", campos.empenho, (v) => alterar("empenho", v), "w-40", undefined, false)}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Fiscais do contrato <span className="font-normal text-slate-500">(mínimo {MIN_FISCAIS}, máximo {MAX_FISCAIS})</span></legend>
        {fiscais.map((f, i) => (
          <div key={i} className="flex flex-wrap items-end gap-3">
            {entrada(`Fiscal ${i + 1} — nome${i < MIN_FISCAIS ? " *" : " (opcional)"}`, f.nome, (v) => alterarFiscal(i, "nome", v), "w-64")}
            {entrada(`Fiscal ${i + 1} — cargo / matrícula / registro`, f.cargo, (v) => alterarFiscal(i, "cargo", v), "w-80", "Ex.: Engenheiro Civil — Mat. 43.064 — CREA 144841")}
          </div>
        ))}
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Empresa contratada <span className="font-normal text-slate-500">(assinatura do responsável técnico)</span></legend>
        <div className="flex flex-wrap items-end gap-3">
          {entrada("Empresa — nome *", empresa.nome, (v) => alterarEmpresa("nome", v), "w-72")}
          {entrada("CNPJ", empresa.cnpj, (v) => alterarEmpresa("cnpj", v), "w-48", "00.000.000/0000-00")}
          {entrada("Responsável técnico *", empresa.responsavel, (v) => alterarEmpresa("responsavel", v), "w-64")}
          {entrada("Registro / ART", empresa.registro, (v) => alterarEmpresa("registro", v), "w-72", "Ex.: CREA 2012345678/RJ — ART RJ2026...")}
        </div>
      </fieldset>
      {podeEditar && (
        <div className="flex items-center gap-3 text-sm">
          <button disabled={salvas || !!gerando} onClick={async () => { setErro(null); setAviso(null); await salvarAssinaturas(); }}
            className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-50">Salvar assinaturas</button>
          <span className="text-xs text-slate-500">{salvas ? "As assinaturas ficam gravadas no contrato e valem para todas as medições." : "Alterações não salvas (são salvas também ao gerar um documento)."}</span>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {botao("boletim", "pdf", "Boletim de medição (PDF)")}
        {botao("boletim", "xlsx", "Boletim (Excel)")}
      </div>
      <div className="space-y-2 border-t border-slate-100 pt-3">
        <label className="flex flex-col gap-1 text-sm">
          <span>Nota no pé do cronograma de desembolso (opcional)</span>
          <textarea value={campos.nota} onChange={(e) => alterar("nota", e.target.value)} rows={2} maxLength={600} className="w-full rounded-md border border-slate-300 px-2 py-1.5" />
        </label>
        {!campos.nota && <button onClick={() => alterar("nota", NOTA_MODELO)} className="text-xs text-marca-700 underline">Usar a nota do modelo (limite de 90% dos pagamentos)</button>}
        <div className="flex flex-wrap items-center gap-2">
          {botao("desembolso", "pdf", "Cronograma de desembolso (PDF)")}
          {botao("desembolso", "xlsx", "Cronograma (Excel)")}
          <Link href={`/contratos/${contratoId}/medicoes/desembolso`} className="text-sm text-marca-700 underline">Ajustar o previsto dos próximos períodos</Link>
        </div>
        <p className="text-xs text-slate-500">O cronograma traz o realizado até esta medição e o previsto para os períodos seguintes (ajustado para cada etapa fechar 100%).</p>
      </div>
      {erro && <p role="alert" className="rounded-md bg-red-50 p-2 text-sm text-red-800">{erro}</p>}
      {aviso && <p role="status" className="rounded-md bg-green-50 p-2 text-sm text-green-800">{aviso}</p>}
    </section>
  );
}
