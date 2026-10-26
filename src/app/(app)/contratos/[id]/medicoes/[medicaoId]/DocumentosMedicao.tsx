"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { OpcoesDocumentoMedicao } from "@/lib/relatorios/medicao-pdf";
import { acaoDadosBoletim, acaoDadosDesembolso } from "../acoes";

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

interface Campos { empenho: string; nome1: string; cargo1: string; nome2: string; cargo2: string; nota: string }

export function DocumentosMedicao({ contratoId, contratoNumero, medicaoId, numero, fechadaPor, responsavelTecnico, artRrt }: {
  contratoId: string; contratoNumero: string; medicaoId: string; numero: number; fechadaPor: string | null; responsavelTecnico: string | null; artRrt: string | null;
}) {
  const chave = `documentos-medicao:${contratoId}`;
  const [campos, setCampos] = useState<Campos>({
    empenho: "", nome1: fechadaPor ?? "", cargo1: "Fiscal do contrato", nome2: responsavelTecnico ?? "",
    cargo2: `Responsável técnico da contratada${artRrt ? ` — ${artRrt}` : ""}`, nota: "",
  });
  const [gerando, setGerando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  // os campos ficam guardados no navegador, por contrato (o empenho muda pouco entre medições)
  useEffect(() => {
    try { const s = localStorage.getItem(chave); if (s) setCampos((c) => ({ ...c, ...JSON.parse(s) })); } catch { /* sem armazenamento */ }
  }, [chave]);
  const alterar = (k: keyof Campos, v: string) => setCampos((c) => {
    const novo = { ...c, [k]: v };
    try { localStorage.setItem(chave, JSON.stringify(novo)); } catch { /* sem armazenamento */ }
    return novo;
  });

  const gerar = async (doc: "boletim" | "desembolso", formato: "pdf" | "xlsx") => {
    setErro(null);
    setGerando(`${doc}-${formato}`);
    try {
      const r = doc === "boletim" ? await acaoDadosBoletim(contratoId, medicaoId) : await acaoDadosDesembolso(contratoId, numero);
      if (!r.ok) return setErro(r.erro);
      const op: OpcoesDocumentoMedicao = {
        empenho: campos.empenho, nota: campos.nota, rodape: r.dados.rodape,
        assinaturas: [{ nome: campos.nome1, cargo: campos.cargo1 }, { nome: campos.nome2, cargo: campos.cargo2 }],
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

  const campo = (k: keyof Campos, rotulo: string, largura = "w-56") => (
    <label className="flex flex-col gap-1 text-sm">
      <span>{rotulo}</span>
      <input value={campos[k]} onChange={(e) => alterar(k, e.target.value)} className={`${largura} rounded-md border border-slate-300 px-2 py-1.5`} />
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
      <div className="flex flex-wrap items-end gap-3">
        {campo("empenho", "Nº do empenho (opcional)", "w-40")}
        {campo("nome1", "Assinatura 1 — nome")}
        {campo("cargo1", "Assinatura 1 — cargo / registro")}
        {campo("nome2", "Assinatura 2 — nome")}
        {campo("cargo2", "Assinatura 2 — cargo / registro", "w-72")}
      </div>
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
    </section>
  );
}
