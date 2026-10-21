"use client";

import { useState, useTransition } from "react";
import type { CabecalhoDocumento } from "@/lib/relatorios/cabecalhos";
import type { ConteudoMemorial, MemorialParaGerar, SecaoMemorial } from "@/lib/relatorios/memorial";
import { acaoRestaurarMemorial, acaoSalvarMemorial } from "./acoes";

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

/** Dimensões do logo (para manter a proporção no .docx). */
function dimensoes(dataUrl: string): Promise<{ largura: number; altura: number }> {
  return new Promise((ok) => {
    const img = new Image();
    img.onload = () => ok({ largura: img.naturalWidth || 1, altura: img.naturalHeight || 1 });
    img.onerror = () => ok({ largura: 1, altura: 1 });
    img.src = dataUrl;
  });
}

async function gerarDocx(m: MemorialParaGerar): Promise<Blob> {
  const [lib, { gerarDocx: gerar }] = await Promise.all([import("docx"), import("@/lib/relatorios/memorial-docx")]);
  const logo = m.cabecalho?.logo ? await dimensoes(m.cabecalho.logo) : undefined;
  const r = await gerar(lib, m, { logo });
  return r instanceof Blob ? r : new Blob([r as BlobPart]);
}

async function gerarPdf(m: MemorialParaGerar): Promise<Blob> {
  const [{ default: pdfMake }, vfs, { definicaoPdfMemorial }] = await Promise.all([
    import("pdfmake/build/pdfmake"), import("pdfmake/build/vfs_fonts"), import("@/lib/relatorios/memorial-pdf"),
  ]);
  const pm = pdfMake as unknown as { addVirtualFileSystem: (v: unknown) => void; createPdf: (d: unknown) => { getBlob: () => Promise<Blob> } };
  pm.addVirtualFileSystem((vfs as { default?: unknown }).default ?? vfs);
  return pm.createPdf(definicaoPdfMemorial(m)).getBlob();
}

const NIVEL = { 1: "Seção", 2: "Subseção", 3: "Subitem" } as const;

