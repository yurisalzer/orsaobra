"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  analisarGrade, CAMPOS, fonteCitada, fontePeloCodigo, lerLinhas, montarEstrutura, sugerirMapa, textoDe,
  type Cabecalho, type Campo, type DadosIdentificados, type Grade, type ItemEstruturado, type Mapa,
} from "@/lib/orcamento/importar/analisar";
import type { Candidato } from "@/lib/orcamento/importar/servidor";
import { acaoCriarOrcamento, type DadosNovaObra } from "../acoes";
import { CamposObra, OBRA_VAZIA } from "../CamposObra";
import { acaoConferirCodigos, acaoCriarEtapas, acaoImportarItens } from "./acoes";

interface BaseOpcao { revisaoId: string; fonte: string; competencia: string; rotulo: string; regimes: { codigo: string; nome: string }[] }
interface Props {
  obras: { id: string; nome: string; codigo: string | null; processo: string | null }[];
  bases: BaseOpcao[];
  perfis: { id: string; nome: string; bdi: string }[];
  cabecalhos: { id: string; nome: string; padrao: boolean }[];
}

interface Aba { nome: string; grade: Grade }
interface Leitura { arquivo: string; pdf: boolean; abas: Aba[]; textoExtra: string }
/** escolha = item da base; sem escolha, `informar` inclui o item com o custo digitado pelo usuário. */
interface Decisao { escolha: string | null; importar: boolean; codigo: string; informar: boolean; custo: string }

const PASSOS = ["Arquivo", "Colunas", "Dados do orçamento", "Conferência", "Importação"];
const campo = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const botao = "rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50";
const letra = (i: number) => { let s = ""; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const moeda = (v: string | null) => (v === null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 4 }));
const qtd = (v: string | null) => (v === null ? "—" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 6 }));

/** Quantidade aceita pelo orçamento (até 4 casas): arredonda e avisa. */
function quantidadeAceita(q: string): { valor: string; arredondada: boolean } {
  const casas = q.split(".")[1]?.length ?? 0;
  if (casas <= 4) return { valor: q, arredondada: false };
  const [i, d] = q.replace("-", "").split(".");
  let n = BigInt(i + d.slice(0, 4));
  if (Number(d[4]) >= 5) n += BigInt(1);
  const s = n.toString().padStart(5, "0");
  return { valor: `${s.slice(0, -4)}.${s.slice(-4)}`, arredondada: true };
}

/** Custo do arquivo (sem BDI), na escrita brasileira, para o usuário conferir. */
const custoDoArquivo = (it: ItemEstruturado) => (it.custoUnitario ? it.custoUnitario.replace(".", ",") : "");
/** Custo digitado: número não negativo com até 4 casas (aceita "1.234,56" ou "1234.56"). */
function custoValido(t: string): boolean {
  const s = t.trim().replace(/^R\$\s*/, "");
  if (!s) return false;
  const norm = /,/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s;
  return /^\d+(\.\d{1,4})?$/.test(norm);
}

/** Escolha automática: só candidatos com preço; desempata pela fonte citada no arquivo ou pelo formato do código. */
function escolherCandidato(it: ItemEstruturado, cands: Candidato[]): string | null {
  const comPreco = cands.filter((c) => c.custo);
  if (comPreco.length === 1) return comPreco[0].itemReferenciaId;
  const fonte = fonteCitada(it.fonte) ?? fontePeloCodigo(it.codigo ?? "");
  const daFonte = comPreco.filter((c) => c.fonte === fonte);
  if (daFonte.length === 1) return daFonte[0].itemReferenciaId;
  const exato = (daFonte.length ? daFonte : comPreco).filter((c) => c.codigo.toUpperCase() === (it.codigo ?? "").trim().toUpperCase());
  return exato.length === 1 ? exato[0].itemReferenciaId : null;
}

