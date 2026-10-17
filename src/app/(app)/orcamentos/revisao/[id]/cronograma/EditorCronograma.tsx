"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { dec, formatarMoeda, formatarNumero, lerNumero } from "@/lib/calculo/decimal";
import type { Cronograma } from "@/lib/orcamento/servico";
import { acaoSalvarCronograma } from "../../../acoes";

interface Etapa { id: string; numero: string; titulo: string; total: string }

const chave = (etapaId: string, periodo: number) => `${etapaId}:${periodo}`;
const pct = (v: string) => formatarNumero(v, Math.min(Math.max(dec(v).decimalPlaces(), 2), 4));

export function EditorCronograma({ revisaoId, versao, etapas, total, inicial, editavel }: {
  revisaoId: string; versao: number; etapas: Etapa[]; total: string; inicial: Cronograma; editavel: boolean;
}) {
  const router = useRouter();
  const [meses, setMeses] = useState(inicial.meses ?? Math.max(1, ...inicial.parcelas.map((p) => p.periodo)));
  const [valores, setValores] = useState<Record<string, string>>(() =>
    Object.fromEntries(inicial.parcelas.map((p) => [chave(p.etapaId, p.periodo), pct(p.percentual)])),
  );
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const periodos = Array.from({ length: meses }, (_, i) => i + 1);

  // cálculos (mesma regra do relatório): valor do mês = total da etapa × percentual
  const calc = useMemo(() => {
    const porEtapa = new Map<string, { soma: ReturnType<typeof dec>; invalido: boolean }>();
    const porMes = periodos.map(() => dec(0));
    for (const e of etapas) {
      let soma = dec(0);
      let invalido = false;
      periodos.forEach((m, i) => {
        const t = valores[chave(e.id, m)]?.trim();
        if (!t) return;
        const v = lerNumero(t);
        if (!v || v.isNegative() || v.gt(100)) { invalido = true; return; }
        soma = soma.plus(v);
        porMes[i] = porMes[i].plus(dec(e.total).times(v).div(100));
      });
      porEtapa.set(e.id, { soma, invalido: invalido || soma.gt(100) });
    }
    return { porEtapa, porMes };
  }, [valores, etapas, periodos]);

  const salvar = () => iniciar(async () => {
    setErro(null); setAviso(null);
    const parcelas = etapas.flatMap((e) => periodos.map((m) => ({ etapaId: e.id, periodo: m, percentual: valores[chave(e.id, m)] ?? "" }))).filter((p) => p.percentual.trim());
    const r = await acaoSalvarCronograma(revisaoId, versao, { meses, parcelas });
    if (!r.ok) return setErro(r.erro);
    setAviso("Cronograma salvo.");
    router.refresh();
  });

  if (etapas.length === 0) return <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">Crie etapas no orçamento para montar o cronograma.</p>;
  let acumulado = dec(0);
  return (
    <div className="space-y-3">
      {editavel && (
        <label className="flex items-center gap-2 text-sm">Prazo (meses)
          <input type="number" min={1} max={120} value={meses} onChange={(e) => setMeses(Math.min(120, Math.max(1, Number(e.target.value) || 1)))}
            aria-label="Prazo em meses" className="w-20 rounded border border-slate-300 px-2 py-1 text-right" />
        </label>
      )}
      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr className="border-b border-slate-200">
              <th className="px-2 py-2">Etapa</th><th className="text-right">Total</th>
              {periodos.map((m) => <th key={m} className="px-1 text-right">Mês {m}</th>)}
              <th className="px-2 text-right">Soma</th>
            </tr>
          </thead>
          <tbody>
            {etapas.map((e) => {
              const c = calc.porEtapa.get(e.id)!;
              return (
                <tr key={e.id} className="border-t border-slate-100 align-top">
                  <td className="px-2 py-1">{e.numero} {e.titulo}</td>
                  <td className="num whitespace-nowrap">{formatarMoeda(e.total)}</td>
                  {periodos.map((m) => {
                    const k = chave(e.id, m);
                    const v = lerNumero(valores[k] ?? "");
                    return (
                      <td key={m} className="px-1 py-1 text-right">
                        {editavel ? (
                          <input value={valores[k] ?? ""} onChange={(ev) => setValores({ ...valores, [k]: ev.target.value })} inputMode="decimal"
                            aria-label={`Percentual ${e.numero} mês ${m}`} placeholder="0" className="w-16 rounded border border-slate-300 px-1 py-0.5 text-right" />
                        ) : (valores[k] ? `${valores[k]}%` : "")}
                        {v && !v.isZero() && <div className="text-[10px] text-slate-500">{formatarMoeda(dec(e.total).times(v).div(100).toFixed(2))}</div>}
                      </td>
                    );
                  })}
                  <td className={`num px-2 ${c.invalido ? "text-red-700" : c.soma.eq(100) ? "text-green-800" : "text-amber-700"}`}>{formatarNumero(c.soma, 2)}%</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="text-xs">
            <tr className="border-t border-slate-300 font-medium">
              <td className="px-2 py-1">Total do mês</td><td className="num">{formatarMoeda(total)}</td>
              {calc.porMes.map((v, i) => <td key={i} className="num px-1">{formatarMoeda(v.toFixed(2))}</td>)}<td />
            </tr>
            <tr>
              <td className="px-2 py-1">Acumulado</td><td />
              {calc.porMes.map((v, i) => {
                acumulado = acumulado.plus(v);
                return <td key={i} className="num px-1">{formatarMoeda(acumulado.toFixed(2))}<div className="text-slate-500">{dec(total).isZero() ? "—" : `${formatarNumero(acumulado.div(total).times(100), 2)}%`}</div></td>;
              })}<td />
            </tr>
          </tfoot>
        </table>
      </section>
      {erro && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{erro}</p>}
      {aviso && <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">{aviso}</p>}
      {editavel && <button onClick={salvar} disabled={pendente} className="rounded-md bg-marca-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{pendente ? "Salvando…" : "Salvar cronograma"}</button>}
      <p className="text-xs text-slate-500">Cada etapa deve somar 100% (verde). Abaixo de 100% (amarelo) o cronograma fica incompleto; acima de 100% (vermelho) não é aceito.</p>
    </div>
  );
}
