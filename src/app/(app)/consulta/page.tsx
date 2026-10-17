import Link from "next/link";
import { exigirUsuario } from "@/lib/auth/sessao";
import { executor } from "@/lib/banco/servidor";
import { rotuloBase } from "@/lib/referencia/bases";
import { buscarItens } from "@/lib/referencia/busca";
import { parametrosSelecao, selecaoDeBases } from "@/lib/referencia/contexto-tela";
import { formatarPreco, nomeRegime } from "@/lib/formato/precos";
import { SeloFonte } from "@/components/SeloFonte";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default async function Consulta({ searchParams }: { searchParams: Promise<SP> }) {
  const u = await exigirUsuario();
  const sp = await searchParams;
  const ex = await executor();
  const sel = await selecaoDeBases(ex, u, sp);
  const q = str(sp.q).slice(0, 120);
  const tipo = str(sp.tipo) === "INSUMO" || str(sp.tipo) === "COMPOSICAO" ? (str(sp.tipo) as "INSUMO" | "COMPOSICAO") : null;
  const fonte = str(sp.fonte);
  const pagina = Math.max(1, Number(str(sp.pag)) || 1);
  const incluirProprios = !fonte || fonte === "PROPRIA";
  const revisoes = sel.filter((s) => !fonte || s.fonte === fonte).map((s) => s.base.revisaoId);
  const LIMITE = 50;
  // "Buscar" com o campo vazio lista todos os itens das bases selecionadas
  const buscou = typeof sp.q === "string";
  const valida = buscou && (q.trim().length === 0 || q.trim().length >= 2);
  const r = valida ? await buscarItens(ex, { texto: q, revisoes, incluirProprios, tipo, limite: LIMITE, pagina }) : { itens: [], total: 0 };
  const ctxUrl = parametrosSelecao(sel);
  const urlPagina = (n: number) => {
    const p = new URLSearchParams(ctxUrl);
    p.set("q", q);
    if (tipo) p.set("tipo", tipo);
    if (fonte) p.set("fonte", fonte);
    p.set("pag", String(n));
    return `/consulta?${p}`;
  };

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Consulta de preços e composições</h1>
      <form className="space-y-3 rounded-xl border border-slate-200 bg-white p-5" role="search">
        <div className="flex flex-wrap gap-3">
          <input name="q" defaultValue={q} placeholder="Código (ex.: 01.001.0001, 104658, 00001) ou palavras da descrição — vazio lista todos" aria-label="Buscar"
            className="min-w-[18rem] flex-1 rounded-md border border-slate-300 px-3 py-2" autoFocus />
          <select name="fonte" defaultValue={fonte} aria-label="Fonte" className="rounded-md border border-slate-300 px-2 py-2 text-sm">
            <option value="">Todas as fontes</option>
            {sel.map((s) => <option key={s.fonte} value={s.fonte}>{s.fonte}</option>)}
            <option value="PROPRIA">Próprias</option>
          </select>
          <select name="tipo" defaultValue={tipo ?? ""} aria-label="Tipo" className="rounded-md border border-slate-300 px-2 py-2 text-sm">
            <option value="">Insumos e composições</option>
            <option value="INSUMO">Somente insumos</option>
            <option value="COMPOSICAO">Somente composições/serviços</option>
          </select>
          <button className="rounded-md bg-marca-600 px-4 py-2 text-sm font-medium text-white hover:bg-marca-700">Buscar</button>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          {sel.map((s) => (
            <fieldset key={s.fonte} className="flex flex-wrap items-center gap-2">
              <legend className="sr-only">Base {s.fonte}</legend>
              <span className="font-medium">{s.fonte}:</span>
              <select name={`b_${s.fonte}`} defaultValue={s.base.revisaoId} aria-label={`Competência ${s.fonte}`} className="rounded border border-slate-300 px-2 py-1">
                {s.opcoes.map((b) => <option key={b.revisaoId} value={b.revisaoId}>{rotuloBase(b)}{b.status === "SUBSTITUIDA" ? " (substituída)" : ""}</option>)}
              </select>
              <select name={`r_${s.fonte}`} defaultValue={s.regime ?? ""} aria-label={`Regime ${s.fonte}`} className="rounded border border-slate-300 px-2 py-1">
                {s.base.regimes.map((g) => <option key={g.codigo} value={g.codigo}>{g.nome}</option>)}
              </select>
            </fieldset>
          ))}
          {sel.length === 0 && <span className="text-slate-500">Nenhuma base publicada. Somente itens próprios podem ser consultados.</span>}
        </div>
        {sel.some((s) => !s.base.publicada) && (
          <p className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-900">Há base NÃO PUBLICADA selecionada (visível só para administradores, para conferência).</p>
        )}
      </form>

      {buscou && !valida && <p className="text-sm text-amber-800">Digite ao menos 2 caracteres, ou deixe o campo vazio para listar todos os itens.</p>}
      {valida && (
        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-5">
          <p className="mb-3 text-sm text-slate-500">{r.total.toLocaleString("pt-BR")} resultado(s){r.total > LIMITE ? ` — página ${pagina} de ${Math.ceil(r.total / LIMITE)}` : ""}</p>
          {r.itens.length > 0 && (
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr><th className="py-1">Fonte</th><th>Código</th><th>Descrição</th><th>Unid.</th><th>Preço na base selecionada</th><th /></tr>
              </thead>
              <tbody>
                {r.itens.map((i) => {
                  const regimeSel = sel.find((s) => s.fonte === i.fonte)?.regime ?? "";
                  // item publicado em um único regime (ex.: EMOP, regime embutido no código): mostra esse preço, identificado
                  const unicos = Object.keys(i.precos);
                  const regimeMostrado = i.precos[regimeSel] ? regimeSel : i.precos[""] ? "" : unicos.length === 1 ? unicos[0] : regimeSel;
                  const precoSel = i.precos[regimeMostrado];
                  return (
                    <tr key={i.itemId} className="border-t border-slate-100 align-top">
                      <td className="py-2"><SeloFonte fonte={i.fonte} /></td>
                      <td className="whitespace-nowrap font-mono">
                        <Link className="text-marca-700 hover:underline" href={`/consulta/item/${i.itemId}?${ctxUrl}`}>{i.codigo}</Link>
                      </td>
                      <td>{i.descricao}<div className="text-xs text-slate-500">{i.tipo === "INSUMO" ? "Insumo" : "Composição"}{i.grupo ? ` · ${i.grupo}` : ""}{i.temAnalitica ? " · com analítica" : ""}</div></td>
                      <td>{i.unidade ?? <em className="text-amber-700">não publicada</em>}</td>
                      <td className="whitespace-nowrap">
                        {i.fonte === "PROPRIA" ? <span className="text-xs text-slate-500">ver detalhe</span> : (
                          <>
                            <div className="num font-medium">{precoSel ? formatarPreco(precoSel) : <em className="text-amber-700">sem preço</em>}</div>
                            <div className={`text-xs ${regimeMostrado !== regimeSel && regimeMostrado !== "" ? "text-amber-700" : "text-slate-500"}`}>{precoSel ? nomeRegime(regimeMostrado) : ""}</div>
                          </>
                        )}
                      </td>
                      <td><Link className="text-xs text-marca-700 underline" href={`/consulta/item/${i.itemId}?${ctxUrl}`}>Detalhes</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {r.total > LIMITE && (
            <nav className="mt-3 flex flex-wrap items-center gap-3 text-sm" aria-label="Páginas">
              {pagina > 1 && <Link className="text-marca-700 underline" href={urlPagina(1)}>« Primeira</Link>}
              {pagina > 1 && <Link className="text-marca-700 underline" href={urlPagina(pagina - 1)}>← Anterior</Link>}
              <span className="text-slate-500">Página {pagina} de {Math.ceil(r.total / LIMITE)}</span>
              {pagina * LIMITE < r.total && <Link className="text-marca-700 underline" href={urlPagina(pagina + 1)}>Próxima →</Link>}
              {pagina * LIMITE < r.total && <Link className="text-marca-700 underline" href={urlPagina(Math.ceil(r.total / LIMITE))}>Última »</Link>}
              <form className="flex items-center gap-1">
                {[...new URL(`http://x${urlPagina(1)}`).searchParams.entries()].filter(([k]) => k !== "pag").map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
                <label className="text-slate-500">Ir para
                  <input name="pag" type="number" min={1} max={Math.ceil(r.total / LIMITE)} defaultValue={pagina} aria-label="Número da página" className="ml-1 w-20 rounded border border-slate-300 px-2 py-0.5" />
                </label>
                <button className="rounded border border-slate-300 px-2 py-0.5">ir</button>
              </form>
            </nav>
          )}
        </section>
      )}
    </div>
  );
}
