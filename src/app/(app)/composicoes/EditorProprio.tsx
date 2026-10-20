"use client";

import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import { formatarNumero } from "@/lib/calculo/decimal";
import { avaliarMemoria } from "@/lib/calculo/expressao";
import { acaoBuscarComponentes, acaoSalvarComposicao, acaoSalvarInsumo } from "./acoes";

interface Componente { itemId: string; fonte: string; tipo: string; codigo: string; descricao: string; unidade: string | null; coeficiente: string; memoria: string }
type Achado = Omit<Componente, "coeficiente" | "memoria">;

/**
 * Coeficiente a partir da memória de cálculo (ex.: "1 h / 30 m² = 0,0333").
 * Mesmo padrão da memória do quantitativo do orçamento; o coeficiente continua
 * editável à mão (a memória pode ser só texto).
 */
export function coeficienteDaMemoria(texto: string): { coeficiente: string | null; aviso: string | null; erro: string | null } {
  try {
    const r = avaliarMemoria(texto);
    if (!r) return { coeficiente: null, aviso: null, erro: null };
    if (!r.valor.gt(0)) return { coeficiente: null, aviso: null, erro: "O resultado da conta precisa ser maior que zero." };
    // resultado escrito após "=" que é o calculado arredondado (ex.: 1 ÷ 30 = 0,0333) prevalece: é o coeficiente adotado
    if (r.escrito?.gt(0) && r.valor.toDecimalPlaces(r.escrito.decimalPlaces()).eq(r.escrito)) {
      return { coeficiente: formatarNumero(r.escrito, r.escrito.decimalPlaces()), aviso: r.escrito.eq(r.valor) ? null : "adotado o resultado escrito (calculado arredondado)", erro: null };
    }
    const c = r.valor.toDecimalPlaces(10);
    const avisos: string[] = [];
    if (!c.eq(r.valor)) avisos.push("resultado arredondado para 10 casas decimais");
    if (r.escrito && !r.escrito.eq(r.valor)) avisos.push(`o resultado escrito após "=" (${formatarNumero(r.escrito, Math.min(r.escrito.decimalPlaces(), 10))}) difere do calculado`);
    return { coeficiente: formatarNumero(c, c.decimalPlaces()), aviso: avisos.length ? avisos.join("; ") : null, erro: null };
  } catch (e) {
    return { coeficiente: null, aviso: null, erro: `Não foi possível calcular a conta: ${(e as Error).message}` };
  }
}

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
    setD({ ...d, componentes: [...d.componentes, { ...a, coeficiente: "", memoria: "" }] });
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

  const alterar = (i: number, m: Partial<Componente>) => setD({ ...d, componentes: d.componentes.map((x, j) => (j === i ? { ...x, ...m } : x)) });
  const alterarMemoria = (i: number, memoria: string) => {
    const r = coeficienteDaMemoria(memoria);
    alterar(i, r.coeficiente ? { memoria, coeficiente: r.coeficiente } : { memoria });
  };

  const salvar = () => iniciar(async () => {
    setErro(null);
    const base = { itemId: d.itemId, versaoEsperada: d.versao, codigo: d.codigo, descricao: d.descricao, unidade: d.unidade };
    const r = d.tipo === "COMPOSICAO"
      ? await acaoSalvarComposicao({ ...base, observacao: null, componentes: d.componentes.map((c) => ({ itemId: c.itemId, coeficiente: c.coeficiente, memoria: c.memoria.trim() || null })) })
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
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar insumo ou composição (SINAPI, EMOP, SICRO, SCO ou própria) por código ou descrição"
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
                {d.componentes.map((c, i) => {
                  const calc = coeficienteDaMemoria(c.memoria);
                  return (
                    <Fragment key={c.itemId}>
                      <tr className="border-t border-slate-100">
                        <td className="py-1">{i + 1}</td>
                        <td className="text-xs">{c.fonte === "PROPRIA" ? "PRÓPRIA" : c.fonte}</td>
                        <td className="font-mono">{c.codigo}</td>
                        <td>{c.descricao}</td>
                        <td>{c.unidade ?? "—"}</td>
                        <td>
                          <input value={c.coeficiente} inputMode="decimal" aria-label={`Coeficiente de ${c.codigo}`} placeholder="0,0000"
                            onChange={(e) => alterar(i, { coeficiente: e.target.value })}
                            className="w-32 rounded border border-slate-300 px-2 py-1 text-right" />
                        </td>
                        <td className="whitespace-nowrap">
                          <button type="button" onClick={() => mover(i, -1)} className="px-1 text-slate-500" aria-label="Subir">↑</button>
                          <button type="button" onClick={() => mover(i, 1)} className="px-1 text-slate-500" aria-label="Descer">↓</button>
                          <button type="button" onClick={() => setD({ ...d, componentes: d.componentes.filter((_, j) => j !== i) })} className="ml-2 text-xs text-red-700 underline">remover</button>
                        </td>
                      </tr>
                      <tr>
                        <td />
                        <td colSpan={6} className="pb-2">
                          <label className="flex flex-col gap-1 text-xs text-slate-600">
                            Memória de cálculo
                            <textarea value={c.memoria} rows={1} maxLength={2000} aria-label={`Memória de cálculo de ${c.codigo}`}
                              onChange={(e) => alterarMemoria(i, e.target.value)}
                              placeholder="Ex.: 8 h ÷ 240 m² (produção diária) = 0,0333 — a conta preenche o coeficiente; texto livre também é aceito"
                              className="w-full rounded border border-slate-300 px-2 py-1 text-sm" />
                          </label>
                          {calc.erro ? <span role="alert" className="text-xs text-red-700">{calc.erro}</span>
                            : calc.coeficiente ? (
                              <span className="text-xs">
                                <span className="font-medium text-green-800">Resultado: {calc.coeficiente}</span> <span className="text-slate-500">(usado como coeficiente)</span>
                                {calc.aviso && <span className="block text-amber-800">⚠ {calc.aviso}</span>}
                              </span>
                            ) : null}
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
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
