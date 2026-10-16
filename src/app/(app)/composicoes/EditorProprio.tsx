"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { acaoBuscarComponentes, acaoSalvarComposicao, acaoSalvarInsumo } from "./acoes";

interface Componente { itemId: string; fonte: string; tipo: string; codigo: string; descricao: string; unidade: string | null; coeficiente: string }
type Achado = Omit<Componente, "coeficiente">;

export interface DadosEditor {
  tipo: "INSUMO" | "COMPOSICAO";
  itemId: string | null;
  versao: number | null;
  codigo: string;
  descricao: string;
  unidade: string;
  componentes: Componente[];
}

export function EditorProprio({ inicial }: { inicial: DadosEditor }) {
  const [d, setD] = useState(inicial);
  const [busca, setBusca] = useState("");
  const [achados, setAchados] = useState<Achado[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();
  const tempo = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (tempo.current) clearTimeout(tempo.current);
    if (busca.trim().length < 2) { setAchados([]); return; }
    tempo.current = setTimeout(async () => {
      const r = await acaoBuscarComponentes(busca);
      if (r.ok) setAchados(r.dados.filter((a) => a.itemId !== d.itemId));
    }, 300);
  }, [busca, d.itemId]);

  const adicionar = (a: Achado) => {
    if (d.componentes.some((c) => c.itemId === a.itemId)) return setErro(`${a.codigo} já está na composição.`);
    setErro(null);
    setD({ ...d, componentes: [...d.componentes, { ...a, coeficiente: "" }] });
    setBusca("");
    setAchados([]);
  };
  const mover = (i: number, delta: number) => {
    const c = [...d.componentes];
    const j = i + delta;
    if (j < 0 || j >= c.length) return;
    [c[i], c[j]] = [c[j], c[i]];
    setD({ ...d, componentes: c });
  };

  const salvar = () => iniciar(async () => {
    setErro(null);
    const base = { itemId: d.itemId, versaoEsperada: d.versao, codigo: d.codigo, descricao: d.descricao, unidade: d.unidade };
    const r = d.tipo === "COMPOSICAO"
      ? await acaoSalvarComposicao({ ...base, observacao: null, componentes: d.componentes.map((c) => ({ itemId: c.itemId, coeficiente: c.coeficiente })) })
      : await acaoSalvarInsumo(base);
    if (!r.ok) return setErro(r.erro);
    router.push(`/consulta/item/${r.dados}`);
  });

  const campo = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
  return (
    <div className="space-y-4">
      <section className="grid gap-3 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-[12rem_1fr_8rem]">
        <label className="text-sm">Código<input value={d.codigo} onChange={(e) => setD({ ...d, codigo: e.target.value })} className={campo} placeholder="ex.: P-001" /></label>
        <label className="text-sm">Descrição<input value={d.descricao} onChange={(e) => setD({ ...d, descricao: e.target.value })} className={campo} /></label>
        <label className="text-sm">Unidade<input value={d.unidade} onChange={(e) => setD({ ...d, unidade: e.target.value })} className={campo} placeholder="M2, UN, H..." /></label>
      </section>

      {d.tipo === "COMPOSICAO" && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-medium">Componentes</h2>
          <div className="relative">
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar insumo ou composição (SINAPI, EMOP ou própria) por código ou descrição"
              aria-label="Buscar componente" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            {achados.length > 0 && (
              <ul className="absolute z-10 mt-1 max-h-80 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-lg" role="listbox">
                {achados.map((a) => (
                  <li key={a.itemId}>
                    <button type="button" role="option" aria-selected="false" onClick={() => adicionar(a)} className="w-full px-3 py-2 text-left text-sm hover:bg-marca-50">
                      <span className="mr-2 text-xs font-medium text-slate-500">{a.fonte === "PROPRIA" ? "PRÓPRIA" : a.fonte}</span>
                      <span className="font-mono">{a.codigo}</span> — {a.descricao} <span className="text-slate-500">({a.unidade ?? "s/ unid."})</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {d.componentes.length === 0 ? <p className="text-sm text-slate-500">Nenhum componente.</p> : (
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500"><tr><th className="py-1">#</th><th>Fonte</th><th>Código</th><th>Descrição</th><th>Unid.</th><th>Coeficiente</th><th /></tr></thead>
              <tbody>
                {d.componentes.map((c, i) => (
                  <tr key={c.itemId} className="border-t border-slate-100">
                    <td className="py-1">{i + 1}</td>
                    <td className="text-xs">{c.fonte === "PROPRIA" ? "PRÓPRIA" : c.fonte}</td>
                    <td className="font-mono">{c.codigo}</td>
                    <td>{c.descricao}</td>
                    <td>{c.unidade ?? "—"}</td>
                    <td>
                      <input value={c.coeficiente} inputMode="decimal" aria-label={`Coeficiente de ${c.codigo}`} placeholder="0,0000"
                        onChange={(e) => setD({ ...d, componentes: d.componentes.map((x, j) => (j === i ? { ...x, coeficiente: e.target.value } : x)) })}
                        className="w-32 rounded border border-slate-300 px-2 py-1 text-right" />
                    </td>
                    <td className="whitespace-nowrap">
                      <button type="button" onClick={() => mover(i, -1)} className="px-1 text-slate-500" aria-label="Subir">↑</button>
                      <button type="button" onClick={() => mover(i, 1)} className="px-1 text-slate-500" aria-label="Descer">↓</button>
                      <button type="button" onClick={() => setD({ ...d, componentes: d.componentes.filter((_, j) => j !== i) })} className="ml-2 text-xs text-red-700 underline">remover</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-xs text-slate-500">O custo é calculado a partir dos preços da base e regime escolhidos na consulta/orçamento. Composições próprias aparecem sempre como “PRÓPRIA — não oficial”.</p>
        </section>
      )}

      {erro && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{erro}</p>}
      <div className="flex gap-3">
        <button type="button" onClick={salvar} disabled={pendente} className="rounded-md bg-marca-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {pendente ? "Salvando…" : d.itemId ? "Salvar nova versão" : "Salvar"}
        </button>
        <button type="button" onClick={() => router.back()} className="rounded-md border border-slate-300 px-4 py-2 text-sm">Cancelar</button>
      </div>
    </div>
  );
}
