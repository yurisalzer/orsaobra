import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { SeloFonte } from "@/components/SeloFonte";
import { exigirUsuario, temPermissao } from "@/lib/auth/sessao";
import { executor } from "@/lib/banco/servidor";
import { dec } from "@/lib/calculo/decimal";
import { formatarCoeficiente, formatarPreco, nomeRegime } from "@/lib/formato/precos";
import { rotuloBase } from "@/lib/referencia/bases";
import { parametrosSelecao, selecaoDeBases } from "@/lib/referencia/contexto-tela";
import { ComposicaoSicro } from "@/components/AnaliticaSicro";
import type { AnaliticaSicro } from "@/lib/importacao/adaptadores/sicro-xlsx";
import { analiticaOficial, cabecalhoItem, historicoPrecos, linhasDaVersao, usadoEm, type LinhaAnalitica } from "@/lib/referencia/item";
import { precificar, type ContextoPreco, type PrecoItem } from "@/lib/referencia/precificacao";
import { cotacoes } from "@/lib/referencia/proprios";
import { FormCotacao } from "./FormCotacao";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const STATUS: Record<string, string> = { PUBLICADA: "Publicada", SUBSTITUIDA: "Substituída", EM_IMPORTACAO: "Não publicada", VALIDADA: "Validada (não publicada)" };

