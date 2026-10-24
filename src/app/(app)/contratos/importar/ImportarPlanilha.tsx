"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { estruturaContrato } from "@/lib/contratos/importar";
import { analisarGrade, lerLinhas, textoDe, type Cabecalho, type Grade, type Mapa } from "@/lib/orcamento/importar/analisar";
import { CamposObra, OBRA_VAZIA } from "../../orcamentos/CamposObra";
import type { DadosNovaObra } from "../../orcamentos/acoes";
import { acaoCriarContratoDaPlanilha } from "../acoes";
import { CamposContrato, CONTRATO_VAZIO, paraAcao } from "../CamposContrato";

interface Leitura { arquivo: string; pdf: boolean; abas: { nome: string; grade: Grade }[]; textoExtra: string }
type CampoContrato = "item" | "codigo" | "descricao" | "unidade" | "quantidade" | "preco" | "total";
const CAMPOS: { campo: CampoContrato; nome: string; obrigatorio: boolean }[] = [
  { campo: "item", nome: "Item (numeração)", obrigatorio: false },
  { campo: "codigo", nome: "Código", obrigatorio: false },
  { campo: "descricao", nome: "Descrição", obrigatorio: true },
  { campo: "unidade", nome: "Unidade", obrigatorio: false },
  { campo: "quantidade", nome: "Quantidade contratada", obrigatorio: true },
  { campo: "preco", nome: "Preço unitário (proposta)", obrigatorio: true },
  { campo: "total", nome: "Valor total do item", obrigatorio: false },
];
const campo = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const moeda = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });
const num = (v: string | null) => (v === null ? "—" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 }));
/** soma exata em centavos (sem erro de ponto flutuante) */
const centavos = (v: string) => { const [i, d = ""] = v.split("."); return BigInt(i) * BigInt(100) + BigInt((d + "00").slice(0, 2)) * (v.startsWith("-") ? BigInt(-1) : BigInt(1)); };

/** Número do contrato e empresa citados no arquivo (quando houver). */
function identificar(texto: string) {
  const numero = texto.match(/contrato\s*(?:n[º°o.]*\s*)?[:\-]?\s*(\d{1,5}\s*\/\s*\d{2,4})/i)?.[1]?.replace(/\s+/g, "");
  const empresa = texto.match(/(?:empreiteira|contratada|empresa)\s*:\s*([^\n]{3,120})/i)?.[1]?.trim();
  const objeto = texto.match(/obra\s*:\s*([^\n]{10,600})/i)?.[1]?.trim();
  return { numero, empresa, objeto };
}