export function EditorMemorial({ revisaoId, inicial, cabecalho, nomeArquivo, salvo, podeEditar }: {
  revisaoId: string; inicial: ConteudoMemorial; cabecalho: CabecalhoDocumento | null; nomeArquivo: string;
  salvo: { atualizadoEm: string; atualizadoPor: string | null } | null; podeEditar: boolean;
}) {
  const [c, setC] = useState(inicial);
  const [alterado, setAlterado] = useState(false);
  const [estadoSalvo, setEstadoSalvo] = useState(salvo);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  const mudar = (novo: ConteudoMemorial) => { setC(novo); setAlterado(true); };
  const secao = (i: number, m: Partial<SecaoMemorial>) => mudar({ ...c, secoes: c.secoes.map((s, j) => (j === i ? { ...s, ...m } : s)) });
  const mover = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= c.secoes.length) return;
    const s = [...c.secoes];
    [s[i], s[j]] = [s[j], s[i]];
    mudar({ ...c, secoes: s });
  };
  const inserir = (i: number) => {
    const ref = c.secoes[i];
    const id = `n${Date.now().toString(36)}`;
    const s = [...c.secoes];
    s.splice(i + 1, 0, { id, nivel: ref.nivel === 1 ? 2 : ref.nivel, titulo: "Novo título", texto: "" });
    mudar({ ...c, secoes: s });
  };
  const remover = (i: number) => {
    if (!window.confirm(`Remover a seção “${c.secoes[i].titulo}”?`)) return;
    mudar({ ...c, secoes: c.secoes.filter((_, j) => j !== i) });
  };

  const salvar = async (): Promise<boolean> => {
    setErro(null);
    const r = await acaoSalvarMemorial(revisaoId, c);
    if (!r.ok) { setErro(r.erro); return false; }
    setC(r.dados);
    setAlterado(false);
    setEstadoSalvo({ atualizadoEm: "agora", atualizadoPor: null });
    return true;
  };

  const restaurar = () => {
    if (!window.confirm("Descartar o texto editado e voltar ao texto sugerido pelo sistema?")) return;
    iniciar(async () => {
      setErro(null);
      const r = await acaoRestaurarMemorial(revisaoId);
      if (!r.ok) return setErro(r.erro);
      setC(r.dados);
      setAlterado(false);
      setEstadoSalvo(null);
    });
  };

  const gerar = async (formato: "docx" | "pdf") => {
    setErro(null);
    setOcupado(formato);
    try {
      if (podeEditar && alterado && !(await salvar())) return;
      const m: MemorialParaGerar = { ...c, cabecalho, nomeArquivo };
      const blob = formato === "docx" ? await gerarDocx(m) : await gerarPdf(m);
      baixar(blob, `${nomeArquivo}.${formato}`);
    } catch (e) {
      setErro(`Não foi possível gerar o arquivo: ${(e as Error).message}`);
    } finally {
      setOcupado(null);
    }
  };

  const pendencias = c.secoes.filter((s) => /\[[^\]]+\]/.test(s.texto)).map((s) => s.titulo);
  const campo = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50";

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur">
        <button onClick={() => gerar("docx")} disabled={!!ocupado || pendente} className="rounded-md bg-marca-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          {ocupado === "docx" ? "Gerando…" : "Gerar .docx"}
        </button>
        <button onClick={() => gerar("pdf")} disabled={!!ocupado || pendente} className="rounded-md bg-marca-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          {ocupado === "pdf" ? "Gerando…" : "Gerar PDF"}
        </button>
        {podeEditar && (
          <>
            <button onClick={() => iniciar(async () => { await salvar(); })} disabled={!alterado || pendente || !!ocupado} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50">
              {pendente ? "Salvando…" : "Salvar texto"}
            </button>
            <button onClick={restaurar} disabled={pendente || !!ocupado} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50">Restaurar texto sugerido</button>
          </>
        )}
        <span className="text-xs text-slate-500">
          {alterado ? "Alterações não salvas." : estadoSalvo ? `Texto editado salvo${estadoSalvo.atualizadoEm !== "agora" ? ` em ${estadoSalvo.atualizadoEm}${estadoSalvo.atualizadoPor ? ` por ${estadoSalvo.atualizadoPor}` : ""}` : ""}.` : "Texto sugerido pelo sistema (ainda não editado)."}
        </span>
      </div>
      {erro && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{erro}</p>}
      {pendencias.length > 0 && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Complete os trechos entre colchetes [ ] antes de emitir o documento: {pendencias.join("; ")}.
        </p>
      )}

      <section className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-[14rem_1fr]">
        <label className="text-sm">Data (cabeçalho)<input value={c.data} disabled={!podeEditar} onChange={(e) => mudar({ ...c, data: e.target.value })} className={`mt-1 ${campo}`} /></label>
        <label className="text-sm">Identificação da obra (abaixo do título)<input value={c.obra} disabled={!podeEditar} onChange={(e) => mudar({ ...c, obra: e.target.value })} className={`mt-1 ${campo}`} /></label>
      </section>

      <ol className="space-y-3">
        {c.secoes.map((s, i) => (
          <li key={s.id} className={`space-y-2 rounded-xl border border-slate-200 bg-white p-4 ${s.nivel === 2 ? "sm:ml-6" : s.nivel === 3 ? "sm:ml-12" : ""}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{NIVEL[s.nivel]}</span>
              <input value={s.titulo} disabled={!podeEditar} aria-label={`Título da seção ${i + 1}`} onChange={(e) => secao(i, { titulo: e.target.value })}
                className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm font-semibold disabled:bg-slate-50" />
              {podeEditar && (
                <span className="flex gap-1 text-sm">
                  <button onClick={() => mover(i, -1)} className="px-1 text-slate-500" aria-label={`Subir ${s.titulo}`}>↑</button>
                  <button onClick={() => mover(i, 1)} className="px-1 text-slate-500" aria-label={`Descer ${s.titulo}`}>↓</button>
                  <button onClick={() => inserir(i)} className="px-1 text-marca-700 underline">+ seção abaixo</button>
                  <button onClick={() => remover(i)} className="px-1 text-red-700 underline">remover</button>
                </span>
              )}
            </div>
            {(s.texto || s.nivel !== 1 || podeEditar) && (
              <textarea value={s.texto} disabled={!podeEditar} aria-label={`Texto de ${s.titulo}`} onChange={(e) => secao(i, { texto: e.target.value })}
                rows={Math.min(14, Math.max(2, Math.ceil(s.texto.length / 110) + s.texto.split("\n").length))}
                placeholder="Texto da seção (cada linha é um parágrafo)" className={`${campo} leading-relaxed ${s.destaque ? "font-semibold uppercase" : ""}`} />
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
