"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useState, useTransition } from "react";
import type { EstadoContrato, ItemContrato } from "@/lib/contratos/servico";
import { acaoAlterarDadosContrato, acaoAlterarPreco, acaoConfirmarContrato, acaoDescontoLinear, acaoExcluirContrato, acaoReabrirContrato } from "../acoes";
import { calcularPrazos, dataBr } from "@/lib/contratos/prazos";
import { CamposContrato, paraAcao, type FormContrato } from "../CamposContrato";

const moeda = (v: string | null) => (v === null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 }));
const preco = (v: string | null) => (v === null ? "—" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 }));
const qtd = (v: string) => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const paraForm = (c: EstadoContrato["contrato"]): FormContrato => ({
  numero: c.numero, objeto: c.objeto, empresa: c.empresa ?? "", cnpj: c.cnpj ?? "", dataAssinatura: c.dataAssinatura ?? "", dataOs: c.dataOs ?? "",
  prazoExecucaoDias: c.prazoExecucaoDias ? String(c.prazoExecucaoDias) : "", prazoVigenciaDias: c.prazoVigenciaDias ? String(c.prazoVigenciaDias) : "",
  endereco: c.endereco ?? "", responsavelTecnico: c.responsavelTecnico ?? "", artRrt: c.artRrt ?? "", emailContato: c.emailContato ?? "", telefoneContato: c.telefoneContato ?? "",
});