export default async function DetalheItem({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const u = await exigirUsuario("CONSULTA");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const sp = await searchParams;
  const ex = await executor();
  const sel = await selecaoDeBases(ex, u, sp);
  const ctxUrl = parametrosSelecao(sel);
  const hoje = new Date().toISOString().slice(0, 10);
  const dataRef = typeof sp.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.data) ? sp.data : hoje;
  const minhaBase = sel.find((s) => s.fonte !== "PROPRIA");
  const item = await cabecalhoItem(ex, id, minhaBase?.base.revisaoId);
  if (!item) notFound();
  const selDaFonte = sel.find((s) => s.fonte === item.fonte);

  const [historico, usado] = await Promise.all([
    historicoPrecos(ex, id, temPermissao(u, "IMPORTACAO")),
    usadoEm(ex, id, selDaFonte?.base.revisaoId ?? null),
  ]);
  // Item oficial publicado num único regime nesta base (ex.: EMOP "-0" / "-A"): usa o regime do próprio código.
  let avisoRegime: string | null = null;
  if (selDaFonte) {
    const naBase = historico.filter((h) => h.revisaoId === selDaFonte.base.revisaoId);
    const regimesDoItem = [...new Set(naBase.map((h) => h.regime))];
    if (naBase.length && !regimesDoItem.includes(selDaFonte.regime) && !regimesDoItem.includes(null) && regimesDoItem.length === 1) {
      avisoRegime = `Este código é publicado apenas no regime "${naBase[0].regimeNome}"; o preço e a analítica abaixo são desse regime.`;
      selDaFonte.regime = regimesDoItem[0];
    }
  }
  const ctx: ContextoPreco = { bases: sel.map((s) => ({ fonte: s.fonte, baseRevisaoId: s.base.revisaoId, regime: s.regime })), dataReferencia: dataRef };

  // analítica: oficial (somente se publicada pela fonte) ou própria
  let linhas: LinhaAnalitica[] | null = null;
  let tituloAnalitica = "";
  if (item.oficial && item.tipo === "COMPOSICAO" && selDaFonte) {
    const a = await analiticaOficial(ex, id, selDaFonte.base.revisaoId, selDaFonte.regime);
    if (a) { linhas = a.linhas; tituloAnalitica = `Composição analítica publicada pela fonte — ${rotuloBase(selDaFonte.base)}`; }
  } else if (item.proprio?.composicaoVersaoId) {
    linhas = await linhasDaVersao(ex, item.proprio.composicaoVersaoId, minhaBase?.base.revisaoId ?? null);
    tituloAnalitica = `Composição própria (não oficial) — versão ${item.proprio.versao}`;
  }
  // SICRO: composição publicada em formato próprio (guardada junto ao custo)
  const analiticaSicro = !linhas && item.oficial && item.tipo === "COMPOSICAO" && selDaFonte
    ? ((historico.find((h) => h.revisaoId === selDaFonte.base.revisaoId && h.atributos && "analitica_sicro" in h.atributos)?.atributos as { analitica_sicro?: AnaliticaSicro } | null)?.analitica_sicro ?? null)
    : null;
  if (analiticaSicro) tituloAnalitica = `Composição de custo unitário publicada pelo DNIT — ${rotuloBase(selDaFonte!.base)} (sem desoneração)`;
  const precos = await precificar(ex, [id, ...(linhas ?? []).map((l) => l.itemId)], ctx);
  const precoItem = precos.get(id)!;
  const listaCotacoes = item.fonte === "PROPRIA" && item.tipo === "INSUMO" ? await cotacoes(ex, id) : [];
  const podeEditar = temPermissao(u, "COMPOSICOES");

  // totais da analítica (sem arredondamentos intermediários)
  let soma = dec(0);
  let completa = true;
  const parcial = (l: LinhaAnalitica, p: PrecoItem | undefined) => {
    if (!p?.valor) { completa = false; return null; }
    const v = dec(l.coeficiente).times(p.valor).times(dec(1).plus(dec(l.percentual ?? 0).div(100)));
    soma = soma.plus(v);
    return v;
  };
  const linhasCalc = (linhas ?? []).map((l) => ({ l, p: precos.get(l.itemId), v: parcial(l, precos.get(l.itemId)) }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link href={`/consulta?${ctxUrl}`} className="text-sm text-marca-700 underline">← Voltar à consulta</Link>
        {item.fonte === "PROPRIA" && podeEditar && (
          <Link href={`/composicoes/editar/${id}`} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">Editar item próprio</Link>
        )}
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center gap-2">
          <SeloFonte fonte={item.fonte} />
          <span className="text-sm text-slate-500">{item.tipo === "INSUMO" ? "Insumo" : "Composição / serviço"}{item.oficial ? " oficial" : " próprio — não oficial"}</span>
        </div>
        <h1 className="mt-2 text-xl font-semibold"><span className="font-mono">{item.codigo}</span> — {item.descricao}</h1>
        <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="text-slate-500">Unidade</dt><dd>{item.unidade ?? <em className="text-amber-700">não publicada pela fonte</em>}</dd>
          {item.grupo && (<><dt className="text-slate-500">Grupo / classe</dt><dd>{item.grupo}</dd></>)}
          {item.atributos && Object.entries(item.atributos).filter(([, v]) => v !== null && v !== "").map(([k, v]) => (
            <Fragment key={k}><dt className="text-slate-500">{(k.charAt(0).toUpperCase() + k.slice(1)).replace(/_/g, " ")}</dt><dd>{String(v)}</dd></Fragment>
          ))}
          <dt className="text-slate-500">Preço de referência</dt>
          <dd>
            {precoItem.valor ? <strong>{formatarPreco(precoItem.valor.toFixed(4))}</strong> : <em className="text-amber-700">{precoItem.pendencia}</em>}
            {precoItem.referencia && <span className="text-slate-500"> — {precoItem.referencia}</span>}
          </dd>
        </dl>
        {avisoRegime && <p className="mt-2 rounded bg-amber-50 px-3 py-2 text-xs text-amber-900">{avisoRegime}</p>}
        <form className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-sm">
          {sel.map((s) => (
            <span key={s.fonte} className="flex items-center gap-1">
              <span className="font-medium">{s.fonte}:</span>
              <select name={`b_${s.fonte}`} defaultValue={s.base.revisaoId} aria-label={`Competência ${s.fonte}`} className="rounded border border-slate-300 px-2 py-1">
                {s.opcoes.map((b) => <option key={b.revisaoId} value={b.revisaoId}>{rotuloBase(b)}</option>)}
              </select>
              <select name={`r_${s.fonte}`} defaultValue={s.regime ?? ""} aria-label={`Regime ${s.fonte}`} className="rounded border border-slate-300 px-2 py-1">
                {s.base.regimes.map((g) => <option key={g.codigo} value={g.codigo}>{g.nome}</option>)}
              </select>
            </span>
          ))}
          <label className="flex items-center gap-1">Data p/ cotações <input type="date" name="data" defaultValue={dataRef} className="rounded border border-slate-300 px-2 py-1" /></label>
          <button className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-50">Aplicar</button>
        </form>
      </section>

      {item.tipo === "COMPOSICAO" && (
        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-medium">{linhas || analiticaSicro ? tituloAnalitica : "Composição analítica"}</h2>
          {analiticaSicro ? <ComposicaoSicro a={analiticaSicro} /> : !linhas ? (
            <p className="mt-2 text-sm text-slate-600">
              {item.oficial ? "A fonte não publicou composição analítica para este item na base/regime selecionados." : "Composição sem componentes."}
            </p>
          ) : (
            <>
              <table className="mt-3 w-full text-sm">
                <thead className="text-left text-slate-500">
                  <tr><th className="py-1">#</th><th>Fonte</th><th>Tipo</th><th>Código</th><th>Descrição</th><th>Unid.</th><th className="text-right">Coeficiente</th>{linhas.some((l) => l.percentual && Number(l.percentual)) ? <th className="text-right">% adic.</th> : null}<th className="text-right">Preço unit.</th><th className="text-right">Custo</th><th>Situação</th></tr>
                </thead>
                <tbody>
                  {linhasCalc.map(({ l, p, v }) => (
                    <tr key={l.ordem} className="border-t border-slate-100 align-top">
                      <td className="py-1">{l.ordem}</td>
                      <td><SeloFonte fonte={l.fonte} /></td>
                      <td className="text-xs">{l.tipoOriginal ?? l.tipo}</td>
                      <td className="whitespace-nowrap font-mono"><Link className="text-marca-700 hover:underline" href={`/consulta/item/${l.itemId}?${ctxUrl}`}>{l.codigo}</Link></td>
                      <td>{l.descricao}{l.memoria && <span className="mt-0.5 block whitespace-pre-wrap text-xs text-slate-500">Memória de cálculo: {l.memoria}</span>}</td>
                      <td>{l.unidade ?? "—"}</td>
                      <td className="num">{formatarCoeficiente(l.coeficiente)}</td>
                      {linhas.some((x) => x.percentual && Number(x.percentual)) ? <td className="num">{l.percentual && Number(l.percentual) ? formatarCoeficiente(l.percentual) : ""}</td> : null}
                      <td className="num whitespace-nowrap" title={p?.referencia ?? p?.pendencia ?? ""}>{p?.valor ? formatarPreco(p.valor.toFixed(4)) : l.situacao === "% sobre a mão de obra" ? <span className="text-slate-500">{formatarCoeficiente(l.coeficiente)}% s/ MO</span> : <em className="text-amber-700">sem preço</em>}</td>
                      <td className="num whitespace-nowrap">{v ? formatarPreco(v.toFixed(4)) : "—"}</td>
                      <td className="text-xs text-slate-500">{l.situacao ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[22rem_1fr]">
                <dt className="text-slate-500">{item.oficial ? "Soma da analítica (apenas conferência)" : "Custo calculado da composição própria"}</dt>
                <dd>{completa ? formatarPreco(soma.toFixed(4)) : linhas.some((l) => l.situacao === "% sobre a mão de obra") ? <em className="text-slate-600">não somada — há percentual sobre a mão de obra (a fonte não publica a base de cálculo)</em> : <em className="text-amber-700">incompleta — há componente sem preço</em>}</dd>
                {item.oficial && (<><dt className="text-slate-500">Preço publicado (valor oficial)</dt><dd><strong>{precoItem.valor ? formatarPreco(precoItem.valor.toFixed(4)) : "sem preço publicado"}</strong></dd></>)}
              </dl>
              {item.oficial && <p className="mt-2 text-xs text-slate-500">Nos orçamentos é usado o preço publicado. Pequenas diferenças na soma decorrem dos arredondamentos aplicados pela fonte.</p>}
            </>
          )}
        </section>
      )}

      {item.fonte === "PROPRIA" && item.tipo === "INSUMO" && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-medium">Cotações</h2>
          {listaCotacoes.length === 0 ? <p className="mt-2 text-sm text-slate-500">Nenhuma cotação registrada.</p> : (
            <table className="mt-2 w-full text-sm">
              <thead className="text-left text-slate-500"><tr><th className="py-1">Data</th><th className="text-right">Valor</th><th>Fonte</th><th>Observação</th></tr></thead>
              <tbody>{listaCotacoes.map((c) => (
                <tr key={c.data} className="border-t border-slate-100"><td className="py-1">{c.data.split("-").reverse().join("/")}</td><td className="num">{formatarPreco(c.valor)}</td><td>{c.fonteCotacao}</td><td>{c.observacao}</td></tr>
              ))}</tbody>
            </table>
          )}
          {podeEditar && <FormCotacao itemId={id} />}
        </section>
      )}

      {item.oficial && (
        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-medium">Histórico de preços publicados</h2>
          {historico.length === 0 ? <p className="mt-2 text-sm text-slate-500">Nenhum preço publicado para este item nas bases disponíveis.</p> : (
            <table className="mt-2 w-full text-sm">
              <thead className="text-left text-slate-500"><tr><th className="py-1">Competência</th><th>Revisão</th><th>Situação da base</th><th>Regime</th><th className="text-right">Preço</th><th>Origem / observações</th></tr></thead>
              <tbody>{historico.map((h, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="py-1">{h.competencia.split("-").reverse().join("/")}</td>
                  <td>{h.numero === 0 ? "Original" : `Retificação ${h.numero}`}</td>
                  <td>{STATUS[h.status] ?? h.status}</td>
                  <td>{h.regimeNome ?? nomeRegime(h.regime)}</td>
                  <td className="num">{formatarPreco(h.valor)}</td>
                  <td className="text-xs text-slate-500">{[h.origemPreco ? `origem ${h.origemPreco}` : null, h.atributos && (h.atributos as Record<string, string>)["%AS"] && Number((h.atributos as Record<string, string>)["%AS"]) ? `%AS ${(h.atributos as Record<string, string>)["%AS"]}` : null].filter(Boolean).join(" · ")}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </section>
      )}

      {usado.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-medium">Usado nas composições ({usado.length >= 30 ? "primeiras 30" : usado.length})</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {usado.map((x) => (
              <li key={x.itemId}><SeloFonte fonte={x.fonte} /> <Link className="font-mono text-marca-700 hover:underline" href={`/consulta/item/${x.itemId}?${ctxUrl}`}>{x.codigo}</Link> — {x.descricao} <span className="text-slate-500">(coef. {formatarCoeficiente(x.coeficiente)})</span></li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
