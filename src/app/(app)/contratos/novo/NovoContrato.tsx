"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { acaoCriarContratoDoOrcamento } from "../acoes";
import { CamposContrato, CONTRATO_VAZIO, paraAcao } from "../CamposContrato";
import type { EmpresaParaContrato } from "@/lib/empresas/servico";

interface Revisao { revisaoId: string; processo: string | null; rotulo: string; obraNome: string; objeto: string | null; total: string }

export function NovoContrato({ revisoes, inicial, empresas }: { revisoes: Revisao[]; inicial: string; empresas: EmpresaParaContrato[] }) {
  const [revisaoId, setRevisaoId] = useState(inicial);
  const r0 = revisoes.find((r) => r.revisaoId === inicial);
  const [form, setForm] = useState({ ...CONTRATO_VAZIO, objeto: r0?.objeto ?? r0?.obraNome ?? "", processo: r0?.processo ?? "" });
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  const escolher = (id: string) => {
    setRevisaoId(id);
    const r = revisoes.find((x) => x.revisaoId === id);
    if (r) setForm({ ...form, objeto: form.objeto.trim() ? form.objeto : r.objeto ?? r.obraNome, processo: form.processo.trim() ? form.processo : r.processo ?? "" });
  };
  const criar = () => iniciar(async () => {
    setErro(null);
    if (!revisaoId) return setErro("Escolha a revisão do orçamento.");
    const r = await acaoCriarContratoDoOrcamento(revisaoId, paraAcao(form));
    if (!r.ok) return setErro(r.erro);
    router.push(`/contratos/${r.dados}`);
  });

  return (
    <div className="space-y-4">
      <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-5">
        <label className="block text-sm">Orçamento (revisão fechada)
          <select value={revisaoId} onChange={(e) => escolher(e.target.value)} aria-label="Revisão do orçamento" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
            <option value="">Escolha…</option>
            {revisoes.map((r) => (
              <option key={r.revisaoId} value={r.revisaoId}>{r.obraNome} — {r.rotulo} — R$ {Number(r.total).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</option>
            ))}
          </select>
        </label>
      </section>
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-medium">Dados do contrato</h2>
        <CamposContrato valor={form} onChange={setForm} empresas={empresas} />
      </section>
      {erro && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{erro}</p>}
      <button onClick={criar} disabled={pendente} className="rounded-md bg-marca-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
        {pendente ? "Criando…" : "Criar contrato e planilha"}
      </button>
    </div>
  );
}