export function PlanilhaContrato({ estado, podeEditar, podeGerenciar }: { estado: EstadoContrato; podeEditar: boolean; podeGerenciar: boolean }) {
  const c = estado.contrato;
  const router = useRouter();
  const [versao, setVersao] = useState(c.versao);
  const [form, setForm] = useState(paraForm(c));
  const [editandoDados, setEditandoDados] = useState(false);
  const [desconto, setDesconto] = useState("");
  const [modo, setModo] = useState("ARREDONDAR");
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  useEffect(() => { setVersao(c.versao); setForm(paraForm(c)); }, [c]);

  const emCadastro = c.situacao === "EM_CADASTRO";
  const prazos = calcularPrazos(c);
  const editaPreco = podeEditar && emCadastro && c.origem === "ORCAMENTO";
  const rodar = <T,>(f: () => Promise<{ ok: true; dados: T } | { ok: false; erro: string }>, depois?: (d: T) => void, msg?: string) => iniciar(async () => {
    setErro(null);
    setAviso(null);
    const r = await f();
    if (!r.ok) return setErro(r.erro);
    depois?.(r.dados);
    if (msg) setAviso(msg);
    router.refresh();
  });

  const salvarPreco = (it: ItemContrato, valor: string) => {
    if (!valor.trim() || Number(valor.replace(/\./g, "").replace(",", ".")) === Number(it.precoUnitario)) return;
    rodar(() => acaoAlterarPreco(c.id, versao, it.id, valor), (v) => setVersao(v));
  };

  const itensDe = (gid: string) => estado.itens.filter((i) => i.grupoId === gid);
  const colunas = c.origem === "ORCAMENTO" ? 8 : 7;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Contrato {c.numero}</h1>
          <p className="max-w-3xl text-sm text-slate-600">{c.objeto}</p>
          <p className="mt-1 text-sm">
            {c.situacao === "VIGENTE"
              ? <span className="rounded bg-green-50 px-2 py-0.5 text-green-800">Planilha vigente{c.confirmadoEm ? ` desde ${c.confirmadoEm}${c.confirmadoPor ? ` (${c.confirmadoPor})` : ""}` : ""}</span>
              : <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-800">Em cadastro — confira a planilha e confirme</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          {podeGerenciar && emCadastro && (
            <button disabled={pendente} onClick={() => { if (window.confirm("Confirmar a planilha contratual? Depois de confirmada ela fica travada (alterações só por aditivo).")) rodar(() => acaoConfirmarContrato(c.id, versao), undefined, "Planilha confirmada: contrato vigente."); }}
              className="rounded-md bg-marca-600 px-3 py-1.5 font-medium text-white disabled:opacity-50">Confirmar planilha</button>
          )}
          {podeGerenciar && !emCadastro && (
            <button disabled={pendente} onClick={() => { if (window.confirm("Reabrir a planilha para correções? Ela volta a ficar editável até nova confirmação.")) rodar(() => acaoReabrirContrato(c.id), undefined, "Planilha reaberta para correções."); }}
              className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-50">Reabrir planilha</button>
          )}
          {podeGerenciar && emCadastro && (
            <button disabled={pendente} onClick={() => { if (window.confirm(`Excluir em definitivo o contrato ${c.numero} e a sua planilha?`)) rodar(() => acaoExcluirContrato(c.id), () => router.push("/contratos")); }}
              className="rounded-md border border-red-300 px-3 py-1.5 text-red-700 hover:bg-red-50 disabled:opacity-50">Excluir contrato</button>
          )}
        </div>
      </div>

      {erro && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{erro}</p>}
      {aviso && <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">{aviso}</p>}

      <section className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Valor contratado</p><p className="text-lg font-semibold">{moeda(estado.totais.contratado)}</p></div>
        {estado.totais.orcado && <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Valor orçado</p><p className="text-lg font-semibold">{moeda(estado.totais.orcado)}</p></div>}
        {estado.totais.desconto && <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Desconto sobre o orçado</p><p className="text-lg font-semibold">{Number(estado.totais.desconto).toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%</p></div>}
        <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Itens</p><p className="text-lg font-semibold">{estado.totais.itens}</p></div>
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-medium">Dados do contrato</h2>
          {podeEditar && !editandoDados && <button onClick={() => setEditandoDados(true)} className="text-sm text-marca-700 underline">Editar dados</button>}
        </div>
        {editandoDados ? (
          <>
            <CamposContrato valor={form} onChange={setForm} />
            <div className="flex gap-2">
              <button disabled={pendente} onClick={() => rodar(() => acaoAlterarDadosContrato(c.id, versao, paraAcao(form)), (v) => { setVersao(v); setEditandoDados(false); }, "Dados do contrato salvos.")}
                className="rounded-md bg-marca-600 px-3 py-1.5 text-sm text-white disabled:opacity-50">Salvar dados</button>
              <button onClick={() => { setForm(paraForm(c)); setEditandoDados(false); }} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm">Cancelar</button>
            </div>
          </>
        ) : (
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
            <div><dt className="inline font-medium">Empresa: </dt><dd className="inline">{c.empresa ?? "—"}{c.cnpj ? ` (CNPJ ${c.cnpj})` : ""}</dd></div>
            <div><dt className="inline font-medium">Processo: </dt><dd className="inline">{c.processo ?? "—"}</dd></div>
            <div><dt className="inline font-medium">Endereço: </dt><dd className="inline">{c.endereco ?? "—"}</dd></div>
            <div><dt className="inline font-medium">Assinatura: </dt><dd className="inline">{dataBr(c.dataAssinatura)}</dd></div>
            <div><dt className="inline font-medium">Prazo contratual: </dt><dd className="inline">{c.prazoVigenciaDias ? `${c.prazoVigenciaDias} dias` : "—"}</dd></div>
            <div><dt className="inline font-medium">Término da vigência: </dt><dd className="inline">{dataBr(prazos.terminoVigencia)}</dd></div>
            <div><dt className="inline font-medium">Ordem de serviço: </dt><dd className="inline">{dataBr(c.dataOs)}</dd></div>
            <div><dt className="inline font-medium">Prazo de execução: </dt><dd className="inline">{c.prazoExecucaoDias ? `${c.prazoExecucaoDias} dias` : "—"}</dd></div>
            <div><dt className="inline font-medium">Término da execução: </dt><dd className="inline">{dataBr(prazos.terminoExecucao)}</dd></div>
            {prazos.execucaoAlemDaVigencia && <p className="text-amber-800 sm:col-span-3">⚠ A execução termina depois do fim da vigência do contrato.</p>}
            <div><dt className="inline font-medium">Responsável técnico: </dt><dd className="inline">{c.responsavelTecnico ?? "—"}</dd></div>
            <div><dt className="inline font-medium">ART/RRT: </dt><dd className="inline">{c.artRrt ?? "—"}</dd></div>
            <div><dt className="inline font-medium">Contato: </dt><dd className="inline">{[c.emailContato, c.telefoneContato].filter(Boolean).join(" · ") || "—"}</dd></div>
            <div className="sm:col-span-3"><dt className="inline font-medium">Origem da planilha: </dt><dd className="inline">
              {c.origem === "ORCAMENTO"
                ? <>orçamento {c.revisaoId ? <Link href={`/orcamentos/revisao/${c.revisaoId}`} className="text-marca-700 underline">{c.orcamento}</Link> : "(excluído)"}{c.referencia ? ` · ${c.referencia}` : ""}{c.bdiPercentual ? ` · BDI ${Number(c.bdiPercentual).toLocaleString("pt-BR")}%` : ""}</>
                : <>planilha importada da proposta ({c.arquivoOrigem}) — preços exatamente como no arquivo</>}
            </dd></div>
          </dl>
        )}
      </section>

      {editaPreco && (
        <section className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm">
          <label>Desconto linear da proposta (%)
            <input value={desconto} onChange={(e) => setDesconto(e.target.value)} inputMode="decimal" placeholder="ex.: 8,5" aria-label="Desconto linear (%)" className="mt-1 block w-32 rounded-md border border-slate-300 px-2 py-1.5" />
          </label>
          <label>Preço resultante
            <select value={modo} onChange={(e) => setModo(e.target.value)} className="mt-1 block rounded-md border border-slate-300 px-2 py-1.5">
              <option value="ARREDONDAR">arredondado (2 casas)</option>
              <option value="TRUNCAR">truncado (2 casas)</option>
            </select>
          </label>
          <button disabled={pendente || !desconto.trim()} onClick={() => { if (window.confirm(`Aplicar ${desconto}% de desconto sobre o preço orçado de todos os itens? Os preços contratados digitados serão substituídos.`)) rodar(() => acaoDescontoLinear(c.id, versao, desconto, modo), (v) => setVersao(v), "Desconto aplicado a todos os itens."); }}
            className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-50">Aplicar a todos os itens</button>
          <p className="basis-full text-xs text-slate-500">Preço contratado = preço orçado × (1 − desconto). Ajuste item a item na coluna “Preço contratado”, se a proposta não tiver desconto linear.</p>
        </section>
      )}
      {estado.totais.divergentesArquivo > 0 && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {estado.totais.divergentesArquivo} item(ns) com valor total do arquivo diferente de quantidade × preço unitário (diferença acima de R$ 0,01). Foi mantido o valor da proposta; confira os itens marcados com ⚠.
        </p>
      )}

      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-2 py-2">Item</th><th>Código</th><th>Descrição</th><th>Unid.</th><th className="text-right">Quant.</th>
              {c.origem === "ORCAMENTO" && <th className="text-right">Preço orçado</th>}
              <th className="text-right">Preço {c.origem === "ORCAMENTO" ? "contratado" : "unitário"}</th><th className="px-2 text-right">Total (R$)</th>
            </tr>
          </thead>
          <tbody>
            {estado.grupos.map((g) => (
              <Fragment key={g.id}>
                <tr className={g.nivel === 0 ? "bg-slate-100 font-semibold" : "bg-slate-50 font-medium"}>
                  <td className="px-2 py-1.5">{g.numero}</td>
                  <td colSpan={colunas - 2} className="py-1.5">{g.titulo}</td>
                  <td className="num px-2 py-1.5">{moeda(g.total).replace("R$", "").trim()}</td>
                </tr>
                {itensDe(g.id).map((it) => {
                  const divergente = it.valorTotalArquivo !== null && Math.abs(Number(it.valorTotalArquivo) - Number(it.quantidade) * Number(it.precoUnitario)) > 0.0100001;
                  return (
                    <tr key={it.id} className="border-t border-slate-100 align-top">
                      <td className="px-2 py-1">{it.numero ?? it.ordem}</td>
                      <td className="whitespace-nowrap font-mono text-xs">{it.fonte && c.origem === "ORCAMENTO" ? `${it.fonte} ` : ""}{it.codigo ?? "—"}</td>
                      <td className="max-w-xl py-1">
                        {it.descricao}
                        {it.memoriaQuantitativo && <span className="block text-xs text-slate-500">Memória: {it.memoriaQuantitativo}</span>}
                      </td>
                      <td>{it.unidade ?? "—"}</td>
                      <td className="num">{qtd(it.quantidade)}</td>
                      {c.origem === "ORCAMENTO" && <td className="num text-slate-500">{preco(it.precoOrcado)}</td>}
                      <td className="num">
                        {editaPreco ? (
                          <input key={`${it.id}-${it.precoUnitario}`} defaultValue={preco(it.precoUnitario)} inputMode="decimal" aria-label={`Preço contratado ${it.numero ?? it.ordem}`}
                            onBlur={(e) => salvarPreco(it, e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                            className="w-28 rounded border border-slate-300 px-2 py-0.5 text-right" />
                        ) : preco(it.precoUnitario)}
                      </td>
                      <td className="num px-2" title={divergente ? `Valor no arquivo: ${moeda(it.valorTotalArquivo)}; quantidade × preço = ${moeda((Number(it.quantidade) * Number(it.precoUnitario)).toFixed(2))}` : undefined}>
                        {divergente && <span className="mr-1 text-amber-700">⚠</span>}{moeda(it.valorTotal).replace("R$", "").trim()}
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
            <tr className="border-t-2 border-slate-300 font-semibold">
              <td colSpan={colunas - 1} className="px-2 py-2 text-right">TOTAL CONTRATADO</td>
              <td className="num px-2 py-2">{moeda(estado.totais.contratado).replace("R$", "").trim()}</td>
            </tr>
          </tbody>
        </table>
      </section>
      {c.situacao === "VIGENTE" && <p className="text-sm text-slate-500">Próximas etapas do módulo: lançamento das medições, aditivos e reajustamentos a partir desta planilha.</p>}
    </div>
  );
}
