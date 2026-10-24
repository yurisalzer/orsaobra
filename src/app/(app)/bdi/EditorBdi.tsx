"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { calcularBdi, somasBdi, type TipoParcelaBdi } from "@/lib/calculo/bdi";
import { calcularBdiPorFormula, VARIAVEIS_BDI } from "@/lib/calculo/formula-bdi";
import { lerNumero } from "@/lib/calculo/decimal";
import { acaoSalvarPerfil } from "../orcamentos/acoes";

interface Parcela { tipo: TipoParcelaBdi; nome: string; percentual: string }
const TIPOS: { tipo: TipoParcelaBdi; nome: string }[] = [
  { tipo: "AC", nome: "Administração central" }, { tipo: "S", nome: "Seguro" }, { tipo: "R", nome: "Risco" }, { tipo: "G", nome: "Garantia" },
  { tipo: "DF", nome: "Despesas financeiras" }, { tipo: "L", nome: "Lucro" }, { tipo: "I", nome: "Tributos" },
];

/** Ponto de partida da fórmula personalizada: a do TCU, para o usuário adaptar. */
const FORMULA_TCU = "(1 + AC + S + R + G) * (1 + DF) * (1 + L) / (1 - I) - 1";

export function EditorBdi({ inicial, aoFechar }: { inicial: { id: string | null; nome: string; descricao: string | null; percentualInformado: string | null; formula?: string | null; parcelas: Parcela[] }; aoFechar: () => void }) {
  const [d, setD] = useState({
    ...inicial,
    modo: inicial.percentualInformado ? "INFORMADO" : inicial.formula ? "FORMULA" : "PARCELAS",
    formula: inicial.formula ?? FORMULA_TCU,
    percentualInformado: (inicial.percentualInformado ?? "").replace(".", ","),
    parcelas: inicial.parcelas.length ? inicial.parcelas.map((p) => ({ ...p, percentual: p.percentual.replace(".", ",") })) : [
      { tipo: "AC", nome: "Administração central", percentual: "" }, { tipo: "S", nome: "Seguro", percentual: "" }, { tipo: "R", nome: "Risco", percentual: "" },
      { tipo: "G", nome: "Garantia", percentual: "" }, { tipo: "DF", nome: "Despesas financeiras", percentual: "" }, { tipo: "L", nome: "Lucro", percentual: "" },
      { tipo: "I", nome: "PIS", percentual: "" }, { tipo: "I", nome: "COFINS", percentual: "" }, { tipo: "I", nome: "ISS", percentual: "" },
    ] as Parcela[],
  });
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  const previa = useMemo(() => {
    try {
      if (d.modo === "INFORMADO") { const v = lerNumero(d.percentualInformado); return v ? v.toFixed(2) : "—"; }
      const ps = d.parcelas.filter((p) => p.percentual.trim()).map((p) => ({ ...p, percentual: lerNumero(p.percentual)?.toString() ?? "x" }));
      if (!ps.length) return "—";
      if (d.modo === "FORMULA") return calcularBdiPorFormula(d.formula, somasBdi(ps)).toDecimalPlaces(2).toFixed(2);
      return calcularBdi(ps).bdi.toDecimalPlaces(2).toFixed(2);
    } catch (e) { return d.modo === "FORMULA" ? `inválido — ${(e as Error).message}` : "inválido"; }
  }, [d]);

  const salvar = () => iniciar(async () => {
    setErro(null);
    const r = await acaoSalvarPerfil({
      id: d.id, nome: d.nome, descricao: d.descricao,
      percentualInformado: d.modo === "INFORMADO" ? d.percentualInformado : null,
      formula: d.modo === "FORMULA" ? d.formula : null,
      parcelas: d.modo === "INFORMADO" ? [] : d.parcelas,
    });
    if (!r.ok) return setErro(r.erro);
    aoFechar();
    router.refresh();
  });

  const campo = "rounded border border-slate-300 px-2 py-1 text-sm";
  return (
    <div className="space-y-3 rounded-xl border border-marca-600 bg-white p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Nome do perfil<input value={d.nome} onChange={(e) => setD({ ...d, nome: e.target.value })} className={`mt-1 w-full ${campo}`} /></label>
        <label className="text-sm">Descrição<input value={d.descricao ?? ""} onChange={(e) => setD({ ...d, descricao: e.target.value })} className={`mt-1 w-full ${campo}`} /></label>
      </div>
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-1"><input type="radio" checked={d.modo === "PARCELAS"} onChange={() => setD({ ...d, modo: "PARCELAS" })} /> Calcular pelas parcelas (Acórdão TCU 2.622/2013)</label>
        <label className="flex items-center gap-1"><input type="radio" checked={d.modo === "FORMULA"} onChange={() => setD({ ...d, modo: "FORMULA" })} /> Fórmula personalizada</label>
        <label className="flex items-center gap-1"><input type="radio" checked={d.modo === "INFORMADO"} onChange={() => setD({ ...d, modo: "INFORMADO" })} /> Percentual informado (ex.: fixado em edital)</label>
      </div>
      {d.modo === "INFORMADO" ? (
        <label className="block text-sm">BDI (%)<input value={d.percentualInformado} onChange={(e) => setD({ ...d, percentualInformado: e.target.value })} inputMode="decimal" aria-label="BDI informado (%)" className={`ml-2 w-28 ${campo}`} /></label>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500"><tr><th className="py-1">Grupo</th><th>Parcela</th><th>%</th><th /></tr></thead>
            <tbody>
              {d.parcelas.map((p, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="py-1">
                    <select value={p.tipo} onChange={(e) => setD({ ...d, parcelas: d.parcelas.map((x, j) => (j === i ? { ...x, tipo: e.target.value as TipoParcelaBdi } : x)) })} className={campo} aria-label={`Grupo da parcela ${i + 1}`}>
                      {TIPOS.map((t) => <option key={t.tipo} value={t.tipo}>{t.tipo} — {t.nome}</option>)}
                    </select>
                  </td>
                  <td><input value={p.nome} onChange={(e) => setD({ ...d, parcelas: d.parcelas.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)) })} className={`w-full ${campo}`} /></td>
                  <td><input value={p.percentual} inputMode="decimal" aria-label={`Percentual ${p.nome}`} onChange={(e) => setD({ ...d, parcelas: d.parcelas.map((x, j) => (j === i ? { ...x, percentual: e.target.value } : x)) })} className={`w-24 text-right ${campo}`} /></td>
                  <td><button type="button" className="text-xs text-red-700 underline" onClick={() => setD({ ...d, parcelas: d.parcelas.filter((_, j) => j !== i) })}>remover</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="text-sm text-marca-700 underline" onClick={() => setD({ ...d, parcelas: [...d.parcelas, { tipo: "I", nome: "", percentual: "" }] })}>+ parcela</button>
          {d.modo === "FORMULA" ? (
            <div className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <label className="block text-sm font-medium">Fórmula do BDI
                <textarea value={d.formula} onChange={(e) => setD({ ...d, formula: e.target.value })} rows={2} maxLength={500} aria-label="Fórmula do BDI"
                  spellCheck={false} className={`mt-1 w-full font-mono ${campo}`} />
              </label>
              <div className="flex flex-wrap items-center gap-1 text-xs">
                <span className="text-slate-500">Inserir:</span>
                {[...VARIAVEIS_BDI, "+", "-", "*", "/", "(", ")"].map((v) => (
                  <button key={v} type="button" onClick={() => setD({ ...d, formula: `${d.formula}${/^[A-Z]+$/.test(v) ? v : ` ${v} `}`.replace(/\s+/g, " ") })}
                    className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-mono">{v}</button>
                ))}
                <button type="button" onClick={() => setD({ ...d, formula: FORMULA_TCU })} className="ml-2 text-marca-700 underline">voltar à fórmula do TCU</button>
              </div>
              <p className="text-xs text-slate-500">
                Variáveis: AC, S, R, G, DF, L e I valem a soma das parcelas de cada grupo, em fração (5% = 0,05). O resultado também é fração (0,2223 = 22,23%).
                Operadores: + − * / ^ e parênteses. Ex.: (1 + AC + S + R + G + DF) * (1 + L) / (1 − I) − 1.
              </p>
            </div>
          ) : (
            <p className="text-xs text-slate-500">BDI = [(1+AC+S+R+G) × (1+DF) × (1+L)] / (1−I) − 1. Parcelas vazias são ignoradas. Nenhum valor é sugerido: informe os percentuais adotados.</p>
          )}
        </>
      )}
      <p className="text-sm" aria-live="polite">BDI resultante (aplicado com 2 casas): <strong>{previa.startsWith("inválido") ? previa : `${previa.replace(".", ",")}%`}</strong></p>
      {erro && <p role="alert" className="text-sm text-red-700">{erro}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={salvar} disabled={pendente} className="rounded-md bg-marca-600 px-4 py-2 text-sm text-white disabled:opacity-50">Salvar perfil</button>
        <button type="button" onClick={aoFechar} className="rounded-md border border-slate-300 px-4 py-2 text-sm">Cancelar</button>
      </div>
    </div>
  );
}
