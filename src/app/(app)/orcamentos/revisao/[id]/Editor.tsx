"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import { SeloFonte } from "@/components/SeloFonte";
import { dec, formatarMoeda, formatarNumero, lerNumero, type Dec } from "@/lib/calculo/decimal";
import { avaliarMemoria } from "@/lib/calculo/expressao";
import type { EstadoRevisao, EtapaLinha, LinhaItem } from "@/lib/orcamento/servico";
import {
  acaoAdicionarItem, acaoAlterarItem, acaoBuscarParaOrcamento, acaoConfigurar, acaoCriarEtapa, acaoDuplicar, acaoExcluirEtapa, acaoExcluirItem, acaoTrocarItem,
  acaoAtualizarBdi, acaoFechar, acaoMoverEtapa, acaoMoverItem, acaoNovaRevisao, acaoRenomearEtapa, acaoReprecificar, type Resultado,
} from "../../acoes";

export interface BaseOpcao { revisaoId: string; fonte: string; rotulo: string; regimes: { codigo: string; nome: string }[] }
interface Perfil { id: string; nome: string; bdi: string }
type Achado = Extract<Awaited<ReturnType<typeof acaoBuscarParaOrcamento>>, { ok: true }>["dados"]["itens"][number];

/** Quantidade com no mínimo 2 casas decimais (até 4, se houver: nada é escondido). */
const qtd = (v: string | Dec) => {
  const d = dec(v);
  return formatarNumero(d, Math.min(Math.max(d.decimalPlaces(), 2), 4));
};
const pct = (v: string | null) => (v === null ? "—" : `${formatarNumero(v, 2)}%`);

/** Calcula a expressão da memória: quantidade (texto pt-BR, até 4 casas) ou motivo de não calcular. */
export function quantidadeDaMemoria(texto: string): { quantidade: string | null; exibir: string | null; aviso: string | null; erro: string | null } {
  try {
    const r = avaliarMemoria(texto);
    if (!r) return { quantidade: null, exibir: null, aviso: null, erro: null };
    if (r.valor.isNegative()) return { quantidade: null, exibir: null, aviso: null, erro: "O resultado da conta é negativo." };
    const q = r.valor.toDecimalPlaces(4);
    const avisos: string[] = [];
    if (!q.eq(r.valor)) avisos.push("resultado arredondado para 4 casas decimais");
    if (r.escrito && !r.escrito.eq(r.valor)) avisos.push(`o resultado escrito após "=" (${formatarNumero(r.escrito, Math.min(r.escrito.decimalPlaces(), 4))}) difere do calculado`);
    const exibir = qtd(q);
    return { quantidade: exibir, exibir, aviso: avisos.length ? avisos.join("; ") : null, erro: null };
  } catch (e) {
    return { quantidade: null, exibir: null, aviso: null, erro: `Não foi possível calcular a conta: ${(e as Error).message}` };
  }
}