export function ImportarPlanilha({ obras, cabecalhos }: { obras: { id: string; nome: string; codigo: string | null; processo: string | null }[]; cabecalhos: { id: string; nome: string; padrao: boolean }[] }) {
  const [leitura, setLeitura] = useState<Leitura | null>(null);
  const [aba, setAba] = useState(0);
  const [cab, setCab] = useState<Cabecalho | null>(null);
  const [mapa, setMapa] = useState<Partial<Record<CampoContrato, number>>>({});
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [obraId, setObraId] = useState("");
  const [novaObra, setNovaObra] = useState<DadosNovaObra>(OBRA_VAZIA);
  const [form, setForm] = useState(CONTRATO_VAZIO);
  const [arredondamento, setArredondamento] = useState("ARREDONDAR");
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  const grade = useMemo(() => leitura?.abas[aba]?.grade ?? [], [leitura, aba]);
  const mapaLeitura: Mapa = useMemo(() => ({
    item: mapa.item, codigo: mapa.codigo, descricao: mapa.descricao, unidade: mapa.unidade, quantidade: mapa.quantidade, precoUnitario: mapa.preco, total: mapa.total,
  }), [mapa]);
  const estrutura = useMemo(() => (cab ? estruturaContrato(lerLinhas(grade, cab, mapaLeitura, { continuacao: leitura?.pdf }), "precoUnitario") : { grupos: [], itens: [] }), [grade, cab, mapaLeitura, leitura?.pdf]);
  const validos = estrutura.itens.filter((i) => i.quantidade !== null && i.preco !== null);
  const semPreco = estrutura.itens.length - validos.length;
  const somaTotal = validos.reduce((a, i) => a + (i.total ? centavos(i.total) : BigInt(0)), BigInt(0));
  const largura = Math.max(cab?.titulos.length ?? 0, ...grade.slice(0, 200).map((l) => l.length));
  const faltando = CAMPOS.filter((c) => c.obrigatorio && mapa[c.campo] === undefined);

  function aplicar(g: Grade, l: Leitura) {
    const a = analisarGrade(g, { continuacao: l.pdf, textoExtra: l.textoExtra });
    setCab(a.cabecalho);
    setMapa({ item: a.mapa.item, codigo: a.mapa.codigo, descricao: a.mapa.descricao, unidade: a.mapa.unidade, quantidade: a.mapa.quantidade, preco: a.mapa.precoUnitario ?? a.mapa.custoUnitario, total: a.mapa.total });
    const texto = [l.textoExtra, ...g.slice(0, a.cabecalho.linha ?? 0).map((x) => x.map(textoDe).join(" "))].join("\n");
    const id = identificar(texto);
    const d = a.dados;
    setForm((f) => ({ ...f, numero: f.numero || id.numero || "", processo: f.processo || d.processo || "", empresa: f.empresa || id.empresa || "", objeto: f.objeto || id.objeto || d.descricao || d.obraNome || l.arquivo.replace(/\.[^.]+$/, "") }));
    setNovaObra({ ...OBRA_VAZIA, nome: d.obraNome ?? id.objeto?.slice(0, 200) ?? "", codigo: d.obraCodigo ?? "", processo: d.processo ?? "", descricao: d.descricao ?? id.objeto ?? "", endereco: d.endereco ?? "", municipio: d.municipio ?? "", orgaoSolicitante: d.orgaoSolicitante ?? "" });
    const existente = obras.find((o) => (d.obraCodigo && o.codigo === d.obraCodigo) || (d.processo && o.processo === d.processo));
    setObraId(existente?.id ?? "");
  }

  async function ler(f: File) {
    setErro(null);
    setLendo(true);
    try {
      const ext = f.name.toLowerCase().split(".").pop();
      const dados = await f.arrayBuffer();
      const mod = await import("@/lib/orcamento/importar/ler-arquivo");
      let l: Leitura;
      if (ext === "pdf") { const r = await mod.lerPdf(dados); l = { arquivo: f.name, pdf: true, abas: [{ nome: "PDF", grade: r.grade }], textoExtra: r.texto }; }
      else if (ext === "xls" || ext === "xlsx") l = { arquivo: f.name, pdf: false, abas: await mod.lerPlanilha(dados), textoExtra: "" };
      else throw new Error("Formato não aceito. Envie um arquivo .xls, .xlsx ou .pdf.");
      if (!l.abas.length) throw new Error("O arquivo está vazio.");
      const pontos = l.abas.map((a) => { const an = analisarGrade(a.grade); return lerLinhas(a.grade, an.cabecalho, an.mapa, { continuacao: l.pdf }).filter((x) => x.tipo === "ITEM").length; });
      const melhor = pontos.indexOf(Math.max(...pontos));
      setLeitura(l);
      setAba(melhor);
      aplicar(l.abas[melhor].grade, l);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setLendo(false);
    }
  }

  const criar = () => iniciar(async () => {
    setErro(null);
    if (!obraId && !novaObra.nome.trim()) return setErro("Escolha a obra ou informe o nome da nova obra.");
    const r = await acaoCriarContratoDaPlanilha({ ...paraAcao(form), obraId: obraId || null, novaObra: obraId ? null : novaObra, arredondamento }, {
      arquivo: leitura!.arquivo,
      grupos: estrutura.grupos,
      itens: validos.map((i) => ({ grupoChave: i.grupoChave, numero: i.item, codigo: i.codigo, fonte: i.fonte, descricao: i.descricao, unidade: i.unidade, quantidade: i.quantidade!, precoUnitario: i.preco!, total: i.total })),
    });
    if (!r.ok) return setErro(r.erro);
    router.push(`/contratos/${r.dados}`);
  });

  return (
    <div className="space-y-4">
      <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-5">
        <label className="block text-sm font-medium">Arquivo da planilha (.xls, .xlsx ou .pdf)
          <input type="file" accept=".xls,.xlsx,.pdf" disabled={lendo} onChange={(e) => { const f = e.target.files?.[0]; if (f) void ler(f); }} className="mt-2 block text-sm" />
        </label>
        {lendo && <p className="text-sm text-slate-600" aria-live="polite">Lendo o arquivo…</p>}
        <p className="text-xs text-slate-500">O arquivo é lido no seu navegador. PDF precisa ter texto selecionável (não pode ser digitalizado).</p>
      </section>
      {erro && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{erro}</p>}

      {leitura && cab && (
        <>
          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="font-medium">Colunas — {leitura.arquivo}</h2>
            {leitura.abas.length > 1 && (
              <label className="block text-sm">Aba da planilha
                <select value={aba} onChange={(e) => { const i = Number(e.target.value); setAba(i); aplicar(leitura.abas[i].grade, leitura); }} className={campo}>
                  {leitura.abas.map((a, i) => <option key={a.nome} value={i}>{a.nome}</option>)}
                </select>
              </label>
            )}
            <div className="grid gap-3 sm:grid-cols-4">
              {CAMPOS.map((c) => (
                <label key={c.campo} className="text-sm">{c.nome}{c.obrigatorio ? " *" : ""}
                  <select value={mapa[c.campo] ?? ""} aria-label={`Coluna: ${c.nome}`} onChange={(e) => {
                    const m = { ...mapa };
                    if (e.target.value === "") delete m[c.campo];
                    else { for (const k of Object.keys(m) as CampoContrato[]) if (m[k] === Number(e.target.value)) delete m[k]; m[c.campo] = Number(e.target.value); }
                    setMapa(m);
                  }} className={campo}>
                    <option value="">— não tem —</option>
                    {Array.from({ length: largura }, (_, k) => <option key={k} value={k}>Coluna {k + 1}{cab.titulos[k] ? ` — ${cab.titulos[k]}` : ""}</option>)}
                  </select>
                </label>
              ))}
            </div>
            {faltando.length > 0 && <p className="text-sm text-amber-800">Indique a coluna de: {faltando.map((c) => c.nome).join(", ")}.</p>}
          </section>

          <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="font-medium">Conferência</h2>
            <p className="text-sm" role="status">
              <strong>{validos.length}</strong> itens em <strong>{estrutura.grupos.length}</strong> grupos
              {mapa.total !== undefined && <> · soma dos valores do arquivo: <strong>{moeda(Number(somaTotal) / 100)}</strong></>}
              {semPreco > 0 && <span className="text-amber-800"> · {semPreco} linha(s) sem quantidade ou preço ficam de fora</span>}
            </p>
            <p className="text-xs text-slate-500">Confira a soma com o valor total da proposta antes de criar o contrato.</p>
            <div className="max-h-96 overflow-auto rounded border border-slate-200">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 text-left text-slate-500"><tr><th className="px-2 py-1">Item</th><th>Código</th><th>Descrição</th><th>Unid.</th><th className="text-right">Quant.</th><th className="text-right">Preço unit.</th><th className="px-2 text-right">Total</th></tr></thead>
                <tbody>
                  {estrutura.grupos.map((g) => (
                    <GrupoPrevia key={g.chave} titulo={g.titulo} sub={!!g.paiChave} itens={validos.filter((i) => i.grupoChave === g.chave)} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="font-medium">Obra</h2>
            <label className="block text-sm">Obra cadastrada
              <select value={obraId} onChange={(e) => {
                setObraId(e.target.value);
                const o = obras.find((x) => x.id === e.target.value);
                if (o?.processo && !form.processo.trim()) setForm({ ...form, processo: o.processo });
              }} aria-label="Obra" className={campo}>
                <option value="">Nova obra (preencher abaixo)</option>
                {obras.map((o) => <option key={o.id} value={o.id}>{o.codigo ? `${o.codigo} · ` : ""}{o.nome}{o.processo ? ` (${o.processo})` : ""}</option>)}
              </select>
            </label>
            {!obraId && <CamposObra valor={novaObra} onChange={setNovaObra} cabecalhos={cabecalhos} />}
          </section>

          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="font-medium">Dados do contrato</h2>
            <CamposContrato valor={form} onChange={setForm} />
            <label className="block text-sm sm:w-80">Valor total dos itens sem coluna de total
              <select value={arredondamento} onChange={(e) => setArredondamento(e.target.value)} className={campo}>
                <option value="ARREDONDAR">quantidade × preço, arredondado</option>
                <option value="TRUNCAR">quantidade × preço, truncado</option>
              </select>
            </label>
          </section>

          <button onClick={criar} disabled={pendente || faltando.length > 0 || validos.length === 0} className="rounded-md bg-marca-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {pendente ? "Criando…" : `Criar contrato com ${validos.length} itens`}
          </button>
        </>
      )}
    </div>
  );
}

function GrupoPrevia({ titulo, sub, itens }: { titulo: string; sub: boolean; itens: { indice: number; item: string | null; codigo: string | null; descricao: string; unidade: string | null; quantidade: string | null; preco: string | null; total: string | null }[] }) {
  return (
    <>
      <tr className={sub ? "bg-slate-50" : "bg-slate-100 font-semibold"}><td colSpan={7} className={`px-2 py-1 ${sub ? "pl-6" : ""}`}>{titulo}</td></tr>
      {itens.map((i) => (
        <tr key={i.indice} className="border-t border-slate-100 align-top">
          <td className="px-2 py-0.5">{i.item ?? ""}</td><td className="whitespace-nowrap font-mono">{i.codigo ?? ""}</td><td>{i.descricao}</td><td>{i.unidade ?? ""}</td>
          <td className="text-right">{num(i.quantidade)}</td><td className="text-right">{num(i.preco)}</td><td className="px-2 text-right">{num(i.total)}</td>
        </tr>
      ))}
    </>
  );
}
