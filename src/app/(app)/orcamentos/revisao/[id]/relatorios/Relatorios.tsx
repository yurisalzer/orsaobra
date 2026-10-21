"use client";

import { Fragment, useState } from "react";
import { celula, colunasDaLinha, ehNumerica, formatarCelula, RELATORIOS, type Documento, type TipoRelatorio } from "@/lib/relatorios/documento";

type Formato = "tela" | "pdf" | "xlsx";

async function buscar(revisaoId: string, tipo: TipoRelatorio, outra: string | null, formato: Formato): Promise<Documento> {
  const q = new URLSearchParams({ tipo, formato, ...(outra ? { outra } : {}) });
  const r = await fetch(`/api/relatorios/${revisaoId}?${q}`, { cache: "no-store" });
  const j = await r.json().catch(() => ({ erro: "Resposta inválida do servidor." }));
  if (!r.ok) throw new Error(j.erro ?? "Não foi possível montar o relatório.");
  return j as Documento;
}

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

/** PDF gerado no navegador (pdfmake e fontes carregados só quando pedidos). */
async function gerarPdf(doc: Documento): Promise<Blob> {
  const [{ default: pdfMake }, vfs, { definicaoPdf }] = await Promise.all([
    import("pdfmake/build/pdfmake"), import("pdfmake/build/vfs_fonts"), import("@/lib/relatorios/pdf"),
  ]);
  const pm = pdfMake as unknown as { addVirtualFileSystem: (v: unknown) => void; createPdf: (d: unknown) => { getBlob: () => Promise<Blob> } };
  pm.addVirtualFileSystem((vfs as { default?: unknown }).default ?? vfs);
  return pm.createPdf(definicaoPdf(doc)).getBlob();
}

