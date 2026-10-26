"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { PainelMedicoes as Painel } from "@/lib/medicoes/servico";
import { diasEntre, gerarPeriodos, MAX_DIAS } from "@/lib/medicoes/periodos";
import { dataBr, somarDias } from "@/lib/contratos/prazos";
import { acaoAcrescentarMedicao, acaoAlterarPeriodo, acaoExcluirUltimaMedicao, acaoPlanejarMedicoes } from "./acoes";

const moeda = (v: string) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });
const pct = (v: string) => `${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const hoje = () => new Date().toISOString().slice(0, 10);

export const ROTULO_SITUACAO: Record<string, { texto: string; classe: string }> = {
  PREVISTA: { texto: "Prevista", classe: "bg-slate-100 text-slate-700" },
  EM_ELABORACAO: { texto: "Em elaboração", classe: "bg-amber-50 text-amber-800" },
  FECHADA: { texto: "Fechada", classe: "bg-green-50 text-green-800" },
};

function quantidadeSugerida(c: Painel["contrato"], continuo: boolean, dias: number) {
  if (continuo) return c.prazoVigenciaDias ? Math.max(1, Math.round(c.prazoVigenciaDias / 30.4375)) : 12;
  return c.prazoExecucaoDias ? Math.max(1, Math.ceil(c.prazoExecucaoDias / Math.max(1, dias))) : 1;
}

export function PainelMedicoes({ painel, podeEditar, podeGerenciar }: { painel: Painel; podeEditar: boolean; podeGerenciar: boolean }) {
  const c = painel.contrato;
  const ms = painel.medicoes;
  const router = useRouter();
  const iniciadas = ms.filter((m) => m.situacao !== "PREVISTA");
  const [continuo, setContinuo] = useState(c.continuo);
  const [inicio, setInicio] = useState(ms[0]?.inicio ?? c.dataOs ?? hoje());
  const [dias, setDias] = useState(String(ms.find((m) => m.situacao === "PREVISTA")?.dias ?? MAX_DIAS));
  const [quantidade, setQuantidade] = useState(String(ms.length || quantidadeSugerida(c, c.continuo, MAX_DIAS)));
  const [planejando, setPlanejando] = useState(ms.length === 0);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  const rodar = (f: () => Promise<{ ok: true; dados: unknown } | { ok: false; erro: string }>, msg?: string, depois?: () => void) => iniciar(async () => {
    setErro(null);
    setAviso(null);
    const r = await f();
    if (!r.ok) return setErro(r.erro);
    if (msg) setAviso(msg);
    depois?.();
    router.refresh();
  });

  const nDias = Number(dias);
  const nQtd = Number(quantidade);
  const diasValidos = continuo || (Number.isInteger(nDias) && nDias >= 1 && nDias <= MAX_DIAS);
  const qtdValida = Number.isInteger(nQtd) && nQtd >= Math.max(1, iniciadas.length) && nQtd <= 240;
  // a prévia parte do fim da última iniciada (as iniciadas/fechadas são mantidas)
  const inicioPrevia = iniciadas.length ? somarDias(iniciadas[iniciadas.length - 1].fim, 1) : inicio;
  const previa = diasValidos && qtdValida && /^\d{4}-\d{2}-\d{2}$/.test(inicioPrevia) ? gerarPeriodos(inicioPrevia, nQtd - iniciadas.length, continuo, nDias) : [];

  const planejar = () => {
    if (ms.some((m) => m.situacao === "PREVISTA") && !window.confirm("Refazer o planejamento? As medições previstas serão substituídas (as iniciadas e fechadas são mantidas).")) return;
    rodar(() => acaoPlanejarMedicoes(c.id, { inicio, quantidade: nQtd, dias: continuo ? null : nDias, servicoContinuo: continuo }), "Medições planejadas.", () => setPlanejando(false));
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Medições — Contrato {c.numero}</h1>
        <p className="max-w-3xl text-sm text-slate-600">{c.objeto}</p>
        <p className="mt-1 text-sm text-slate-600">
          Regime: <strong>{c.regimeNome ?? "não definido"}</strong>
          {c.medicao && <> · medição por <strong>{c.medicao === "QUANTIDADE" ? "quantidade executada de cada item" : "percentual executado de cada item"}</strong></>}
          {c.continuo && <> · <strong>serviço contínuo</strong> (medições mensais)</>}
        </p>
      </div>

      {!c.medicao && <p role="status" className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">Defina o regime de execução nos <Link href={`/contratos/${c.id}`} className="underline">dados do contrato</Link>: ele determina se a medição é por quantidade (preço unitário) ou por percentual (demais regimes).</p>}
      {c.situacao !== "VIGENTE" && <p role="status" className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">A planilha do contrato ainda está em cadastro. O planejamento pode ser feito, mas os lançamentos só começam depois de <Link href={`/contratos/${c.id}`} className="underline">confirmar a planilha</Link>.</p>}

      <div className="grid gap-3 sm:grid-cols-4">
        {[["Valor contratado", moeda(c.total)], ["Medido (fechadas)", moeda(painel.totais.medido)], ["Executado", pct(painel.totais.percentual)], ["Saldo", moeda(painel.totais.saldo)]].map(([r, v]) => (
          <div key={r} className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-xs text-slate-500">{r}</p>
            <p className="text-lg font-semibold tabular-nums">{v}</p>
          </div>
        ))}
      </div>

      {erro && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">{erro}</p>}
      {aviso && <p role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-800">{aviso}</p>}

      {podeEditar && planejando && (
        <section aria-label="Planejamento das medições" className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Planejamento das medições</h2>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={continuo} onChange={(e) => { setContinuo(e.target.checked); if (!ms.length) setQuantidade(String(quantidadeSugerida(c, e.target.checked, nDias || MAX_DIAS))); }} />
            Serviço contínuo (contrato anual) — medições mensais, dia a dia (ex.: 10/10/2026 a 09/11/2026)
          </label>
          <div className="flex flex-wrap items-end gap-3 text-sm">
            <label className="flex flex-col gap-1">
              <span>Início da 1ª medição</span>
              <input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} disabled={iniciadas.length > 0} className="rounded-md border border-slate-300 px-2 py-1.5 disabled:opacity-60" />
            </label>
            <label className="flex flex-col gap-1">
              <span>Quantidade de medições</span>
              <input type="number" min={Math.max(1, iniciadas.length)} max={240} value={quantidade} onChange={(e) => setQuantidade(e.target.value)} className="w-28 rounded-md border border-slate-300 px-2 py-1.5" />
            </label>
            {!continuo && (
              <label className="flex flex-col gap-1">
                <span>Dias corridos por medição (máx. {MAX_DIAS})</span>
                <input type="number" min={1} max={MAX_DIAS} value={dias} onChange={(e) => setDias(e.target.value)} className="w-28 rounded-md border border-slate-300 px-2 py-1.5" />
              </label>
            )}
            <button disabled={pendente || !diasValidos || !qtdValida} onClick={planejar} className="rounded-md bg-marca-600 px-3 py-1.5 font-medium text-white disabled:opacity-50">
              {ms.length ? "Refazer planejamento" : "Planejar medições"}
            </button>
            {ms.length > 0 && <button onClick={() => setPlanejando(false)} className="rounded-md border border-slate-300 px-3 py-1.5">Cancelar</button>}
          </div>
          {!diasValidos && <p className="text-sm text-red-700">Cada medição tem de 1 a {MAX_DIAS} dias corridos.</p>}
          {!qtdValida && <p className="text-sm text-red-700">Quantidade de {Math.max(1, iniciadas.length)} a 240 medições.</p>}
          {iniciadas.length > 0 && <p className="text-xs text-slate-500">As {iniciadas.length} medição(ões) já iniciada(s) ou fechada(s) são mantidas; as previstas recomeçam em {dataBr(inicioPrevia)}.</p>}
          {previa.length > 0 && (
            <p className="text-xs text-slate-500">
              Prévia: {previa.slice(0, 3).map((p, k) => `${iniciadas.length + k + 1}ª ${dataBr(p.inicio)} a ${dataBr(p.fim)}`).join(" · ")}
              {previa.length > 3 && ` … ${nQtd}ª ${dataBr(previa[previa.length - 1].inicio)} a ${dataBr(previa[previa.length - 1].fim)}`}
            </p>
          )}
          {!continuo && <p className="text-xs text-slate-500">Depois de planejar, o fim de cada medição prevista pode ser ajustado (até {MAX_DIAS} dias corridos); as seguintes acompanham.</p>}
        </section>
      )}

      {ms.length > 0 && (
        <section aria-label="Medições" className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Medições ({ms.length}) <Link href={`/contratos/${c.id}/medicoes/desembolso`} className="ml-3 text-sm font-normal text-marca-700 underline">Cronograma de desembolso</Link></h2>
            {podeEditar && (
              <div className="flex flex-wrap gap-2 text-sm">
                {!planejando && <button onClick={() => setPlanejando(true)} className="rounded-md border border-slate-300 px-3 py-1.5">Refazer planejamento</button>}
                <button disabled={pendente} onClick={() => rodar(() => acaoAcrescentarMedicao(c.id), "Medição acrescentada.")} className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-50">+ Acrescentar medição</button>
                {ms[ms.length - 1].situacao === "PREVISTA" && (
                  <button disabled={pendente} onClick={() => { if (window.confirm(`Excluir a ${ms[ms.length - 1].numero}ª medição (prevista)?`)) rodar(() => acaoExcluirUltimaMedicao(c.id), "Medição excluída."); }}
                    className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-50">Excluir a última</button>
                )}
              </div>
            )}
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr><th className="px-3 py-2">Nº</th><th className="px-3 py-2">Início</th><th className="px-3 py-2">Fim</th><th className="px-3 py-2 text-right">Dias</th><th className="px-3 py-2">Situação</th><th className="px-3 py-2 text-right">Valor</th><th className="px-3 py-2 text-right">Acumulado</th><th className="px-3 py-2"></th></tr>
              </thead>
              <tbody>
                {ms.map((m) => {
                  const s = ROTULO_SITUACAO[m.situacao];
                  const editaFim = podeEditar && !c.continuo && m.situacao !== "FECHADA" && !ms.some((x) => x.numero > m.numero && x.situacao !== "PREVISTA");
                  return (
                    <tr key={m.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-medium">{m.numero}ª</td>
                      <td className="px-3 py-2 tabular-nums">{dataBr(m.inicio)}</td>
                      <td className="px-3 py-2 tabular-nums">
                        {editaFim
                          ? <FimMedicao key={m.fim} inicio={m.inicio} fim={m.fim} rotulo={`Fim da ${m.numero}ª medição`} disabled={pendente}
                              onSalvar={(fim) => rodar(() => acaoAlterarPeriodo(c.id, m.id, fim), `Período da ${m.numero}ª medição ajustado.`)} />
                          : dataBr(m.fim)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{m.dias}</td>
                      <td className="px-3 py-2"><span className={`rounded px-2 py-0.5 text-xs ${s.classe}`}>{s.texto}</span>{m.fechadaEm && <span className="block text-xs text-slate-500">{m.fechadaEm}{m.fechadaPor ? ` · ${m.fechadaPor}` : ""}</span>}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{m.situacao === "PREVISTA" ? "—" : moeda(m.valor)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{m.situacao === "FECHADA" ? moeda(m.acumulado) : "—"}</td>
                      <td className="px-3 py-2 text-right"><Link href={`/contratos/${c.id}/medicoes/${m.id}`} className="text-marca-700 underline">{m.situacao === "PREVISTA" ? "Abrir" : m.situacao === "FECHADA" ? "Ver" : "Lançar"}</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {podeGerenciar && <p className="text-xs text-slate-500">Medição fechada fica travada; só a última fechada pode ser reaberta (por quem cadastrou o contrato ou pelo administrador).</p>}
        </section>
      )}
      {!ms.length && !podeEditar && <p className="text-sm text-slate-500">Nenhuma medição planejada.</p>}
    </div>
  );
}

function FimMedicao({ inicio, fim, rotulo, disabled, onSalvar }: { inicio: string; fim: string; rotulo: string; disabled: boolean; onSalvar: (fim: string) => void }) {
  const [v, setV] = useState(fim);
  const dias = /^\d{4}-\d{2}-\d{2}$/.test(v) ? diasEntre(inicio, v) : 0;
  const invalido = dias < 1 || dias > MAX_DIAS;
  return (
    <span className="inline-flex items-center gap-1">
      <input type="date" aria-label={rotulo} value={v} min={inicio} onChange={(e) => setV(e.target.value)} className={`rounded border px-1 py-0.5 ${invalido ? "border-red-400" : "border-slate-300"}`} />
      {v !== fim && <button disabled={disabled || invalido} onClick={() => onSalvar(v)} className="rounded bg-marca-600 px-2 py-0.5 text-xs text-white disabled:opacity-50">Salvar</button>}
      {v !== fim && invalido && <span className="text-xs text-red-700">até {MAX_DIAS} dias</span>}
    </span>
  );
}
