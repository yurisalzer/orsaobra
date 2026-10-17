"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { acaoCriarOrcamento, type DadosNovaObra } from "../acoes";
import { CamposObra, OBRA_VAZIA } from "../CamposObra";

interface BaseOpcao { revisaoId: string; fonte: string; rotulo: string; regimes: { codigo: string; nome: string }[] }

export function FormNovo({ obras, bases, perfis }: { obras: { id: string; nome: string }[]; bases: BaseOpcao[]; perfis: { id: string; nome: string; bdi: string }[] }) {
  const fontes = [...new Set(bases.map((b) => b.fonte))];
  const [obraId, setObraId] = useState<string>(obras[0]?.id ?? "");
  const [novaObra, setNovaObra] = useState<DadosNovaObra>(OBRA_VAZIA);
  const [titulo, setTitulo] = useState("");
  const [codigo, setCodigo] = useState("");
  const [sel, setSel] = useState<Record<string, { usar: boolean; base: string; regime: string }>>(() =>
    Object.fromEntries(fontes.map((f) => {
      const b = bases.find((x) => x.fonte === f)!;
      return [f, { usar: true, base: b.revisaoId, regime: (b.regimes.find((r) => r.codigo === "SEM_DESONERACAO") ?? b.regimes[0])?.codigo ?? "" }];
    })),
  );
  const [bdi, setBdi] = useState("");
  const [modo, setModo] = useState("ARREDONDAR");
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();
  const campo = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm";

  const criar = () => iniciar(async () => {
    setErro(null);
    const r = await acaoCriarOrcamento({
      obraId: obraId || null, novaObra: obraId ? null : novaObra, codigo, titulo,
      bases: fontes.filter((f) => sel[f].usar).map((f) => ({ baseRevisaoId: sel[f].base, regime: sel[f].regime })),
      bdiPerfilId: bdi || null, arredondamento: modo,
    });
    if (!r.ok) return setErro(r.erro);
    router.push(`/orcamentos/revisao/${r.dados.revisaoId}`);
  });

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-medium">Obra</h2>
        <select value={obraId} onChange={(e) => setObraId(e.target.value)} aria-label="Obra" className={campo}>
          {obras.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
          <option value="">+ Nova obra</option>
        </select>
        {!obraId && (
          <CamposObra valor={novaObra} onChange={setNovaObra} />
        )}
      </section>
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-medium">Orçamento</h2>
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <label className="text-sm">Código do orçamento<input value={codigo} onChange={(e) => setCodigo(e.target.value)} className={campo} /></label>
          <label className="text-sm">Título<input value={titulo} onChange={(e) => setTitulo(e.target.value)} className={campo} /></label>
        </div>
        <h3 className="pt-2 text-sm font-medium">Bases de referência padrão (cada item pode usar outra)</h3>
        {fontes.length === 0 && <p className="text-sm text-amber-800">Nenhuma base publicada. Publique uma base em Importação.</p>}
        {fontes.map((f) => (
          <div key={f} className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex w-28 items-center gap-1 font-medium"><input type="checkbox" checked={sel[f].usar} onChange={(e) => setSel({ ...sel, [f]: { ...sel[f], usar: e.target.checked } })} /> {f}</label>
            <select value={sel[f].base} aria-label={`Base ${f}`} onChange={(e) => setSel({ ...sel, [f]: { ...sel[f], base: e.target.value } })} className="rounded border border-slate-300 px-2 py-1">
              {bases.filter((b) => b.fonte === f).map((b) => <option key={b.revisaoId} value={b.revisaoId}>{b.rotulo}</option>)}
            </select>
            <select value={sel[f].regime} aria-label={`Regime ${f}`} onChange={(e) => setSel({ ...sel, [f]: { ...sel[f], regime: e.target.value } })} className="rounded border border-slate-300 px-2 py-1">
              {bases.find((b) => b.revisaoId === sel[f].base)?.regimes.map((r) => <option key={r.codigo} value={r.codigo}>{r.nome}</option>)}
            </select>
          </div>
        ))}
        <div className="grid gap-3 pt-2 sm:grid-cols-2">
          <label className="text-sm">BDI global
            <select value={bdi} onChange={(e) => setBdi(e.target.value)} className={campo} aria-label="BDI global">
              <option value="">Sem BDI (somente custo direto)</option>
              {perfis.map((p) => <option key={p.id} value={p.id}>{p.nome} — {Number(p.bdi).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}%</option>)}
            </select>
          </label>
          <label className="text-sm">Arredondamento dos preços (2 casas)
            <select value={modo} onChange={(e) => setModo(e.target.value)} className={campo} aria-label="Arredondamento">
              <option value="ARREDONDAR">Arredondar</option>
              <option value="TRUNCAR">Truncar</option>
            </select>
          </label>
        </div>
      </section>
      {erro && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{erro}</p>}
      <button onClick={criar} disabled={pendente} className="rounded-md bg-marca-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{pendente ? "Criando…" : "Criar orçamento"}</button>
    </div>
  );
}