export function Editor({ estado, perfis, bases, podeEditar, podeRelatorios }: { estado: EstadoRevisao; perfis: Perfil[]; bases: BaseOpcao[]; podeEditar: boolean; podeRelatorios: boolean }) {
  const router = useRouter();
  const [versao, setVersao] = useState(estado.revisao.versao);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const [adicionandoEm, setAdicionandoEm] = useState<string | null>(null);
  const [config, setConfig] = useState(false);
  const [memoria, setMemoria] = useState<string | null>(null);
  const [trocando, setTrocando] = useState<string | null>(null);
  useEffect(() => setVersao(estado.revisao.versao), [estado.revisao.versao]);

  const aberta = estado.revisao.status === "EM_ELABORACAO" && podeEditar;
  const r = estado.revisao;

  /** Executa uma ação, atualiza a versão e recarrega os dados do servidor. */
  function rodar<T>(f: () => Promise<Resultado<T>>, depois?: (d: T) => void) {
    setErro(null);
    setAviso(null);
    iniciar(async () => {
      const res = await f();
      if (!res.ok) { setErro(res.erro); router.refresh(); return; }
      const d = res.dados as unknown;
      if (typeof d === "number") setVersao(d);
      else if (d && typeof d === "object" && "versao" in d && typeof (d as { versao: unknown }).versao === "number") setVersao((d as { versao: number }).versao);
      depois?.(res.dados);
      router.refresh();
    });
  }

  const filhas = (paiId: string | null) => estado.etapas.filter((e) => e.paiId === paiId).sort((a, b) => a.ordem - b.ordem);
  const itensDe = (etapaId: string) => estado.itens.filter((i) => i.etapaId === etapaId).sort((a, b) => a.ordem - b.ordem);
  const baseDaFonte = (fonte: string) => estado.basesPadrao.find((b) => b.fonte === fonte);

  const novaEtapa = (paiId: string | null) => {
    const t = window.prompt(paiId ? "Título da subetapa:" : "Título da etapa:");
    if (t) rodar(() => acaoCriarEtapa(r.id, versao, paiId, t));
  };

  function linhaEtapa(e: EtapaLinha, nivel: number): React.ReactNode {
    return (
      <Fragment key={e.id}>
        <tr className={nivel === 0 ? "bg-slate-100 font-semibold" : "bg-slate-50 font-medium"}>
          <td className="py-2 pl-2">{e.numero}</td>
          <td colSpan={8} style={{ paddingLeft: `${nivel * 1}rem` }}>{e.titulo}</td>
          <td className="num">{formatarMoeda(e.total)}</td>
          <td className="whitespace-nowrap text-xs font-normal">
            {aberta && (
              <>
                <button className="text-marca-700 underline" onClick={() => setAdicionandoEm(e.id)}>+ item</button>{" "}
                <button className="text-marca-700 underline" onClick={() => novaEtapa(e.id)}>+ subetapa</button>{" "}
                <span className="ml-2 inline-flex items-center gap-3 align-middle text-2xl font-normal leading-none">
                <button title="Renomear" aria-label={`Renomear ${e.titulo}`} onClick={() => { const t = window.prompt("Novo título:", e.titulo); if (t) rodar(() => acaoRenomearEtapa(r.id, versao, e.id, t)); }}>✎</button>
                <button title="Subir" aria-label={`Subir ${e.titulo}`} onClick={() => rodar(() => acaoMoverEtapa(r.id, versao, e.id, -1))}>↑</button>
                <button title="Descer" aria-label={`Descer ${e.titulo}`} onClick={() => rodar(() => acaoMoverEtapa(r.id, versao, e.id, 1))}>↓</button>
                <button title="Excluir" aria-label={`Excluir ${e.titulo}`} className="text-red-700" onClick={() => { if (window.confirm(`Excluir a etapa "${e.titulo}" com todas as subetapas e itens?`)) rodar(() => acaoExcluirEtapa(r.id, versao, e.id)); }}>✕</button>
                </span>
              </>
            )}
          </td>
        </tr>
        {filhas(e.id).map((f) => linhaEtapa(f, nivel + 1))}
        {itensDe(e.id).map((i) => linhaItem(i))}
        {adicionandoEm === e.id && (
          <tr><td colSpan={11} className="bg-marca-50 p-3">
            <AdicionarItem revisaoId={r.id} bases={estado.basesPadrao} aoCancelar={() => setAdicionandoEm(null)}
              aoAdicionar={(achado, quantidade, memoriaQtd) => rodar(() => acaoAdicionarItem(r.id, versao, {
                etapaId: e.id, itemReferenciaId: achado.itemId, quantidade, memoriaQuantitativo: memoriaQtd || null, base: null,
              }), () => { setAviso(`${achado.codigo} adicionado.`); setAdicionandoEm(null); })} />
          </td></tr>
        )}
      </Fragment>
    );
  }

  function linhaItem(i: LinhaItem) {
    const padrao = baseDaFonte(i.fonte);
    const outraBase = i.fonte !== "PROPRIA" && padrao && (padrao.baseRevisaoId !== i.baseRevisaoId || padrao.regime !== i.regime);
    return (
      <Fragment key={i.id}>
        <tr className="border-t border-slate-100 align-top">
          <td className="py-1 pl-2 text-xs">{i.numero}</td>
          <td><SeloFonte fonte={i.fonte} /></td>
          <td className="whitespace-nowrap font-mono text-xs">
            {i.itemReferenciaId
              ? <Link className="text-marca-700 hover:underline" href={`/consulta/item/${i.itemReferenciaId}${i.baseRevisaoId ? `?b_${i.fonte}=${i.baseRevisaoId}${i.regime ? `&r_${i.fonte}=${i.regime}` : ""}` : ""}`} target="_blank">{i.codigo}</Link>
              : <span title="Item sem vínculo com base de referência (preço informado). Use ✎ para trocar por um código da base.">{i.codigo || "—"}</span>}
            {aberta && <button title="Editar código (trocar o serviço/insumo)" aria-label={`Editar código do item ${i.numero}`} className="ml-1 font-sans text-slate-500 hover:text-marca-700" onClick={() => setTrocando(trocando === i.id ? null : i.id)}>✎</button>}
          </td>
          <td className="text-sm">
            {i.descricao}
            <div className="text-xs text-slate-500">{i.referenciaPreco}{outraBase && <span className="text-amber-700"> · base/regime diferente do padrão</span>}</div>
            {i.pendencia && <div className="text-xs text-amber-800">⚠ {i.pendencia}</div>}
          </td>
          <td className="text-xs">{i.unidade || <em className="text-amber-700">s/ unid.</em>}</td>
          <td className="num">
            {aberta ? <CampoQuantidade valor={i.quantidade} rotulo={`Quantidade ${i.numero}`} aoSalvar={(q) => rodar(() => acaoAlterarItem(r.id, versao, i.id, { quantidade: q }))} /> : qtd(i.quantidade)}
          </td>
          <td className="num text-sm">
            {aberta && !i.itemReferenciaId
              ? <CampoQuantidade valor={i.custoUnitario} rotulo={`Custo unitário ${i.numero}`} aoSalvar={(c) => rodar(() => acaoAlterarItem(r.id, versao, i.id, { custoInformado: c }))} />
              : formatarMoeda(i.custoUnitario)}
          </td>
          <td className="text-xs">
            {aberta ? (
              <BdiDoItem item={i} perfis={perfis} bdiGlobal={r.bdiPercentual ?? "0"}
                aoEscolher={(d) => rodar(() => acaoAlterarItem(r.id, versao, i.id, d))} />
            ) : pct(i.bdiPercentual)}
            {aberta && (i.bdiPerfilId || (i.bdiInformado && !dec(i.bdiPercentual).isZero())) && <div className="text-slate-500">{pct(i.bdiPercentual)}</div>}
          </td>
          <td className="num text-sm">{formatarMoeda(i.precoUnitario)}</td>
          <td className="num text-sm font-medium">{formatarMoeda(i.precoTotal)}</td>
          <td className="whitespace-nowrap pl-2">
            <div className="flex items-center gap-3 text-2xl leading-none">
            <button title="Como o preço foi calculado" aria-label={`Cálculo do preço ${i.numero}`} onClick={() => setMemoria(memoria === i.id ? null : i.id)}>ⓘ</button>
            {aberta && (
              <>
                <button title="Subir" aria-label={`Subir item ${i.numero}`} onClick={() => rodar(() => acaoMoverItem(r.id, versao, i.id, -1))}>↑</button>
                <button title="Descer" aria-label={`Descer item ${i.numero}`} onClick={() => rodar(() => acaoMoverItem(r.id, versao, i.id, 1))}>↓</button>
                {i.fonte !== "PROPRIA" && i.itemReferenciaId && <TrocarBase item={i} bases={bases.filter((b) => b.fonte === i.fonte)} aoTrocar={(b) => rodar(() => acaoAlterarItem(r.id, versao, i.id, { base: b }))} />}
                <button title="Excluir" aria-label={`Excluir item ${i.numero}`} className="text-red-700" onClick={() => { if (window.confirm(`Excluir o item ${i.numero} (${i.codigo})?`)) rodar(() => acaoExcluirItem(r.id, versao, i.id)); }}>✕</button>
              </>
            )}
            </div>
          </td>
        </tr>
        {(i.memoriaQuantitativo || aberta) && (
          <tr>
            <td />
            <td colSpan={10} className="pb-2 pr-3">
              <MemoriaQuantitativo item={i} editavel={aberta} aoSalvar={(texto, quantidade) => rodar(() => acaoAlterarItem(r.id, versao, i.id, { memoriaQuantitativo: texto, ...(quantidade ? { quantidade } : {}) }))} />
            </td>
          </tr>
        )}
        {trocando === i.id && (
          <tr><td colSpan={11} className="bg-marca-50 p-3">
            <TrocarCodigo revisaoId={r.id} item={i} aoCancelar={() => setTrocando(null)}
              aoEscolher={(achado) => rodar(() => acaoTrocarItem(r.id, versao, i.id, achado.itemId), () => { setAviso(`Item ${i.numero}: código ${i.codigo} trocado por ${achado.codigo}.`); setTrocando(null); })} />
          </td></tr>
        )}
        {memoria === i.id && <tr><td colSpan={11} className="bg-slate-50 px-3 py-2 text-xs text-slate-700"><strong>Cálculo do preço:</strong> {i.memoriaCalculo}</td></tr>}
      </Fragment>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500"><Link href="/orcamentos" className="underline">Orçamentos</Link> · <Link href={`/orcamentos/obra/${estado.orcamento.obraId}`} className="hover:underline" title="Editar dados da obra">{estado.orcamento.obraCodigo ? `${estado.orcamento.obraCodigo} · ` : ""}{estado.orcamento.obraNome}</Link>{estado.orcamento.orgaoSolicitante ? ` — ${estado.orcamento.orgaoSolicitante}` : ""}{estado.orcamento.processo ? ` · Processo ${estado.orcamento.processo}` : ""}</p>
          <h1 className="text-2xl font-semibold">{estado.orcamento.codigo ? `${estado.orcamento.codigo} — ` : ""}{estado.orcamento.titulo}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <span>Revisão</span>
            {estado.revisoes.map((x) => (
              <Link key={x.id} href={`/orcamentos/revisao/${x.id}`} className={`rounded px-2 py-0.5 ${x.id === r.id ? "bg-marca-600 text-white" : "bg-slate-100 hover:bg-slate-200"}`} title={x.descricao ?? ""}>
                {x.numero}{x.status === "FECHADA" ? " 🔒" : ""}
              </Link>
            ))}
            <span className={`rounded px-2 py-0.5 text-xs ${r.status === "FECHADA" ? "bg-slate-200 text-slate-700" : "bg-green-100 text-green-800"}`}>
              {r.status === "FECHADA" ? `Fechada em ${r.fechadaEm}${r.fechadaPor ? ` por ${r.fechadaPor}` : ""}` : "Em elaboração"}
            </span>
            {r.descricao && <span className="text-slate-500">— {r.descricao}</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          {podeRelatorios && <Link href={`/orcamentos/revisao/${r.id}/relatorios`} className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50">Relatórios</Link>}
          <Link href={`/orcamentos/revisao/${r.id}/cronograma`} className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50">Cronograma</Link>
        {podeEditar && (
          <>
            {aberta && <button disabled={pendente} onClick={() => setConfig(!config)} className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50">Configurações</button>}
            {aberta && <button disabled={pendente} onClick={() => { if (window.confirm("Fechar a revisão? Os valores ficarão registrados e não poderão mais ser alterados.")) rodar(() => acaoFechar(r.id, versao)); }} className="rounded-md bg-slate-800 px-3 py-1.5 text-white">Fechar revisão</button>}
            {r.status === "FECHADA" && !estado.revisoes.some((x) => x.status === "EM_ELABORACAO") && <NovaRevisao origem={r.id} bases={bases} padrao={estado.basesPadrao} aoCriar={(id) => router.push(`/orcamentos/revisao/${id}`)} setErro={setErro} />}
            <button disabled={pendente} onClick={() => { const t = window.prompt("Título do novo orçamento (cópia desta revisão):", `${estado.orcamento.titulo} — cópia`); if (t) rodar(() => acaoDuplicar(r.id, t), (d) => router.push(`/orcamentos/revisao/${d.revisaoId}`)); }} className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50">Duplicar</button>
            {estado.revisoes.length > 1 && (
              <select aria-label="Comparar com" className="rounded-md border border-slate-300 px-2 py-1.5" value="" onChange={(e) => e.target.value && router.push(`/orcamentos/comparar?a=${e.target.value}&b=${r.id}`)}>
                <option value="">Comparar com…</option>
                {estado.revisoes.filter((x) => x.id !== r.id).map((x) => <option key={x.id} value={x.id}>Revisão {x.numero}</option>)}
              </select>
            )}
          </>
        )}
        </div>
      </div>

      {erro && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">{erro}</p>}
      {estado.divergenciasBdi.length > 0 && (
        <div role="status" className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">O BDI foi alterado na aba BDI depois de aplicado neste orçamento.</p>
          <ul className="mt-1 list-disc pl-5">
            {estado.divergenciasBdi.map((d) => (
              <li key={d.perfilId}>
                Perfil “{d.nome}”: este orçamento usa {d.aplicado.map((x) => `${x.replace(".", ",")}%`).join(" / ")}{d.global ? " (BDI global)" : ""}{d.itens ? ` em ${d.itens} item(ns)` : ""}; o perfil agora é {d.atual.replace(".", ",")}%.
              </li>
            ))}
          </ul>
          <p className="mt-1">Os preços continuam calculados com o percentual antigo. A revisão só pode ser fechada depois de atualizar.</p>
          {aberta && podeEditar && (
            <button disabled={pendente} onClick={() => { if (window.confirm("Atualizar o BDI de todos os itens para o percentual atual dos perfis?")) rodar(() => acaoAtualizarBdi(r.id, versao), () => setAviso("BDI atualizado e itens recalculados.")); }}
              className="mt-2 rounded-md bg-amber-700 px-3 py-1.5 text-white disabled:opacity-50">Atualizar BDI</button>
          )}
        </div>
      )}
      {aviso && <p role="status" className="rounded-md bg-green-50 px-4 py-2 text-sm text-green-800">{aviso}</p>}
      {pendente && <p className="text-xs text-slate-500" aria-live="polite">Salvando…</p>}

      <section className="grid gap-3 sm:grid-cols-4">
        <Total rotulo="Custo direto" valor={formatarMoeda(estado.totais.custoDireto)} />
        <Total rotulo="BDI" valor={formatarMoeda(estado.totais.bdi)} />
        <Total rotulo="Total do orçamento" valor={formatarMoeda(estado.totais.total)} destaque />
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-600">
          <p>Bases: {estado.basesPadrao.map((b) => `${b.fonte} ${b.competencia.split("-").reverse().join("/")}${b.numeroBase ? ` ret.${b.numeroBase}` : ""} (${b.regimeNome})`).join("; ") || "—"}</p>
          <p>BDI global: {pct(r.bdiPercentual)} · {r.arredondamento === "TRUNCAR" ? "truncamento" : "arredondamento"} a 2 casas</p>
          {estado.totais.pendencias > 0 && <p className="text-amber-800">⚠ {estado.totais.pendencias} item(ns) com pendência</p>}
        </div>
      </section>

      {config && aberta && <Configuracoes estado={estado} versao={versao} perfis={perfis} bases={bases} rodar={rodar} aoFechar={() => setConfig(false)} />}

      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr><th className="py-2 pl-2">Item</th><th>Fonte</th><th>Código</th><th>Descrição</th><th>Unid.</th><th className="text-right">Quant.</th><th className="text-right">Custo unit.</th><th>BDI</th><th className="text-right">Preço unit.</th><th className="text-right">Total</th><th /></tr>
          </thead>
          <tbody>
            {filhas(null).map((e) => linhaEtapa(e, 0))}
            {estado.etapas.length === 0 && <tr><td colSpan={11} className="p-4 text-slate-500">Nenhuma etapa. {aberta ? "Comece criando a primeira etapa." : ""}</td></tr>}
          </tbody>
        </table>
        {aberta && <div className="border-t border-slate-100 p-3"><button onClick={() => novaEtapa(null)} className="text-sm text-marca-700 underline">+ Nova etapa</button></div>}
      </section>
    </div>
  );
}

function Total({ rotulo, valor, destaque }: { rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">{rotulo}</p>
      <p className={`mt-1 font-semibold ${destaque ? "text-xl text-marca-900" : "text-lg"}`}>{valor}</p>
    </div>
  );
}

/** BDI do item: global, um perfil cadastrado, sem BDI (0%) ou percentual digitado. */
function BdiDoItem({ item, perfis, bdiGlobal, aoEscolher }: { item: LinhaItem; perfis: Perfil[]; bdiGlobal: string; aoEscolher: (d: { bdiPerfilId: string | null } | { bdiInformado: string }) => void }) {
  const zero = item.bdiInformado && dec(item.bdiPercentual).isZero();
  const atual = item.bdiPerfilId ?? (zero ? "__zero" : item.bdiInformado ? "__informado" : "");
  const [digitando, setDigitando] = useState(false);
  const [texto, setTexto] = useState("");
  if (digitando) {
    return (
      <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); if (texto.trim()) { aoEscolher({ bdiInformado: texto }); setDigitando(false); } }}>
        <input value={texto} onChange={(e) => setTexto(e.target.value)} inputMode="decimal" autoFocus aria-label={`BDI informado ${item.numero} (%)`}
          onKeyDown={(e) => { if (e.key === "Escape") setDigitando(false); }} className="w-16 rounded border border-slate-300 px-1 py-0.5 text-right" />
        <span>%</span>
        <button type="submit" className="text-marca-700 underline">ok</button>
      </form>
    );
  }
  return (
    <select value={atual} aria-label={`BDI ${item.numero}`} className="max-w-[9rem] rounded border border-slate-300 px-1 py-0.5"
      onChange={(ev) => {
        const v = ev.target.value;
        if (v === "__informar") { setTexto(item.bdiInformado ? formatarNumero(item.bdiPercentual, 2) : ""); setDigitando(true); return; }
        if (v === "__zero") return aoEscolher({ bdiInformado: "0" });
        if (v === "__informado") return;
        aoEscolher({ bdiPerfilId: v || null });
      }}>
      <option value="">Global ({pct(bdiGlobal)})</option>
      {perfis.map((p) => <option key={p.id} value={p.id}>{p.nome} ({pct(p.bdi)})</option>)}
      <option value="__zero">Sem BDI (0%)</option>
      {item.bdiInformado && !zero && <option value="__informado">Informado ({pct(item.bdiPercentual)})</option>}
      <option value="__informar">Informar percentual…</option>
    </select>
  );
}

function CampoQuantidade({ valor, rotulo, aoSalvar }: { valor: string; rotulo: string; aoSalvar: (q: string) => void }) {
  const original = qtd(valor);
  const [texto, setTexto] = useState(original);
  useEffect(() => setTexto(original), [original]);
  const salvar = () => {
    if (!texto.trim() || texto === original) return;
    const n = lerNumero(texto);
    if (n && n.eq(valor)) return setTexto(original); // mesmo valor, só outra escrita: mostra com 2 casas
    aoSalvar(texto);
  };
  return (
    <input value={texto} onChange={(e) => setTexto(e.target.value)} onBlur={salvar} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setTexto(original); }}
      inputMode="decimal" aria-label={rotulo} className="w-24 rounded border border-slate-300 px-1 py-0.5 text-right" />
  );
}