export function ImportarOrcamento({ obras, bases, perfis, cabecalhos }: Props) {
  const [passo, setPasso] = useState(0);
  const [leitura, setLeitura] = useState<Leitura | null>(null);
  const [aba, setAba] = useState(0);
  const [cab, setCab] = useState<Cabecalho | null>(null);
  const [mapa, setMapa] = useState<Mapa>({});
  const [porTitulo, setPorTitulo] = useState<Campo[]>([]);
  const [dados, setDados] = useState<DadosIdentificados>({ referencias: [] });
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // passo 3 — cadastro
  const fontes = [...new Set(bases.map((b) => b.fonte))];
  const [obraId, setObraId] = useState("");
  const [novaObra, setNovaObra] = useState<DadosNovaObra>(OBRA_VAZIA);
  const [titulo, setTitulo] = useState("");
  const [codigo, setCodigo] = useState("");
  const [sel, setSel] = useState<Record<string, { usar: boolean; base: string; regime: string }>>({});
  const [bdi, setBdi] = useState("");
  const [modo, setModo] = useState("ARREDONDAR");
  const [identificados, setIdentificados] = useState<Set<string>>(new Set());

  // passo 4 — conferência
  const [candidatos, setCandidatos] = useState<Candidato[]>([]);
  const [decisoes, setDecisoes] = useState<Record<number, Decisao>>({});
  const [conferindo, setConferindo] = useState(false);

  // passo 5 — importação
  const [progresso, setProgresso] = useState<{ feito: number; total: number; texto: string } | null>(null);
  const [resultado, setResultado] = useState<{ revisaoId: string; gravados: number; falhas: { ref: number; motivo: string }[] } | null>(null);

  const grade = useMemo(() => leitura?.abas[aba]?.grade ?? [], [leitura, aba]);
  const linhas = useMemo(() => (cab ? lerLinhas(grade, cab, mapa, { continuacao: leitura?.pdf }) : []), [grade, cab, mapa, leitura?.pdf]);
  const estrutura = useMemo(() => montarEstrutura(linhas), [linhas]);
  const largura = Math.max(cab?.titulos.length ?? 0, ...grade.slice(0, 300).map((l) => l.length));
  const nomeColuna = (c: number) => {
    const t = cab?.titulos[c];
    return leitura?.pdf ? `Coluna ${c + 1}${t ? ` — ${t}` : ""}` : `Coluna ${letra(c)}${t ? ` — ${t}` : ""}`;
  };

  function aplicarAnalise(g: Grade, l: Leitura) {
    const a = analisarGrade(g, { continuacao: l.pdf, textoExtra: l.textoExtra });
    setCab(a.cabecalho);
    setMapa(a.mapa);
    setPorTitulo(a.porTitulo);
    setDados(a.dados);
    preencherCadastro(a.dados, l.arquivo, g, a.cabecalho, a.mapa, l.pdf);
  }

  function preencherCadastro(d: DadosIdentificados, arquivo: string, g: Grade, c: Cabecalho, m: Mapa, pdf: boolean) {
    const achou = new Set<string>();
    const v = (k: keyof DadosNovaObra, x?: string) => { if (x) achou.add(k); return x ?? ""; };
    const obra: DadosNovaObra = {
      ...OBRA_VAZIA, nome: v("nome", d.obraNome), codigo: v("codigo", d.obraCodigo), processo: v("processo", d.processo), descricao: v("descricao", d.descricao),
      endereco: v("endereco", d.endereco), municipio: v("municipio", d.municipio), orgaoSolicitante: v("orgaoSolicitante", d.orgaoSolicitante),
    };
    setNovaObra(obra);
    const existente = obras.find((o) => (obra.codigo && o.codigo === obra.codigo) || (obra.processo && o.processo === obra.processo) || (obra.nome && o.nome.toLowerCase() === obra.nome.toLowerCase()));
    setObraId(existente?.id ?? "");
    if (d.titulo) achou.add("titulo");
    if (d.codigoOrcamento) achou.add("codigoOrcamento");
    setTitulo(d.titulo ?? arquivo.replace(/\.[^.]+$/, ""));
    setCodigo(d.codigoOrcamento ?? "");
    // bases: as citadas no arquivo (e as fontes dos itens); competência e regime identificados
    const itens = montarEstrutura(lerLinhas(g, c, m, { continuacao: pdf })).itens;
    const citadas = new Set([...d.referencias.map((r) => r.fonte), ...itens.map((i) => fonteCitada(i.fonte) ?? fontePeloCodigo(i.codigo ?? "")).filter((f): f is string => !!f)]);
    const regime = d.desonerado ? "COM_DESONERACAO" : "SEM_DESONERACAO";
    if (citadas.size) achou.add("bases");
    if (d.desonerado !== undefined) achou.add("regime");
    setSel(Object.fromEntries(fontes.map((f) => {
      const comp = d.referencias.find((r) => r.fonte === f)?.competencia;
      const b = bases.find((x) => x.fonte === f && x.competencia === comp) ?? bases.find((x) => x.fonte === f)!;
      return [f, { usar: citadas.size ? citadas.has(f) : true, base: b.revisaoId, regime: (b.regimes.find((r) => r.codigo === regime) ?? b.regimes[0])?.codigo ?? "" }];
    })));
    const perfil = d.bdi ? perfis.find((p) => Math.abs(Number(p.bdi) - Number(d.bdi)) < 0.005) : undefined;
    setBdi(perfil?.id ?? "");
    if (perfil) achou.add("bdi");
    setIdentificados(achou);
  }

  async function lerArquivo(f: File) {
    setErro(null);
    setLendo(true);
    try {
      const ext = f.name.toLowerCase().split(".").pop();
      const dadosArq = await f.arrayBuffer();
      let l: Leitura;
      if (ext === "pdf") {
        const { lerPdf } = await import("@/lib/orcamento/importar/ler-arquivo");
        const r = await lerPdf(dadosArq);
        l = { arquivo: f.name, pdf: true, abas: [{ nome: "PDF", grade: r.grade }], textoExtra: r.texto };
      } else if (ext === "xls" || ext === "xlsx") {
        const { lerPlanilha } = await import("@/lib/orcamento/importar/ler-arquivo");
        l = { arquivo: f.name, pdf: false, abas: await lerPlanilha(dadosArq), textoExtra: "" };
      } else throw new Error("Formato não aceito. Envie um arquivo .xls, .xlsx ou .pdf.");
      if (!l.abas.length) throw new Error("O arquivo está vazio.");
      // aba com mais itens identificados
      const pontos = l.abas.map((a) => {
        const an = analisarGrade(a.grade);
        return montarEstrutura(lerLinhas(a.grade, an.cabecalho, an.mapa, { continuacao: l.pdf })).itens.length;
      });
      const melhor = pontos.indexOf(Math.max(...pontos));
      setLeitura(l);
      setAba(melhor);
      aplicarAnalise(l.abas[melhor].grade, l);
      setDecisoes({});
      setCandidatos([]);
      setResultado(null);
      setPasso(1);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setLendo(false);
    }
  }

  function trocarAba(i: number) {
    setAba(i);
    if (leitura) aplicarAnalise(leitura.abas[i].grade, leitura);
  }

  function trocarCabecalho(linha: number | null) {
    const c: Cabecalho = linha === null ? { linha: null, titulos: Array.from({ length: largura }, () => "") } : { linha, titulos: (grade[linha] ?? []).map(textoDe) };
    setCab(c);
    const s = sugerirMapa(grade, c);
    setMapa(s.mapa);
    setPorTitulo(s.porTitulo);
  }

  function definirColuna(k: Campo, valor: string) {
    const m = { ...mapa };
    if (valor === "") delete m[k];
    else {
      const c = Number(valor);
      for (const [outro, col] of Object.entries(m)) if (col === c) delete m[outro as Campo];
      m[k] = c;
    }
    setMapa(m);
    setPorTitulo(porTitulo.filter((x) => x !== k));
  }

  const faltando = CAMPOS.filter((c) => c.obrigatorio && mapa[c.campo] === undefined);
  const basesEscolhidas = fontes.filter((f) => sel[f]?.usar).map((f) => ({ baseRevisaoId: sel[f].base, regime: sel[f].regime }));

  async function conferir() {
    setErro(null);
    setConferindo(true);
    try {
      const codigos = [...new Set(estrutura.itens.map((i) => (i.codigo ?? "").trim()).filter(Boolean))];
      const todos: Candidato[] = [];
      for (let i = 0; i < codigos.length; i += 300) {
        const r = await acaoConferirCodigos(basesEscolhidas, codigos.slice(i, i + 300));
        if (!r.ok) throw new Error(r.erro);
        todos.push(...r.dados);
      }
      setCandidatos(todos);
      const dec: Record<number, Decisao> = {};
      for (const it of estrutura.itens) {
        const cs = todos.filter((c) => c.consulta === (it.codigo ?? "").trim().toUpperCase().replace(/\s+/g, " "));
        const escolha = escolherCandidato(it, cs);
        dec[it.indice] = { escolha, importar: !!escolha, codigo: it.codigo ?? "", informar: false, custo: custoDoArquivo(it) };
      }
      setDecisoes(dec);
      setPasso(3);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setConferindo(false);
    }
  }

  async function trocarCodigo(it: ItemEstruturado, novo: string) {
    const r = await acaoConferirCodigos(basesEscolhidas, [novo]);
    if (!r.ok) return setErro(r.erro);
    setCandidatos((cs) => [...cs.filter((c) => c.consulta !== novo.trim().toUpperCase()), ...r.dados]);
    const escolha = escolherCandidato({ ...it, codigo: novo }, r.dados);
    setDecisoes((d) => ({ ...d, [it.indice]: { ...d[it.indice], codigo: novo, escolha, importar: !!escolha, informar: escolha ? false : d[it.indice]?.informar ?? false } }));
  }

  const candidatosDe = (it: ItemEstruturado) => {
    const cod = (decisoes[it.indice]?.codigo ?? it.codigo ?? "").trim().toUpperCase().replace(/\s+/g, " ");
    return candidatos.filter((c) => c.consulta === cod);
  };
  const informadoOk = (d?: Decisao) => !!d && !d.escolha && d.informar && custoValido(d.custo);
  const aImportar = estrutura.itens.filter((i) => (decisoes[i.indice]?.importar && decisoes[i.indice]?.escolha) || informadoOk(decisoes[i.indice]));
  const informados = aImportar.filter((i) => !decisoes[i.indice].escolha).length;
  const naoEncontrados = estrutura.itens.filter((i) => !decisoes[i.indice]?.escolha);

  async function importar() {
    setErro(null);
    setPasso(4);
    try {
      setProgresso({ feito: 0, total: aImportar.length, texto: "Criando o orçamento…" });
      const o = await acaoCriarOrcamento({
        obraId: obraId || null, novaObra: obraId ? null : novaObra, codigo, titulo, bases: basesEscolhidas, bdiPerfilId: bdi || null, arredondamento: modo,
      });
      if (!o.ok) throw new Error(o.erro);
      const revisaoId = o.dados.revisaoId;
      // só as etapas que recebem itens (e suas etapas-mãe)
      const usadas = new Set(aImportar.map((i) => i.etapaChave));
      for (let mudou = true; mudou;) {
        mudou = false;
        for (const e of estrutura.etapas) if (usadas.has(e.chave) && e.paiChave && !usadas.has(e.paiChave)) { usadas.add(e.paiChave); mudou = true; }
      }
      setProgresso({ feito: 0, total: aImportar.length, texto: "Criando as etapas…" });
      const et = await acaoCriarEtapas(revisaoId, 1, estrutura.etapas.filter((e) => usadas.has(e.chave)), { arquivo: leitura!.arquivo, linhas: grade.length, itens: aImportar.length });
      if (!et.ok) throw new Error(et.erro);
      let versao = et.dados.versao;
      let gravados = 0;
      const falhas: { ref: number; motivo: string }[] = [];
      for (let i = 0; i < aImportar.length; i += 40) {
        const lote = aImportar.slice(i, i + 40).map((it) => {
          const d = decisoes[it.indice];
          return {
            ref: it.indice, etapaId: et.dados.ids[it.etapaChave], itemReferenciaId: d.escolha, quantidade: quantidadeAceita(it.quantidade!).valor,
            informado: d.escolha ? null : { codigo: d.codigo || it.codigo || "", descricao: it.descricao || d.codigo || "Item importado", unidade: it.unidade ?? "", custo: d.custo, arquivo: leitura!.arquivo },
          };
        });
        setProgresso({ feito: i, total: aImportar.length, texto: `Gravando itens ${i + 1} a ${Math.min(i + 40, aImportar.length)} de ${aImportar.length}…` });
        const r = await acaoImportarItens(revisaoId, versao, lote);
        if (!r.ok) throw new Error(`${r.erro} O orçamento foi criado com os itens gravados até aqui; abra-o para conferir ou exclua-o na lista de orçamentos.`);
        versao = r.dados.versao;
        gravados += r.dados.gravados;
        falhas.push(...r.dados.falhas);
      }
      setProgresso({ feito: aImportar.length, total: aImportar.length, texto: "Concluído." });
      setResultado({ revisaoId, gravados, falhas });
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  const resumo = { etapas: estrutura.etapas.length, itens: estrutura.itens.length, ignoradas: linhas.filter((l) => l.tipo === "IGNORADA").length };
  const marca = (k: string) => identificados.has(k)
    ? <span className="ml-1 rounded bg-green-50 px-1 text-xs text-green-800">do arquivo</span>
    : <span className="ml-1 rounded bg-amber-50 px-1 text-xs text-amber-800">não identificado — informe</span>;

  return (
    <div className="space-y-4">
      <ol className="flex flex-wrap gap-2 text-sm" aria-label="Etapas da importação">
        {PASSOS.map((p, i) => (
          <li key={p} aria-current={i === passo ? "step" : undefined}
            className={`rounded-full px-3 py-1 ${i === passo ? "bg-marca-600 text-white" : i < passo ? "bg-marca-50 text-marca-800" : "bg-slate-100 text-slate-500"}`}>{i + 1}. {p}</li>
        ))}
      </ol>
      {erro && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{erro}</p>}

      {passo === 0 && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
          <label className="block text-sm font-medium">Arquivo do orçamento (.xls, .xlsx ou .pdf)
            <input type="file" accept=".xls,.xlsx,.pdf,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={lendo} onChange={(e) => { const f = e.target.files?.[0]; if (f) void lerArquivo(f); }} className="mt-2 block text-sm" />
          </label>
          {lendo && <p className="text-sm text-slate-600" aria-live="polite">Lendo o arquivo…</p>}
          <p className="text-xs text-slate-500">O arquivo é lido no seu navegador. PDF precisa ter texto selecionável (PDF digitalizado, como imagem, não pode ser lido).</p>
        </section>
      )}

      {passo === 1 && leitura && cab && (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-medium">Colunas — {leitura.arquivo}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {leitura.abas.length > 1 && (
              <label className="text-sm">Aba da planilha
                <select value={aba} onChange={(e) => trocarAba(Number(e.target.value))} className={campo} aria-label="Aba da planilha">
                  {leitura.abas.map((a, i) => <option key={a.nome} value={i}>{a.nome}</option>)}
                </select>
              </label>
            )}
            <label className="text-sm">Linha de cabeçalho da tabela
              <select value={cab.linha ?? ""} onChange={(e) => trocarCabecalho(e.target.value === "" ? null : Number(e.target.value))} className={campo} aria-label="Linha de cabeçalho">
                <option value="">Sem cabeçalho (a tabela começa na 1ª linha)</option>
                {grade.slice(0, 60).map((l, i) => {
                  const t = l.map(textoDe).filter(Boolean).join(" | ");
                  return t ? <option key={i} value={i}>Linha {i + 1}: {t.slice(0, 90)}</option> : null;
                })}
              </select>
            </label>
          </div>
          <div>
            <h3 className="text-sm font-medium">Coluna do arquivo para cada campo do orçamento</h3>
            <p className="text-xs text-slate-500">Identificadas automaticamente pelos títulos ou pelo conteúdo. Confira e corrija o que for preciso.</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {CAMPOS.map((c) => (
                <label key={c.campo} className="text-sm">
                  {c.nome}{c.obrigatorio && <span className="text-red-600" aria-hidden> *</span>}
                  {mapa[c.campo] !== undefined && <span className="ml-1 text-xs text-green-700">{porTitulo.includes(c.campo) ? "(pelo título)" : "(pelo conteúdo)"}</span>}
                  <select value={mapa[c.campo] ?? ""} onChange={(e) => definirColuna(c.campo, e.target.value)} aria-label={`Coluna de ${c.nome}`}
                    className={`${campo} ${mapa[c.campo] === undefined && c.obrigatorio ? "border-amber-400 bg-amber-50" : ""}`}>
                    <option value="">— não há —</option>
                    {Array.from({ length: largura }, (_, i) => <option key={i} value={i}>{nomeColuna(i)}</option>)}
                  </select>
                </label>
              ))}
            </div>
          </div>
          <p className="text-sm" role="status">
            Encontrados: <strong>{resumo.etapas}</strong> etapas e <strong>{resumo.itens}</strong> itens; {resumo.ignoradas} linhas ignoradas (totais, títulos repetidos, linhas sem quantidade).
          </p>
          <div className="max-h-96 overflow-auto rounded border border-slate-200">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50 text-left text-slate-600">
                <tr><th className="px-2 py-1">Linha</th><th>Tipo</th><th>Item</th><th>Código</th><th>Descrição</th><th>Unid.</th><th className="text-right">Quant.</th><th className="text-right">Custo unit.</th><th className="px-2 text-right">Total</th></tr>
              </thead>
              <tbody>
                {linhas.slice(0, 200).map((l) => (
                  <tr key={l.indice} className={`border-t border-slate-100 ${l.tipo === "ETAPA" ? "bg-marca-50 font-medium" : l.tipo === "IGNORADA" ? "text-slate-400" : ""}`}>
                    <td className="px-2 py-1">{l.indice + 1}</td>
                    <td>{l.tipo === "ETAPA" ? "Etapa" : l.tipo === "ITEM" ? "Item" : `Ignorada${l.nota ? ` (${l.nota})` : ""}`}</td>
                    <td>{l.item}</td><td className="whitespace-nowrap">{l.codigo}</td><td>{l.descricao}</td><td>{l.unidade}</td>
                    <td className="text-right">{l.tipo === "ITEM" ? qtd(l.quantidade) : ""}</td><td className="text-right">{l.tipo === "ITEM" ? moeda(l.custoUnitario) : ""}</td>
                    <td className="px-2 text-right">{moeda(l.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {faltando.length > 0 && <p className="text-sm text-amber-800">Indique a coluna de: {faltando.map((c) => c.nome).join(", ")}.</p>}
          <div className="flex gap-2">
            <button onClick={() => { setPasso(0); setLeitura(null); }} className={`${botao} border border-slate-300`}>Outro arquivo</button>
            <button onClick={() => setPasso(2)} disabled={faltando.length > 0 || resumo.itens === 0} className={`${botao} bg-marca-600 text-white`}>Avançar</button>
          </div>
        </section>
      )}

      {passo === 2 && (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-medium">Dados do orçamento</h2>
          <p className="text-xs text-slate-500">Os campos marcados “do arquivo” foram identificados na importação; confira. Os demais, preencha.</p>
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Obra</h3>
            <select value={obraId} onChange={(e) => setObraId(e.target.value)} aria-label="Obra" className={campo}>
              <option value="">+ Nova obra (dados abaixo)</option>
              {obras.map((o) => <option key={o.id} value={o.id}>{o.codigo ? `${o.codigo} · ` : ""}{o.nome}</option>)}
            </select>
            {obraId && <p className="text-xs text-slate-500">O orçamento será incluído na obra já cadastrada.</p>}
            {!obraId && (
              <>
                <p className="text-xs">
                  Nome{marca("nome")} · Código{marca("codigo")} · Processo{marca("processo")} · Endereço{marca("endereco")} · Cidade{marca("municipio")} · Órgão{marca("orgaoSolicitante")}
                </p>
                <CamposObra valor={novaObra} onChange={setNovaObra} cabecalhos={cabecalhos} />
              </>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
            <label className="text-sm">Código do orçamento{marca("codigoOrcamento")}<input value={codigo} onChange={(e) => setCodigo(e.target.value)} maxLength={60} className={campo} /></label>
            <label className="text-sm">Título{marca("titulo")}<input value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={200} className={campo} /></label>
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Bases de referência{marca("bases")} e regime{marca("regime")}</h3>
            {dados.referencias.length > 0 && <p className="text-xs text-slate-600">Citadas no arquivo: {dados.referencias.map((r) => `${r.fonte}${r.competencia ? ` ${r.competencia.slice(5)}/${r.competencia.slice(0, 4)}` : ""}`).join(", ")}{dados.desonerado === undefined ? "" : dados.desonerado ? " — com desoneração" : " — sem desoneração"}.</p>}
            {fontes.map((f) => sel[f] && (
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
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">BDI global{marca("bdi")}
              <select value={bdi} onChange={(e) => setBdi(e.target.value)} className={campo} aria-label="BDI global">
                <option value="">Sem BDI (somente custo direto)</option>
                {perfis.map((p) => <option key={p.id} value={p.id}>{p.nome} — {Number(p.bdi).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}%</option>)}
              </select>
              {dados.bdi && !identificados.has("bdi") && (
                <span className="mt-1 block text-xs text-amber-800">
                  BDI no arquivo: {Number(dados.bdi).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}% — nenhum perfil cadastrado com esse valor.{" "}
                  <Link href="/bdi" target="_blank" className="underline">Cadastrar perfil de BDI</Link> e recarregar esta lista depois.
                </span>
              )}
            </label>
            <label className="text-sm">Arredondamento dos preços (2 casas)
              <select value={modo} onChange={(e) => setModo(e.target.value)} className={campo} aria-label="Arredondamento">
                <option value="ARREDONDAR">Arredondar</option>
                <option value="TRUNCAR">Truncar</option>
              </select>
            </label>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setPasso(1)} className={`${botao} border border-slate-300`}>Voltar</button>
            <button onClick={() => void conferir()} disabled={conferindo || !titulo.trim() || (!obraId && !novaObra.nome.trim()) || basesEscolhidas.length === 0}
              className={`${botao} bg-marca-600 text-white`}>{conferindo ? "Conferindo códigos…" : "Conferir itens nas bases"}</button>
          </div>
          {(!titulo.trim() || (!obraId && !novaObra.nome.trim())) && <p className="text-xs text-amber-800">Informe o nome da obra (ou escolha uma cadastrada) e o título do orçamento.</p>}
        </section>
      )}

      {passo === 3 && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-medium">Conferência dos itens</h2>
          <p className="text-sm" role="status">
            {aImportar.length} de {estrutura.itens.length} itens serão importados{informados > 0 ? ` (${informados} com preço informado)` : ""}.{" "}
            {estrutura.itens.length - aImportar.length > 0 && <span className="text-amber-800">Os demais não foram encontrados nas bases escolhidas (ou estão sem preço no regime) — corrija o código, inclua com preço informado ou deixe de fora.</span>}
          </p>
          <p className="text-xs text-slate-500">O custo de cada item vem da base de referência; o valor do arquivo aparece só para comparação (diferenças em destaque).</p>
          <div className="max-h-[32rem] overflow-auto rounded border border-slate-200">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50 text-left text-slate-600">
                <tr><th className="px-2 py-1">Importar</th><th>Item</th><th>Código no arquivo</th><th>Descrição no arquivo</th><th className="text-right">Quant.</th><th>Item da base</th><th className="text-right">Custo da base</th><th className="px-2 text-right">Custo no arquivo</th></tr>
              </thead>
              <tbody>
                {estrutura.itens.map((it) => {
                  const d = decisoes[it.indice] ?? { escolha: null, importar: false, codigo: it.codigo ?? "", informar: false, custo: "" };
                  const cs = candidatosDe(it);
                  const c = cs.find((x) => x.itemReferenciaId === d.escolha);
                  const q = quantidadeAceita(it.quantidade ?? "0");
                  const difere = c?.custo && it.custoUnitario && Math.abs(Number(c.custo) - Number(it.custoUnitario)) >= 0.01;
                  return (
                    <tr key={it.indice} className={`border-t border-slate-100 align-top ${!d.escolha ? "bg-amber-50" : ""}`}>
                      <td className="px-2 py-1"><input type="checkbox" checked={d.importar && !!d.escolha} disabled={!d.escolha} aria-label={`Importar linha ${it.indice + 1}`}
                        onChange={(e) => setDecisoes({ ...decisoes, [it.indice]: { ...d, importar: e.target.checked } })} /></td>
                      <td>{it.item}</td>
                      <td className="whitespace-nowrap">
                        <CodigoEditavel valor={d.codigo} rotulo={`Código da linha ${it.indice + 1}`} onTrocar={(novo) => void trocarCodigo(it, novo)} />
                      </td>
                      <td className="max-w-xs">{it.descricao}</td>
                      <td className="text-right">{qtd(q.valor)} {it.unidade}{q.arredondada && <span className="block text-amber-800">arredondada a 4 casas</span>}</td>
                      <td className="max-w-xs">
                        {cs.length > 1 ? (
                          <select value={d.escolha ?? ""} aria-label={`Item da base da linha ${it.indice + 1}`} className="max-w-xs rounded border border-slate-300 px-1"
                            onChange={(e) => setDecisoes({ ...decisoes, [it.indice]: { ...d, escolha: e.target.value || null, importar: !!e.target.value } })}>
                            <option value="">— escolha —</option>
                            {cs.map((x) => <option key={x.itemReferenciaId} value={x.itemReferenciaId} disabled={!x.custo}>{x.fonte} {x.codigo}{x.custo ? "" : " (sem preço)"}</option>)}
                          </select>
                        ) : null}
                        {c ? <span className="block">{c.fonte} {c.codigo} — {c.descricao} ({c.unidade ?? "s/ unid."})</span>
                          : cs.length === 1 ? <span className="block text-amber-800">{cs[0].fonte} {cs[0].codigo}: sem preço no regime/base escolhidos ({cs[0].pendencia})</span>
                          : cs.length === 0 ? <span className="block text-amber-800">Não encontrado nas bases escolhidas</span> : null}
                        {!d.escolha && (
                          <div className="mt-1 rounded border border-slate-200 bg-white p-1.5">
                            <label className="flex items-center gap-1">
                              <input type="checkbox" checked={d.informar} aria-label={`Incluir com preço informado — linha ${it.indice + 1}`}
                                onChange={(e) => setDecisoes({ ...decisoes, [it.indice]: { ...d, informar: e.target.checked } })} />
                              Incluir no orçamento com preço informado
                            </label>
                            {d.informar && (
                              <label className="mt-1 flex items-center gap-1">Custo unitário sem BDI (R$)
                                <input value={d.custo} inputMode="decimal" aria-label={`Custo informado — linha ${it.indice + 1}`}
                                  onChange={(e) => setDecisoes({ ...decisoes, [it.indice]: { ...d, custo: e.target.value } })}
                                  className={`w-24 rounded border px-1 text-right ${custoValido(d.custo) ? "border-slate-300" : "border-amber-500 bg-amber-50"}`} />
                              </label>
                            )}
                            {d.informar && !custoValido(d.custo) && <span className="block text-amber-800">Informe o custo unitário (até 4 casas).</span>}
                          </div>
                        )}
                      </td>
                      <td className="text-right">{c ? moeda(c.custo) : "—"}</td>
                      <td className={`px-2 text-right ${difere ? "font-medium text-amber-800" : ""}`}>{moeda(it.custoUnitario)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {naoEncontrados.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <button className={`${botao} border border-slate-300`} onClick={() => setDecisoes((ds) => {
                const n = { ...ds };
                for (const it of naoEncontrados) n[it.indice] = { ...n[it.indice], informar: true };
                return n;
              })}>Incluir todos os não encontrados com preço informado</button>
              <span className="text-xs text-slate-500">O custo vem preenchido com o valor do arquivo (sem BDI), quando houver; confira e ajuste. No orçamento, esses itens ficam marcados como “INFORMADO” e o custo pode ser editado.</span>
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={() => setPasso(2)} className={`${botao} border border-slate-300`}>Voltar</button>
            <button onClick={() => void importar()} disabled={aImportar.length === 0} className={`${botao} bg-marca-600 text-white`}>Importar {aImportar.length} itens</button>
          </div>
        </section>
      )}

      {passo === 4 && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-medium">Importação</h2>
          {progresso && (
            <div aria-live="polite">
              <p className="text-sm">{progresso.texto}</p>
              <progress value={progresso.feito} max={Math.max(1, progresso.total)} className="mt-1 w-full" />
            </div>
          )}
          {resultado && (
            <div role="status" className="space-y-2 text-sm">
              <p className="rounded-md bg-green-50 px-3 py-2 text-green-800">Orçamento importado: {resultado.gravados} itens gravados.</p>
              {resultado.falhas.length > 0 && (
                <div className="rounded-md bg-amber-50 px-3 py-2 text-amber-900">
                  <p>{resultado.falhas.length} itens não foram gravados:</p>
                  <ul className="list-disc pl-5">{resultado.falhas.map((f) => <li key={f.ref}>Linha {f.ref + 1}: {f.motivo}</li>)}</ul>
                </div>
              )}
              <Link href={`/orcamentos/revisao/${resultado.revisaoId}`} className={`${botao} inline-block bg-marca-600 text-white`}>Abrir o orçamento</Link>
            </div>
          )}
          {erro && !resultado && <button onClick={() => setPasso(3)} className={`${botao} border border-slate-300`}>Voltar à conferência</button>}
        </section>
      )}
    </div>
  );
}

function CodigoEditavel({ valor, rotulo, onTrocar }: { valor: string; rotulo: string; onTrocar: (novo: string) => void }) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(valor);
  if (!editando) {
    return (
      <span>
        {valor || "—"}{" "}
        <button onClick={() => { setTexto(valor); setEditando(true); }} className="text-marca-700 underline" aria-label={`Corrigir ${rotulo.toLowerCase()}`}>corrigir</button>
      </span>
    );
  }
  return (
    <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); if (texto.trim()) { onTrocar(texto.trim()); setEditando(false); } }}>
      <input value={texto} onChange={(e) => setTexto(e.target.value)} aria-label={rotulo} className="w-28 rounded border border-slate-300 px-1" autoFocus />
      <button type="submit" className="text-marca-700 underline">ok</button>
    </form>
  );
}
