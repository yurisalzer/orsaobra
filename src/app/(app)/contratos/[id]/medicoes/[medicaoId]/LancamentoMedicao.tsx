"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import type { EstadoMedicao, LinhaMedicao } from "@/lib/medicoes/servico";
import { dataBr } from "@/lib/contratos/prazos";
import { acaoFecharMedicao, acaoIniciarMedicao, acaoReabrirMedicao, acaoSalvarLancamentos } from "../acoes";
import { ROTULO_SITUACAO } from "../PainelMedicoes";

const moeda = (v: string | number) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });
const num = (v: string | number, min = 2) => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: min, maximumFractionDigits: 4 });
/** "12.5000" → "12,5" (valor do campo) */
const paraCampo = (v: string | null) => (v === null ? "" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 4, useGrouping: false }));
const lerCampo = (v: string) => Number(v.trim().replace(/\./g, "").replace(",", "."));

const iniciais = (linhas: LinhaMedicao[], porQtd: boolean) => Object.fromEntries(linhas.map((l) => [l.itemId, paraCampo(porQtd ? l.atualQtd : l.atualPct)]));

export function LancamentoMedicao({ estado, podeEditar, podeGerenciar }: { estado: EstadoMedicao; podeEditar: boolean; podeGerenciar: boolean }) {
  const m = estado.medicao;
  const c = estado.contrato;
  const porQtd = c.medicao === "QUANTIDADE";
  const router = useRouter();
  const [versao, setVersao] = useState(m.versao);
  const [campos, setCampos] = useState(() => iniciais(estado.linhas, porQtd));
  const [filtro, setFiltro] = useState<"todos" | "lancados" | "saldo">("todos");
  const [observacao, setObservacao] = useState(m.observacao ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  useEffect(() => { setVersao(m.versao); setCampos(iniciais(estado.linhas, porQtd)); setObservacao(m.observacao ?? ""); }, [estado, m.versao, m.observacao, porQtd]);

  const emElaboracao = m.situacao === "EM_ELABORACAO";
  const lanca = podeEditar && emElaboracao;
  const original = useMemo(() => iniciais(estado.linhas, porQtd), [estado.linhas, porQtd]);
  const alterados = Object.keys(campos).filter((k) => campos[k].trim() !== original[k]);

  const rodar = <T,>(f: () => Promise<{ ok: true; dados: T } | { ok: false; erro: string }>, msg?: string, depois?: (d: T) => void) => iniciar(async () => {
    setErro(null);
    setAviso(null);
    const r = await f();
    if (!r.ok) return setErro(r.erro);
    depois?.(r.dados);
    if (msg) setAviso(msg);
    router.refresh();
  });

  const salvar = (depois?: (v: number) => void) => rodar(
    () => acaoSalvarLancamentos(c.id, m.id, versao, alterados.map((itemId) => ({ itemId, valor: campos[itemId] }))),
    depois ? undefined : "Lançamentos salvos.", (v) => { setVersao(v); depois?.(v); },
  );
  const fechar = () => {
    if (alterados.length) return setErro("Há lançamentos não salvos: salve antes de fechar.");
    if (!window.confirm(`Fechar a ${m.numero}ª medição (${moeda(estado.totais.atual)})? Depois de fechada ela fica travada.`)) return;
    rodar(() => acaoFecharMedicao(c.id, m.id, versao, observacao), "Medição fechada.");
  };

  const visivel = (l: LinhaMedicao) => {
    if (filtro === "lancados") return Number(l.atualValor) > 0 || (campos[l.itemId] ?? "") !== "";
    if (filtro === "saldo") return Number(l.anteriorValor) < Number(l.valorTotal);
    return true;
  };
  const itensDe = (gid: string) => estado.linhas.filter((l) => l.grupoId === gid && visivel(l));
  const s = ROTULO_SITUACAO[m.situacao];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{m.numero}ª medição — Contrato {c.numero}</h1>
          <p className="text-sm text-slate-600">
            Período: <strong>{dataBr(m.inicio)} a {dataBr(m.fim)}</strong> ({m.dias} dias corridos) · <span className={`rounded px-2 py-0.5 text-xs ${s.classe}`}>{s.texto}</span>
            {m.fechadaEm && <span className="ml-2 text-xs text-slate-500">fechada em {m.fechadaEm}{m.fechadaPor ? ` por ${m.fechadaPor}` : ""}</span>}
          </p>
          <p className="text-sm text-slate-600">
            {c.regimeNome ?? "Regime não definido"}{c.medicao && ` — medição por ${porQtd ? "quantidade executada" : "percentual executado"}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          {podeEditar && m.situacao === "PREVISTA" && (
            <button disabled={pendente || !!estado.podeIniciar} title={estado.podeIniciar ?? undefined} onClick={() => rodar(() => acaoIniciarMedicao(c.id, m.id), "Medição iniciada: lance as quantidades/percentuais.")}
              className="rounded-md bg-marca-600 px-3 py-1.5 font-medium text-white disabled:opacity-50">Iniciar medição</button>
          )}
          {lanca && <button disabled={pendente || !alterados.length} onClick={() => salvar()} className="rounded-md bg-marca-600 px-3 py-1.5 font-medium text-white disabled:opacity-50">Salvar lançamentos{alterados.length ? ` (${alterados.length})` : ""}</button>}
          {lanca && <button disabled={pendente} onClick={fechar} className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-50">Fechar medição</button>}
          {podeGerenciar && m.situacao === "FECHADA" && (
            <button disabled={pendente} onClick={() => { if (window.confirm(`Reabrir a ${m.numero}ª medição para correções?`)) rodar(() => acaoReabrirMedicao(c.id, m.id), "Medição reaberta."); }}
              className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-50">Reabrir medição</button>
          )}
        </div>
      </div>

      {m.situacao === "PREVISTA" && estado.podeIniciar && <p role="status" className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">{estado.podeIniciar}</p>}

      <div className="grid gap-3 sm:grid-cols-5">
        {[["Contratado", moeda(estado.totais.contratado)], ["Anterior (acumulado)", moeda(estado.totais.anterior)], ["Esta medição", moeda(estado.totais.atual)],
          ["Acumulado", `${moeda(estado.totais.acumulado)} · ${num(estado.totais.percentualAcumulado)}%`], ["Saldo", moeda(estado.totais.saldo)]].map(([r, v]) => (
          <div key={r} className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-xs text-slate-500">{r}</p>
            <p className="font-semibold tabular-nums">{v}</p>
          </div>
        ))}
      </div>

      {erro && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">{erro}</p>}
      {aviso && <p role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-800">{aviso}</p>}
      {lanca && (
        <p className="text-xs text-slate-500">
          {porQtd
            ? "Informe a quantidade executada no período (valor = quantidade × preço unitário contratado). O acumulado não pode passar da quantidade contratada."
            : "Informe o percentual do item executado no período (valor = % × total do item). O acumulado não pode passar de 100%."}
          {" "}Deixe vazio (ou 0) para não medir o item. Ao completar o item, o valor fecha exatamente o total contratado.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">Mostrar
          <select value={filtro} onChange={(e) => setFiltro(e.target.value as typeof filtro)} className="rounded-md border border-slate-300 px-2 py-1">
            <option value="todos">todos os itens</option>
            <option value="lancados">só os lançados nesta medição</option>
            <option value="saldo">só os com saldo</option>
          </select>
        </label>
        {alterados.length > 0 && <span className="text-amber-700">{alterados.length} lançamento(s) não salvo(s) — os valores são recalculados ao salvar.</span>}
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-2 py-2">Item</th><th className="px-2 py-2">Descrição</th><th className="px-2 py-2">Un</th>
              <th className="px-2 py-2 text-right">Qtd. contratada</th><th className="px-2 py-2 text-right">Preço unit.</th><th className="px-2 py-2 text-right">Total</th>
              <th className="px-2 py-2 text-right">Anterior {porQtd ? "(qtd)" : "(%)"}</th>
              <th className="px-2 py-2 text-right">Esta medição {porQtd ? "(qtd)" : "(%)"}</th>
              <th className="px-2 py-2 text-right">Valor desta</th>
              <th className="px-2 py-2 text-right">Acumulado {porQtd ? "(qtd)" : "(%)"}</th>
              <th className="px-2 py-2 text-right">Saldo (R$)</th>
            </tr>
          </thead>
          <tbody>
            {estado.grupos.map((g) => {
              const itens = itensDe(g.id);
              const temFilhos = estado.grupos.some((x) => x.paiId === g.id);
              if (!itens.length && !temFilhos) return null;
              return (
                <Fragment key={g.id}>
                  <tr className={g.nivel === 0 ? "bg-slate-100 font-semibold" : "bg-slate-50 font-medium"}><td className="px-2 py-1.5">{g.numero}</td><td colSpan={10} className="px-2 py-1.5">{g.titulo}</td></tr>
                  {itens.map((l) => {
                    const campo = campos[l.itemId] ?? "";
                    const v = campo.trim() ? lerCampo(campo) : 0;
                    const anterior = Number(porQtd ? l.anteriorQtd : l.anteriorPct);
                    const limite = porQtd ? Number(l.quantidade) : 100;
                    const acumulado = anterior + (Number.isFinite(v) ? v : 0);
                    const excede = !Number.isFinite(v) || v < 0 || acumulado > limite + 1e-9;
                    const mudou = campo.trim() !== original[l.itemId];
                    return (
                      <tr key={l.itemId} className="border-t border-slate-100 align-top">
                        <td className="px-2 py-1.5 tabular-nums">{l.numero}</td>
                        <td className="px-2 py-1.5"><span className="line-clamp-2" title={l.descricao}>{l.codigo && <span className="text-slate-500">{l.codigo} · </span>}{l.descricao}</span></td>
                        <td className="px-2 py-1.5">{l.unidade}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{num(l.quantidade)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{num(l.precoUnitario)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{num(l.valorTotal)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{num(anterior)}</td>
                        <td className="px-2 py-1.5 text-right">
                          {lanca
                            ? <input aria-label={`${porQtd ? "Quantidade" : "Percentual"} do item ${l.numero ?? ""}`} inputMode="decimal" value={campo}
                                onChange={(e) => setCampos((x) => ({ ...x, [l.itemId]: e.target.value }))}
                                className={`w-24 rounded border px-1.5 py-0.5 text-right tabular-nums ${excede ? "border-red-500 bg-red-50" : mudou ? "border-amber-400 bg-amber-50" : "border-slate-300"}`} />
                            : <span className="tabular-nums">{campo ? num(lerCampo(campo)) : "—"}</span>}
                          {lanca && excede && <span className="block text-xs text-red-700">saldo {num(Math.max(0, limite - anterior))}</span>}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{Number(l.atualValor) ? num(l.atualValor) : "—"}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{num(acumulado)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{num(Number(l.valorTotal) - Number(l.anteriorValor) - Number(l.atualValor))}</td>
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {(lanca || m.observacao) && (
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Observações da medição</span>
          <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} readOnly={!lanca} rows={3} maxLength={2000} className="w-full rounded-md border border-slate-300 px-2 py-1.5" />
          {lanca && <span className="text-xs text-slate-500">Gravadas ao fechar a medição.</span>}
        </label>
      )}
      <p className="text-sm"><Link href={`/contratos/${c.id}/medicoes`} className="underline">← Voltar às medições</Link></p>
    </div>
  );
}