async function gerarPlanilha(doc: Documento): Promise<Blob> {
  const [{ default: ExcelJS }, { gerarXlsx }] = await Promise.all([import("exceljs"), import("@/lib/relatorios/xlsx")]);
  return new Blob([await gerarXlsx(ExcelJS, doc)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function Relatorios({ revisaoId, outras, proprias = 0 }: { revisaoId: string; outras: { id: string; numero: number }[]; proprias?: number }) {
  const [outra, setOutra] = useState<string>(outras.at(-1)?.id ?? "");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [visivel, setVisivel] = useState<Documento | null>(null);

  const executar = async (tipo: TipoRelatorio, formato: Formato) => {
    setErro(null);
    setOcupado(`${tipo}:${formato}`);
    try {
      const doc = await buscar(revisaoId, tipo, tipo === "comparativo" ? outra || null : null, formato);
      if (formato === "tela") setVisivel(doc);
      else if (formato === "pdf") baixar(await gerarPdf(doc), `${doc.nomeArquivo}.pdf`);
      else baixar(await gerarPlanilha(doc), `${doc.nomeArquivo}.xlsx`);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  return (
    <div className="space-y-4">
      {erro && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{erro}</p>}
      <ul className="grid gap-3 sm:grid-cols-2">
        {RELATORIOS.map((r) => {
          const semOutra = (r.tipo === "comparativo" && outras.length === 0) || (r.tipo === "composicoes-proprias" && proprias === 0);
          return (
            <li key={r.tipo} className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4">
              <div>
                <h2 className="font-medium">{r.nome}</h2>
                <p className="text-sm text-slate-500">{r.descricao}</p>
              </div>
              {r.tipo === "composicoes-proprias" && proprias === 0 && <p className="text-xs text-amber-800">Este orçamento não tem composições próprias.</p>}
              {r.tipo === "comparativo" && (
                semOutra ? <p className="text-xs text-amber-800">Este orçamento tem uma só revisão.</p> : (
                  <label className="text-sm">Comparar com{" "}
                    <select value={outra} onChange={(e) => setOutra(e.target.value)} aria-label="Revisão a comparar" className="rounded border border-slate-300 px-2 py-1">
                      {outras.map((o) => <option key={o.id} value={o.id}>Revisão {o.numero}</option>)}
                    </select>
                  </label>
                )
              )}
              <div className="mt-auto flex flex-wrap gap-2 text-sm">
                {(["tela", "pdf", "xlsx"] as const).map((f) => (
                  <button key={f} disabled={!!ocupado || semOutra} onClick={() => executar(r.tipo, f)} aria-label={`${f === "tela" ? "Visualizar" : f === "pdf" ? "Baixar PDF" : "Baixar Excel"} — ${r.nome}`}
                    className={`rounded-md px-3 py-1.5 disabled:opacity-50 ${f === "pdf" ? "bg-marca-600 text-white" : "border border-slate-300 hover:bg-slate-50"}`}>
                    {ocupado === `${r.tipo}:${f}` ? "Gerando…" : f === "tela" ? "Visualizar" : f === "pdf" ? "PDF" : "Excel"}
                  </button>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
      {visivel && <Visualizacao doc={visivel} aoFechar={() => setVisivel(null)} />}
    </div>
  );
}

const FUNDO: Record<string, string> = { grupo1: "bg-slate-200 font-semibold", grupo2: "bg-slate-100 font-medium", grupo3: "bg-slate-50", total: "bg-slate-300 font-semibold", subtotal: "bg-slate-100", destaque: "bg-amber-50", detalhe: "text-xs italic text-slate-600" };

function Visualizacao({ doc, aoFechar }: { doc: Documento; aoFechar: () => void }) {
  return (
    <section aria-label={`Visualização — ${doc.titulo}`} className="area-impressao space-y-3 rounded-xl border border-slate-200 bg-white p-5 print:rounded-none print:border-0 print:p-0">
      {/* impressão direto da tela: só o relatório, em A4 na orientação do relatório */}
      <style>{`@media print {
        @page { size: A4 ${doc.orientacao === "paisagem" ? "landscape" : "portrait"}; margin: 10mm; }
        html, body { background: #fff !important; }
        /* esconde tudo que não é o relatório (irmãos em cada nível até a raiz) — sem sobrar páginas em branco */
        *:has(.area-impressao) > *:not(.area-impressao):not(:has(.area-impressao)) { display: none !important; }
        *:has(.area-impressao) { margin: 0 !important; padding: 0 !important; border: 0 !important; max-width: none !important; min-height: 0 !important; background: #fff !important; box-shadow: none !important; }
        .area-impressao { font-size: 9pt; }
        .area-impressao td { overflow-wrap: anywhere; }
        .area-impressao thead { display: table-header-group; }
        .area-impressao tr { break-inside: avoid; }
        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      }`}</style>
      {doc.cabecalho && (doc.cabecalho.linhas.length > 0 || doc.cabecalho.logo) && (
        <div className="flex items-center gap-3 border-b border-marca-700 pb-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- imagem em data URL vinda do cadastro */}
          {doc.cabecalho.logo && <img src={doc.cabecalho.logo} alt="Logo" className="h-16 w-16 object-contain" />}
          <div className="text-sm font-semibold leading-snug">{doc.cabecalho.linhas.map((l) => <p key={l}>{l}</p>)}</div>
        </div>
      )}
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold uppercase text-marca-700">{doc.titulo}</h2>
        <div className="flex gap-2 print:hidden">
          <button onClick={() => window.print()} className="rounded-md border border-slate-300 px-3 py-1 text-sm">Imprimir</button>
          <button onClick={aoFechar} className="rounded-md border border-slate-300 px-3 py-1 text-sm">Fechar</button>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-x-4 gap-y-0.5 text-sm">
        {doc.identificacao.map((linha) => {
          const spans = colunasDaLinha(linha);
          return linha.map((p, i) => (
            <p key={p.rotulo} className={spans[i] === 3 ? "col-span-3" : spans[i] === 2 ? "col-span-2" : ""}><span className="font-medium">{p.rotulo}:</span> {p.valor}</p>
          ));
        })}
      </div>
      {doc.avisos.map((a) => <p key={a} className="text-sm font-medium text-amber-800">Atenção: {a}</p>)}
      {doc.secoes.map((s, i) => (
        <div key={i} className="space-y-1">
          {s.titulo && <h3 className="pt-2 font-semibold text-marca-700">{s.titulo}</h3>}
          {s.campos && (
            <dl className="grid grid-cols-[max-content_1fr] gap-x-3 text-sm">
              {s.campos.map((c) => <Fragment key={c.rotulo}><dt className="font-medium">{c.rotulo}</dt><dd>{c.valor}</dd></Fragment>)}
            </dl>
          )}
          {s.tabela && (
            <div className="overflow-x-auto print:overflow-visible">
              <table className="w-full border-collapse text-sm print:table-fixed print:text-[8pt]">
                <colgroup>{(() => { const t = s.tabela!.colunas.reduce((n, c) => n + c.largura, 0); return s.tabela!.colunas.map((c) => <col key={c.titulo} style={{ width: `${(100 * c.largura) / t}%` }} />); })()}</colgroup>
                <thead><tr>{s.tabela.colunas.map((c) => <th key={c.titulo} className={`border border-slate-300 bg-marca-700 px-1.5 py-1 text-xs font-medium text-white ${ehNumerica(c.tipo) ? "text-right" : "text-left"}`}>{c.titulo}</th>)}</tr></thead>
                <tbody>
                  {s.tabela.linhas.map((l, j) => {
                    let col = 0;
                    return (
                      <tr key={j} className={FUNDO[l.estilo ?? ""] ?? ""}>
                        {l.celulas.map((c, k) => {
                          const { valor, tipo, span } = celula(c);
                          const t = tipo ?? s.tabela!.colunas[col]?.tipo ?? "texto";
                          col += span;
                          const num = ehNumerica(t) && span === 1;
                          return <td key={k} colSpan={span} className={`border border-slate-200 px-1.5 py-0.5 align-top ${num ? "whitespace-nowrap text-right tabular-nums" : t === "codigo" ? "whitespace-nowrap font-mono text-xs print:whitespace-normal" : ""}`}>{formatarCelula(valor, t)}</td>;
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {s.paragrafos?.map((p) => <p key={p} className="text-xs text-slate-600">{p}</p>)}
        </div>
      ))}
      <p className="text-xs text-slate-500">{doc.rodape}</p>
    </section>
  );
}
