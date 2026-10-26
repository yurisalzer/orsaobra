"use client";

import { useRouter } from "next/navigation";
import { Fragment, useEffect, useState, useTransition } from "react";
import type { EstadoDesembolso } from "@/lib/medicoes/relatorios";
import { dataBr } from "@/lib/contratos/prazos";
import { acaoSalvarDesembolso } from "../acoes";

const num = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const paraCampo = (v: string) => (Number(v) ? Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 4, useGrouping: false }) : "");
const ler = (v: string) => (v.trim() ? Number(v.trim().replace(/\./g, "").replace(",", ".")) : 0);
const ORIGEM: Record<string, string> = {
  salvo: "", orcamento: "sugestão: cronograma do orçamento", uniforme: "sugestão: distribuição uniforme", concluido: "etapa concluída",
};

export function EditorDesembolso({ estado, podeEditar }: { estado: EstadoDesembolso; podeEditar: boolean }) {
  const e = estado;
  const router = useRouter();
  const futuros = e.periodos.filter((p) => p.numero > e.ultimaFechada);
  const iniciais = () => Object.fromEntries(e.grupos.map((g) => [g.id, Object.fromEntries(futuros.map((p) => [p.numero, paraCampo(e.previsto[g.id]?.[p.numero] ?? "0")]))]));
  const [campos, setCampos] = useState<Record<string, Record<number, string>>>(iniciais);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setCampos(iniciais()); }, [estado]);

  const realizadoPct = (gid: string, total: number) => (total ? Object.values(e.realizado[gid]).reduce((a, v) => a + Number(v), 0) / total * 100 : 0);
  const soma = (gid: string, total: number) => realizadoPct(gid, total) + futuros.reduce((a, p) => a + ler(campos[gid]?.[p.numero] ?? ""), 0);
  const distribuir = (gid: string, total: number) => {
    const resto = Math.max(0, 100 - realizadoPct(gid, total));
    if (!futuros.length) return;
    const parte = Math.floor((resto / futuros.length) * 100) / 100;
    setCampos((c) => ({
      ...c,
      [gid]: Object.fromEntries(futuros.map((p, k) => [p.numero, num(k === futuros.length - 1 ? resto - parte * (futuros.length - 1) : parte).replace(/\./g, "")])),
    }));
  };
  const salvar = () => iniciar(async () => {
    setErro(null);
    setAviso(null);
    const r = await acaoSalvarDesembolso(e.contrato.id, Object.fromEntries(Object.entries(campos).map(([g, ps]) => [g, Object.fromEntries(Object.entries(ps).map(([p, v]) => [String(p), v]))])));
    if (!r.ok) return setErro(r.erro);
    setAviso("Cronograma previsto salvo.");
    router.refresh();
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Cronograma de desembolso — Contrato {e.contrato.numero}</h1>
        <p className="max-w-3xl text-sm text-slate-600">{e.contrato.objeto}</p>
        <p className="mt-1 text-sm text-slate-600">
          Percentual de cada etapa principal em cada período de medição. Os períodos já medidos (fechados) mostram o <strong>realizado</strong>;
          nos seguintes, informe o <strong>previsto</strong> — realizado + previsto de cada etapa deve somar 100%.
          O documento é gerado na tela de cada medição fechada.
        </p>
      </div>
      {!e.periodos.length && <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">Planeje as medições antes.</p>}
      {erro && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">{erro}</p>}
      {aviso && <p role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-800">{aviso}</p>}
      {e.periodos.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-2 py-2 text-left">Nº</th>
                <th className="min-w-56 px-2 py-2 text-left">Etapa</th>
                {e.periodos.map((p) => (
                  <th key={p.numero} className="px-2 py-2 text-center">
                    <span className="block font-semibold">{p.numero}{p.numero <= e.ultimaFechada ? " ✓" : ""}</span>
                    <span className="block font-normal">{dataBr(p.inicio).slice(0, 5)}–{dataBr(p.fim).slice(0, 5)}</span>
                  </th>
                ))}
                <th className="px-2 py-2 text-right">Soma</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {e.grupos.map((g) => {
                const total = Number(g.total);
                const s = soma(g.id, total);
                const fecha = !total || Math.abs(s - 100) <= 0.05;
                return (
                  <Fragment key={g.id}>
                    <tr className="border-t border-slate-100">
                      <td className="px-2 py-1.5 font-medium">{g.numero}</td>
                      <td className="px-2 py-1.5">
                        <span className="font-medium">{g.titulo}</span>
                        <span className="block text-xs text-slate-500">R$ {num(total)}{ORIGEM[e.origem[g.id]] ? ` · ${ORIGEM[e.origem[g.id]]}` : ""}</span>
                      </td>
                      {e.periodos.map((p) => {
                        if (p.numero <= e.ultimaFechada) {
                          const v = Number(e.realizado[g.id][p.numero] ?? 0);
                          return <td key={p.numero} className="bg-slate-50 px-2 py-1.5 text-right tabular-nums" title={`Realizado: R$ ${num(v)}`}>{total ? num(v / total * 100) : "0,00"}%</td>;
                        }
                        return (
                          <td key={p.numero} className="px-1 py-1">
                            {podeEditar
                              ? <input aria-label={`Etapa ${g.numero}, período ${p.numero}`} inputMode="decimal" value={campos[g.id]?.[p.numero] ?? ""}
                                  onChange={(ev) => setCampos((c) => ({ ...c, [g.id]: { ...c[g.id], [p.numero]: ev.target.value } }))}
                                  className="w-16 rounded border border-slate-300 px-1 py-0.5 text-right tabular-nums" />
                              : <span className="tabular-nums">{campos[g.id]?.[p.numero] || "0"}%</span>}
                          </td>
                        );
                      })}
                      <td className={`px-2 py-1.5 text-right font-medium tabular-nums ${fecha ? "text-green-700" : "text-red-700"}`}>{num(s)}%</td>
                      <td className="px-2 py-1.5">
                        {podeEditar && futuros.length > 0 && total > 0 && (
                          <button onClick={() => distribuir(g.id, total)} className="whitespace-nowrap text-xs text-marca-700 underline">Distribuir saldo igualmente</button>
                        )}
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {podeEditar && futuros.length > 0 && (
        <div className="flex gap-2">
          <button disabled={pendente} onClick={salvar} className="rounded-md bg-marca-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">Salvar previsto</button>
          <button disabled={pendente} onClick={() => setCampos(iniciais())} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm">Desfazer alterações</button>
        </div>
      )}
      <p className="text-xs text-slate-500">✓ = medição fechada (realizado). Sem previsto salvo, o sistema sugere a distribuição do cronograma do orçamento de origem (quando houver) ou uniforme.</p>
    </div>
  );
}
