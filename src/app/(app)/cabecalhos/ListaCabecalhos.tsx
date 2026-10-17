"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Cabecalho } from "@/lib/relatorios/cabecalhos";
import { acaoArquivarCabecalho, acaoSalvarCabecalho } from "./acoes";

const MAX_LINHAS = 6;
const MAX_BYTES = 512 * 1024;
const campo = "w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm";

function Previa({ linhas, logo }: { linhas: string[]; logo: string | null }) {
  const ls = linhas.filter((l) => l.trim());
  if (!ls.length && !logo) return <p className="text-sm text-slate-500">Sem conteúdo.</p>;
  return (
    <div className="flex items-center gap-3 border-b-2 border-marca-700 pb-2" aria-label="Prévia do cabeçalho">
      {/* eslint-disable-next-line @next/next/no-img-element -- prévia local (data URL) */}
      {logo && <img src={logo} alt="Logo" className="h-16 w-16 object-contain" />}
      <div className="text-sm font-semibold leading-snug">{ls.map((l, i) => <p key={i}>{l}</p>)}</div>
    </div>
  );
}

interface Rascunho { id: string | null; nome: string; linhas: string[]; logo: string | null; logoAlterado: boolean; padrao: boolean }

function Editor({ inicial, aoFechar }: { inicial: Rascunho; aoFechar: () => void }) {
  const [r, setR] = useState(inicial);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  const escolherLogo = (arquivo: File | undefined) => {
    setErro(null);
    if (!arquivo) return;
    if (!["image/png", "image/jpeg"].includes(arquivo.type)) return setErro("Escolha uma imagem PNG ou JPEG.");
    if (arquivo.size > MAX_BYTES) return setErro("A imagem do logo deve ter no máximo 512 KB.");
    const leitor = new FileReader();
    leitor.onload = () => setR({ ...r, logo: String(leitor.result), logoAlterado: true });
    leitor.readAsDataURL(arquivo);
  };

  const salvar = () => iniciar(async () => {
    setErro(null);
    const logo = !r.logoAlterado ? undefined : r.logo ? { tipo: r.logo.slice(5, r.logo.indexOf(";")), base64: r.logo.slice(r.logo.indexOf(",") + 1) } : null;
    const res = await acaoSalvarCabecalho({ id: r.id, nome: r.nome, linhas: r.linhas.filter((l) => l.trim()), logo, padrao: r.padrao });
    if (!res.ok) return setErro(res.erro);
    aoFechar();
    router.refresh();
  });

  return (
    <section className="space-y-3 rounded-xl border border-marca-200 bg-white p-5">
      <h2 className="font-medium">{r.id ? "Editar cabeçalho" : "Novo cabeçalho"}</h2>
      <label className="block text-sm">Nome (para identificar)
        <input value={r.nome} onChange={(e) => setR({ ...r, nome: e.target.value })} maxLength={120} className={campo} placeholder="Ex.: Prefeitura de Macaé — SEMINF" />
      </label>
      <fieldset className="space-y-1.5">
        <legend className="text-sm">Linhas de texto (até {MAX_LINHAS})</legend>
        {r.linhas.map((l, i) => (
          <div key={i} className="flex gap-2">
            <input value={l} aria-label={`Linha ${i + 1}`} maxLength={150} onChange={(e) => setR({ ...r, linhas: r.linhas.map((x, j) => (j === i ? e.target.value : x)) })} className={campo} />
            <button type="button" aria-label={`Remover linha ${i + 1}`} onClick={() => setR({ ...r, linhas: r.linhas.filter((_, j) => j !== i) })} className="px-2 text-red-700">✕</button>
          </div>
        ))}
        {r.linhas.length < MAX_LINHAS && <button type="button" onClick={() => setR({ ...r, linhas: [...r.linhas, ""] })} className="text-sm text-marca-700 underline">+ linha</button>}
      </fieldset>
      <div className="space-y-1 text-sm">
        <label className="block">Logo (PNG ou JPEG, até 512 KB)
          <input type="file" accept="image/png,image/jpeg" aria-label="Arquivo do logo" onChange={(e) => escolherLogo(e.target.files?.[0])} className="mt-1 block text-sm" />
        </label>
        {r.logo && <button type="button" onClick={() => setR({ ...r, logo: null, logoAlterado: true })} className="text-red-700 underline">Remover logo</button>}
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={r.padrao} onChange={(e) => setR({ ...r, padrao: e.target.checked })} /> Cabeçalho padrão (usado nas obras sem cabeçalho escolhido)</label>
      <div className="rounded-md bg-slate-50 p-3"><p className="mb-2 text-xs text-slate-500">Prévia</p><Previa linhas={r.linhas} logo={r.logo} /></div>
      {erro && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{erro}</p>}
      <div className="flex gap-2">
        <button onClick={salvar} disabled={pendente} className="rounded-md bg-marca-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{pendente ? "Salvando…" : "Salvar cabeçalho"}</button>
        <button onClick={aoFechar} disabled={pendente} className="rounded-md border border-slate-300 px-4 py-2 text-sm">Cancelar</button>
      </div>
    </section>
  );
}

export function ListaCabecalhos({ lista, podeEditar }: { lista: Cabecalho[]; podeEditar: boolean }) {
  const [editando, setEditando] = useState<Rascunho | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();
  const logo = (c: Cabecalho) => (c.logoTipo && c.logoBase64 ? `data:${c.logoTipo};base64,${c.logoBase64}` : null);

  return (
    <div className="space-y-4">
      {podeEditar && !editando && (
        <button onClick={() => setEditando({ id: null, nome: "", linhas: ["", "", "", ""], logo: null, logoAlterado: false, padrao: lista.length === 0 })}
          className="rounded-md bg-marca-600 px-4 py-2 text-sm font-medium text-white">Novo cabeçalho</button>
      )}
      {editando && <Editor inicial={editando} aoFechar={() => setEditando(null)} />}
      {erro && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{erro}</p>}
      {lista.length === 0 && !editando && <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">Nenhum cabeçalho cadastrado: os relatórios saem sem timbre.</p>}
      {lista.map((c) => (
        <section key={c.id} className={`space-y-3 rounded-xl border bg-white p-5 ${c.ativo ? "border-slate-200" : "border-dashed border-slate-300 opacity-70"}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">
              {c.nome}
              {c.padrao && <span className="ml-2 rounded bg-green-100 px-2 py-0.5 text-xs text-green-800">padrão</span>}
              {!c.ativo && <span className="ml-2 rounded bg-slate-200 px-2 py-0.5 text-xs">arquivado</span>}
            </h2>
            <span className="text-xs text-slate-500">{c.obras === 1 ? "1 obra" : `${c.obras} obras`} usando</span>
          </div>
          <Previa linhas={c.linhas} logo={logo(c)} />
          {podeEditar && (
            <div className="flex gap-2 text-sm">
              <button onClick={() => setEditando({ id: c.id, nome: c.nome, linhas: c.linhas, logo: logo(c), logoAlterado: false, padrao: c.padrao })} className="rounded-md border border-slate-300 px-3 py-1" aria-label={`Editar ${c.nome}`}>Editar</button>
              <button disabled={pendente} onClick={() => iniciar(async () => { setErro(null); const r = await acaoArquivarCabecalho(c.id, !c.ativo); if (!r.ok) setErro(r.erro); router.refresh(); })} className="rounded-md border border-slate-300 px-3 py-1">
                {c.ativo ? "Arquivar" : "Reativar"}
              </button>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