function AdicionarItem({ revisaoId, bases, aoAdicionar, aoCancelar }: { revisaoId: string; bases: EstadoRevisao["basesPadrao"]; aoAdicionar: (a: Achado, q: string, memoria: string) => void; aoCancelar: () => void }) {
  const [busca, setBusca] = useState("");
  const [memoriaQtd, setMemoriaQtd] = useState("");
  const [achados, setAchados] = useState<Achado[]>([]);
  const [total, setTotal] = useState(0);
  const [escolhido, setEscolhido] = useState<Achado | null>(null);
  const [quantidade, setQuantidade] = useState("");
  const [carregando, setCarregando] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (t.current) clearTimeout(t.current);
    if (busca.trim().length < 2) { setAchados([]); return; }
    t.current = setTimeout(async () => {
      setCarregando(true);
      const r = await acaoBuscarParaOrcamento(revisaoId, busca);
      setCarregando(false);
      if (r.ok) { setAchados(r.dados.itens); setTotal(r.dados.total); }
    }, 300);
  }, [busca, revisaoId]);
  return (
    <div className="space-y-2">
      {!escolhido ? (
        <>
          <div className="flex gap-2">
            <input autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar serviço ou insumo por código ou descrição (bases do orçamento + próprios)"
              aria-label="Buscar serviço" className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm" />
            <button onClick={aoCancelar} className="rounded-md border border-slate-300 px-3 text-sm">Cancelar</button>
          </div>
          <p className="text-xs text-slate-500">
            Somente itens com preço no regime adotado: {bases.map((b) => `${b.fonte} — ${b.regimeNome}`).join("; ")}.
            {carregando ? " Buscando…" : busca.trim().length >= 2 ? ` ${total} encontrado(s)${total > achados.length ? `, mostrando ${achados.length}; refine a busca` : ""}.` : ""}
          </p>
          {achados.length > 0 && (
            <ul className="max-h-72 overflow-auto rounded-md border border-slate-200 bg-white" role="listbox">
              {achados.map((a) => (
                <li key={a.itemId}>
                  <button role="option" aria-selected="false" onClick={() => setEscolhido(a)} className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-marca-50">
                    <SeloFonte fonte={a.fonte} />
                    <span className="font-mono">{a.codigo}</span>
                    <span className="flex-1">{a.descricao} <span className="text-slate-500">({a.unidade ?? "s/ unid."})</span></span>
                    <span className="whitespace-nowrap text-xs">
                      {a.fonte === "PROPRIA" ? "calculado" : a.preco ? formatarMoeda(a.preco) : <span className="text-amber-700">sem preço</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <SeloFonte fonte={escolhido.fonte} /><span className="font-mono">{escolhido.codigo}</span><span>{escolhido.descricao}</span>
          <label className="flex items-center gap-1">Quantidade ({escolhido.unidade ?? "s/ unid."})
            <input autoFocus value={quantidade} onChange={(e) => setQuantidade(e.target.value)} inputMode="decimal" aria-label="Quantidade do novo item"
              onKeyDown={(e) => { if (e.key === "Enter" && quantidade.trim()) aoAdicionar(escolhido, quantidade, memoriaQtd); }}
              className="w-28 rounded border border-slate-300 px-2 py-1 text-right" />
          </label>
          <label className="flex w-full flex-col gap-1">
            <span>Memória de cálculo do quantitativo <span className="text-slate-500">(opcional — como se chegou à quantidade)</span></span>
            <textarea value={memoriaQtd} rows={2} maxLength={4000} aria-label="Memória de cálculo do novo item"
              onChange={(e) => { setMemoriaQtd(e.target.value); const c = quantidadeDaMemoria(e.target.value); if (c.quantidade) setQuantidade(c.quantidade); }}
              placeholder="Ex.: (30 m comprimento + 20 m largura) × 2 (perímetro) × 2 m altura = 200 m²" className="rounded border border-slate-300 px-2 py-1" />
            <ResultadoMemoria texto={memoriaQtd} />
          </label>
          <button disabled={!quantidade.trim()} onClick={() => aoAdicionar(escolhido, quantidade, memoriaQtd)} className="rounded-md bg-marca-600 px-3 py-1.5 text-white disabled:opacity-50">Adicionar</button>
          <button onClick={() => setEscolhido(null)} className="rounded-md border border-slate-300 px-3 py-1.5">Voltar</button>
        </div>
      )}
    </div>
  );
}

/** Busca do novo código para um item já lançado (mesmas regras de base/regime da inclusão). */
function TrocarCodigo({ revisaoId, item, aoEscolher, aoCancelar }: { revisaoId: string; item: LinhaItem; aoEscolher: (a: Achado) => void; aoCancelar: () => void }) {
  const [busca, setBusca] = useState(item.codigo);
  const [achados, setAchados] = useState<Achado[]>([]);
  const [total, setTotal] = useState(0);
  const [carregando, setCarregando] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (t.current) clearTimeout(t.current);
    if (busca.trim().length < 2) { setAchados([]); return; }
    t.current = setTimeout(async () => {
      setCarregando(true);
      const r = await acaoBuscarParaOrcamento(revisaoId, busca);
      setCarregando(false);
      if (r.ok) { setAchados(r.dados.itens); setTotal(r.dados.total); }
    }, 300);
  }, [busca, revisaoId]);
  const escolher = (a: Achado) => {
    if (a.itemId === item.itemReferenciaId) return aoCancelar();
    const unidade = a.unidade ?? "";
    const aviso = unidade.toUpperCase() !== (item.unidade ?? "").toUpperCase()
      ? `\n\nAtenção: a unidade muda de ${item.unidade || "(sem unidade)"} para ${unidade || "(sem unidade)"}. A quantidade (${qtd(item.quantidade)}) e a memória de cálculo serão mantidas — confira.`
      : "";
    if (window.confirm(`Trocar o código do item ${item.numero} de ${item.codigo} para ${a.codigo}?\n\n${a.descricao}${aviso}`)) aoEscolher(a);
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} onFocus={(e) => e.target.select()}
          aria-label={`Novo código do item ${item.numero}`} placeholder="Digite o novo código ou parte da descrição"
          onKeyDown={(e) => { if (e.key === "Escape") aoCancelar(); }}
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 font-mono text-sm" />
        <button onClick={aoCancelar} className="rounded-md border border-slate-300 px-3 text-sm">Cancelar</button>
      </div>
      <p className="text-xs text-slate-500">
        Editar o código do item {item.numero}: escolha o novo serviço/insumo. Quantidade, memória de cálculo, BDI e posição são mantidos; o preço vem da base padrão da revisão, no regime adotado.
        {carregando ? " Buscando…" : busca.trim().length >= 2 ? ` ${total} encontrado(s)${total > achados.length ? `, mostrando ${achados.length}` : ""}.` : ""}
      </p>
      {achados.length > 0 && (
        <ul className="max-h-72 overflow-auto rounded-md border border-slate-200 bg-white" role="listbox" aria-label="Códigos encontrados">
          {achados.map((a) => (
            <li key={a.itemId}>
              <button role="option" aria-selected={a.itemId === item.itemReferenciaId} onClick={() => escolher(a)}
                className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-marca-50 aria-selected:bg-slate-100">
                <SeloFonte fonte={a.fonte} />
                <span className="font-mono">{a.codigo}</span>
                <span className="flex-1">{a.descricao} <span className="text-slate-500">({a.unidade ?? "s/ unid."})</span>{a.itemId === item.itemReferenciaId && <span className="text-slate-500"> — código atual</span>}</span>
                <span className="whitespace-nowrap text-xs">
                  {a.fonte === "PROPRIA" ? "calculado" : a.preco ? formatarMoeda(a.preco) : <span className="text-amber-700">sem preço</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ResultadoMemoria({ texto }: { texto: string }) {
  const c = quantidadeDaMemoria(texto);
  if (c.erro) return <span role="alert" className="text-xs text-red-700">{c.erro}</span>;
  if (!c.exibir) return texto.trim() ? <span className="text-xs text-slate-500">Sem conta para calcular (apenas texto).</span> : null;
  return (
    <span className="text-xs">
      <span className="font-medium text-green-800">Resultado: {c.exibir}</span> <span className="text-slate-500">(usado como quantidade)</span>
      {c.aviso && <span className="block text-amber-800">⚠ {c.aviso}</span>}
    </span>
  );
}

function MemoriaQuantitativo({ item, editavel, aoSalvar }: { item: LinhaItem; editavel: boolean; aoSalvar: (texto: string | null, quantidade: string | null) => void }) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(item.memoriaQuantitativo ?? "");
  useEffect(() => setTexto(item.memoriaQuantitativo ?? ""), [item.memoriaQuantitativo]);
  if (editando) {
    const calc = quantidadeDaMemoria(texto);
    const salvar = () => {
      if (calc.erro) return;
      setEditando(false);
      const mudouTexto = texto.trim() !== (item.memoriaQuantitativo ?? "");
      const mudouQtd = calc.quantidade !== null && !dec(calc.quantidade.replace(/\./g, "").replace(",", ".")).eq(item.quantidade);
      if (mudouTexto || mudouQtd) aoSalvar(texto.trim() || null, calc.quantidade);
    };
    return (
      <div className="flex flex-col gap-1 text-xs">
        <label htmlFor={`mem-${item.id}`} className="font-medium text-slate-600">Memória de cálculo do quantitativo — item {item.numero}</label>
        <textarea id={`mem-${item.id}`} autoFocus value={texto} rows={3} maxLength={4000} onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") { setTexto(item.memoriaQuantitativo ?? ""); setEditando(false); } if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) salvar(); }}
          placeholder="Ex.: (30 m comprimento + 20 m largura) × 2 (perímetro) × 2 m altura = 200 m²" className="w-full rounded border border-slate-300 px-2 py-1 text-sm" />
        <ResultadoMemoria texto={texto} />
        <p className="text-slate-500">Cada linha é calculada e as linhas são somadas. Unidades e textos entre parênteses são ignorados; use “x” ou “×” para multiplicar e vírgula para decimais.</p>
        <div className="flex gap-2">
          <button onClick={salvar} disabled={!!calc.erro} className="rounded bg-marca-600 px-2 py-0.5 text-white disabled:opacity-50">Salvar memória</button>
          <button onClick={() => { setTexto(item.memoriaQuantitativo ?? ""); setEditando(false); }} className="rounded border border-slate-300 px-2 py-0.5">Cancelar</button>
          <span className="text-slate-500">Ctrl+Enter salva · Esc cancela</span>
        </div>
      </div>
    );
  }
  if (!item.memoriaQuantitativo) {
    return editavel ? <button onClick={() => setEditando(true)} className="text-xs text-marca-700 underline" aria-label={`Adicionar memória de cálculo ${item.numero}`}>+ memória de cálculo do quantitativo</button> : null;
  }
  const calc = quantidadeDaMemoria(item.memoriaQuantitativo);
  const divergente = calc.quantidade !== null && !dec(calc.quantidade.replace(/\./g, "").replace(",", ".")).eq(item.quantidade);
  return (
    <div className="whitespace-pre-wrap rounded bg-amber-50/60 px-2 py-1 text-xs text-slate-700">
      <span className="font-medium">Memória de cálculo:</span> {item.memoriaQuantitativo}
      {calc.exibir && <span className="ml-1 font-medium text-green-800">→ {calc.exibir}</span>}
      {editavel && <> {" "}<button onClick={() => setEditando(true)} className="text-marca-700 underline" aria-label={`Editar memória de cálculo ${item.numero}`}>editar</button></>}
      {calc.aviso && <span className="block text-amber-800">⚠ {calc.aviso}</span>}
      {divergente && <span className="block text-amber-800">⚠ A quantidade lançada ({qtd(item.quantidade)}) difere do resultado da memória ({calc.exibir}).</span>}
      {calc.erro && <span className="block text-red-700">{calc.erro}</span>}
    </div>
  );
}

function TrocarBase({ item, bases, aoTrocar }: { item: LinhaItem; bases: BaseOpcao[]; aoTrocar: (b: { baseRevisaoId: string; regime: string | null }) => void }) {
  const [aberto, setAberto] = useState(false);
  const [base, setBase] = useState(item.baseRevisaoId ?? bases[0]?.revisaoId ?? "");
  const [regime, setRegime] = useState(item.regime ?? "");
  if (!aberto) return <button title="Base/regime deste item" aria-label={`Base do item ${item.numero}`} onClick={() => setAberto(true)}>⇄</button>;
  return (
    <span className="ml-1 inline-flex items-center gap-1 text-xs">
      <select value={base} onChange={(e) => setBase(e.target.value)} className="rounded border border-slate-300" aria-label="Base do item">
        {bases.map((b) => <option key={b.revisaoId} value={b.revisaoId}>{b.rotulo}</option>)}
      </select>
      <select value={regime} onChange={(e) => setRegime(e.target.value)} className="rounded border border-slate-300" aria-label="Regime do item">
        {bases.find((b) => b.revisaoId === base)?.regimes.map((g) => <option key={g.codigo} value={g.codigo}>{g.nome}</option>)}
      </select>
      <button className="text-marca-700 underline" onClick={() => { setAberto(false); aoTrocar({ baseRevisaoId: base, regime }); }}>aplicar</button>
      <button onClick={() => setAberto(false)}>✕</button>
    </span>
  );
}

function Configuracoes({ estado, versao, perfis, bases, rodar, aoFechar }: {
  estado: EstadoRevisao; versao: number; perfis: Perfil[]; bases: BaseOpcao[];
  rodar: <T>(f: () => Promise<Resultado<T>>, depois?: (d: T) => void) => void; aoFechar: () => void;
}) {
  const fontes = [...new Set(bases.map((b) => b.fonte))];
  const [sel, setSel] = useState<Record<string, { usar: boolean; base: string; regime: string }>>(() =>
    Object.fromEntries(fontes.map((f) => {
      const atual = estado.basesPadrao.find((b) => b.fonte === f);
      const b = bases.find((x) => x.revisaoId === atual?.baseRevisaoId) ?? bases.find((x) => x.fonte === f)!;
      return [f, { usar: !!atual, base: b.revisaoId, regime: atual?.regime ?? b.regimes[0]?.codigo ?? "" }];
    })),
  );
  const [bdi, setBdi] = useState(estado.revisao.bdiPerfilId ?? "");
  const [modo, setModo] = useState(estado.revisao.arredondamento);
  const [data, setData] = useState(estado.revisao.dataReferencia);
  const [descricao, setDescricao] = useState(estado.revisao.descricao ?? "");
  return (
    <section className="space-y-3 rounded-xl border border-marca-600 bg-white p-5 text-sm">
      <h2 className="font-medium">Configurações da revisão {estado.revisao.numero}</h2>
      <label className="block">Descrição<input value={descricao} onChange={(e) => setDescricao(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1" /></label>
      {fontes.map((f) => (
        <div key={f} className="flex flex-wrap items-center gap-2">
          <label className="flex w-28 items-center gap-1 font-medium"><input type="checkbox" checked={sel[f].usar} onChange={(e) => setSel({ ...sel, [f]: { ...sel[f], usar: e.target.checked } })} /> {f}</label>
          <select value={sel[f].base} aria-label={`Base padrão ${f}`} onChange={(e) => setSel({ ...sel, [f]: { ...sel[f], base: e.target.value } })} className="rounded border border-slate-300 px-2 py-1">
            {bases.filter((b) => b.fonte === f).map((b) => <option key={b.revisaoId} value={b.revisaoId}>{b.rotulo}</option>)}
          </select>
          <select value={sel[f].regime} aria-label={`Regime padrão ${f}`} onChange={(e) => setSel({ ...sel, [f]: { ...sel[f], regime: e.target.value } })} className="rounded border border-slate-300 px-2 py-1">
            {bases.find((b) => b.revisaoId === sel[f].base)?.regimes.map((g) => <option key={g.codigo} value={g.codigo}>{g.nome}</option>)}
          </select>
        </div>
      ))}
      <div className="grid gap-3 sm:grid-cols-3">
        <label>BDI global
          <select value={bdi} onChange={(e) => setBdi(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1" aria-label="BDI global da revisão">
            <option value="">Sem BDI</option>
            {perfis.map((p) => <option key={p.id} value={p.id}>{p.nome} ({pct(p.bdi)})</option>)}
          </select>
        </label>
        <label>Arredondamento
          <select value={modo} onChange={(e) => setModo(e.target.value as typeof modo)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1">
            <option value="ARREDONDAR">Arredondar</option><option value="TRUNCAR">Truncar</option>
          </select>
        </label>
        <label>Data de referência (cotações próprias)<input type="date" value={data} onChange={(e) => setData(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1" /></label>
      </div>
      <p className="text-xs text-slate-500">Mudar as bases padrão não altera os itens já lançados; use “Reprecificar itens” para aplicá-las. BDI e arredondamento recalculam os itens na hora.</p>
      <div className="flex flex-wrap gap-2">
        <button className="rounded-md bg-marca-600 px-3 py-1.5 text-white" onClick={() => rodar(() => acaoConfigurar(estado.revisao.id, versao, {
          descricao, dataReferencia: data, arredondamento: modo, bdiPerfilId: bdi || null,
          bases: fontes.filter((f) => sel[f].usar).map((f) => ({ baseRevisaoId: sel[f].base, regime: sel[f].regime })),
        }), aoFechar)}>Salvar configurações</button>
        <button className="rounded-md border border-slate-300 px-3 py-1.5" onClick={() => { if (window.confirm("Reprecificar todos os itens com as bases padrão salvas?")) rodar(() => acaoReprecificar(estado.revisao.id, versao), aoFechar); }}>Reprecificar itens com as bases padrão</button>
        <button className="rounded-md border border-slate-300 px-3 py-1.5" onClick={aoFechar}>Fechar painel</button>
      </div>
    </section>
  );
}

function NovaRevisao({ origem, bases, padrao, aoCriar, setErro }: { origem: string; bases: BaseOpcao[]; padrao: EstadoRevisao["basesPadrao"]; aoCriar: (id: string) => void; setErro: (e: string | null) => void }) {
  const [aberto, setAberto] = useState(false);
  const [descricao, setDescricao] = useState("");
  const [atualizar, setAtualizar] = useState(false);
  const fontes = [...new Set(padrao.map((b) => b.fonte))];
  const [sel, setSel] = useState<Record<string, { base: string; regime: string }>>(() =>
    Object.fromEntries(fontes.map((f) => [f, { base: padrao.find((b) => b.fonte === f)!.baseRevisaoId, regime: padrao.find((b) => b.fonte === f)!.regime ?? "" }])),
  );
  const [pendente, iniciar] = useTransition();
  if (!aberto) return <button onClick={() => setAberto(true)} className="rounded-md bg-marca-600 px-3 py-1.5 text-white">Nova revisão</button>;
  return (
    <div className="w-full space-y-2 rounded-xl border border-marca-600 bg-white p-4 text-sm sm:w-[32rem]">
      <label className="block">Descrição da nova revisão<input value={descricao} onChange={(e) => setDescricao(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1" aria-label="Descrição da nova revisão" /></label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={atualizar} onChange={(e) => setAtualizar(e.target.checked)} /> Atualizar preços para outra competência/regime</label>
      {atualizar && fontes.map((f) => (
        <div key={f} className="flex flex-wrap items-center gap-2">
          <span className="w-16 font-medium">{f}</span>
          <select value={sel[f].base} aria-label={`Nova base ${f}`} onChange={(e) => setSel({ ...sel, [f]: { ...sel[f], base: e.target.value } })} className="rounded border border-slate-300 px-2 py-1">
            {bases.filter((b) => b.fonte === f).map((b) => <option key={b.revisaoId} value={b.revisaoId}>{b.rotulo}</option>)}
          </select>
          <select value={sel[f].regime} aria-label={`Novo regime ${f}`} onChange={(e) => setSel({ ...sel, [f]: { ...sel[f], regime: e.target.value } })} className="rounded border border-slate-300 px-2 py-1">
            {bases.find((b) => b.revisaoId === sel[f].base)?.regimes.map((g) => <option key={g.codigo} value={g.codigo}>{g.nome}</option>)}
          </select>
        </div>
      ))}
      <p className="text-xs text-slate-500">A revisão atual permanece fechada e inalterada. Itens sem preço na nova base mantêm o preço anterior e ficam marcados como pendência.</p>
      <div className="flex gap-2">
        <button disabled={pendente} className="rounded-md bg-marca-600 px-3 py-1.5 text-white disabled:opacity-50" onClick={() => iniciar(async () => {
          setErro(null);
          const r = await acaoNovaRevisao(origem, descricao, atualizar ? fontes.map((f) => ({ baseRevisaoId: sel[f].base, regime: sel[f].regime })) : null);
          if (!r.ok) return setErro(r.erro);
          aoCriar(r.dados.revisaoId);
        })}>{pendente ? "Criando…" : "Criar revisão"}</button>
        <button className="rounded-md border border-slate-300 px-3 py-1.5" onClick={() => setAberto(false)}>Cancelar</button>
      </div>
    </div>
  );
}
