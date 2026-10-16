/**
 * Adaptador EMOP-RJ — arquivos DBF mensais (EMOP, DIPR, COMP, MAT, ELEM, REUT).
 * Layout verificado no boletim de 09/2026 (ver docs/LAYOUTS.md).
 *
 * Regime: definido pelo último caractere do código do serviço, conforme o
 * Catálogo de Referência EMOP (13ª ed.): dígitos 0–4 = sem desoneração,
 * letras A–E = com desoneração. Elementares têm preço único (regime nulo).
 */
import { D, dec, lerNumero, type Dec } from "@/lib/calculo/decimal";
import type { ArquivoEntrada } from "../leitores/arquivo";
import { decodificadores, lerCabecalhoDbf, lerDbf, type CampoDbf, type RegistroDbf } from "../leitores/dbf";
import type { Adaptador, Emissor, Identificacao } from "../tipos";

const TABELAS = ["EMOP", "DIPR", "COMP", "MAT", "ELEM", "REUT"] as const;
type Tabela = (typeof TABELAS)[number];
const RE_ARQ = /^(EMOP|DIPR|COMP|MAT|ELEM|REUT)(\d{2})(\d{2})\.dbf$/i;

/** Campos (nome:tipo) exigidos de cada tabela. Tamanhos podem variar. */
const ASSINATURAS: Record<Tabela, string[]> = {
  EMOP: ["CODIGO:C", "PRECO:N"],
  DIPR: ["CODIGO:C", "DESCR1:C", "DESCR2:C", "DESCR3:C", "DESCR4:C", "DESCR5:C", "DESCR6:C", "UNID:C", "CUSTO:N"],
  COMP: ["CODIGO:C", "SEQUENCIA:C", "ELEMENTAR:C", "QUANTIDADE:N", "PERCENTUAL:N"],
  MAT: ["ELEMENTAR:C", "DESCRICAO:C", "DESCR1:C", "DESCR2:C", "DESCR3:C", "UNID:C", "PRECO:N"],
  ELEM: ["ELEMENTAR:C", "PRECO:N"],
  REUT: ["ELEMENTAR:C", "COMPOSICAO:C", "DESCRICAO:C", "DESCR1:C", "DESCR2:C", "DESCR3:C", "UNIDADE:C"],
};

const REGIMES = [
  { codigo: "SEM_DESONERACAO", nome: "Sem desoneração", descricao: "Códigos com dígito final 0 a 4" },
  { codigo: "COM_DESONERACAO", nome: "Com desoneração", descricao: "Códigos com dígito final A a E" },
];

const RE_CODIGO_SERVICO = /^\d{2}\.\d{3}\.\d{4}-[0-9A-Z]$/;
/**
 * Registros "CC.FFF.9999-D" sem unidade são os índices setoriais publicados no
 * boletim (ex.: 05.100.9999-0 = Índice Geral da Construção Civil); o campo
 * CUSTO traz o número-índice, não um preço em R$. Conferido com o PDF
 * "Índices com e sem desoneração" de 09/2026.
 */
const RE_INDICE = /^\d{2}\.\d{3}\.9999-[0-9A-Z]$/;

export function regimeEmop(codigo: string): string | null {
  const d = codigo.slice(-1);
  if ("01234".includes(d)) return "SEM_DESONERACAO";
  if ("ABCDE".includes(d)) return "COM_DESONERACAO";
  return null;
}

/** "0100100751" → "01.001.0075-1" (formato do REUT para o código do serviço). */
export function formatarCodigoEmop(s: string): string | null {
  const m = /^(\d{2})(\d{3})(\d{4})([0-9A-Z])$/.exec(s.trim());
  return m ? `${m[1]}.${m[2]}.${m[3]}-${m[4]}` : null;
}

/**
 * Junta descrições quebradas em campos de largura fixa. Campo preenchido até o
 * fim = texto continua no próximo (a EMOP quebra até no meio de palavras:
 * "…METROP" + "OLITANA…"); campo com espaços de preenchimento no fim = quebra
 * de linha, que vira um único espaço.
 */
export function juntarDescricao(partes: (string | null | undefined)[]): string | null {
  let t = "";
  for (const p of partes) {
    if (!p) continue;
    const semFim = p.trimEnd();
    t += semFim.length < p.length ? semFim + " " : p;
  }
  t = t.trim();
  return t === "" ? null : t;
}
const descricao = (r: RegistroDbf, campos: string[]) => juntarDescricao(campos.map((c) => r[c]));
const campo = (r: RegistroDbf, c: string) => r[c]?.trim() || null;

function localizar(arquivos: ArquivoEntrada[]) {
  const achados = new Map<Tabela, { arq: ArquivoEntrada; mmaa: string }>();
  for (const a of arquivos) {
    const m = RE_ARQ.exec(a.nome);
    if (m) achados.set(m[1].toUpperCase() as Tabela, { arq: a, mmaa: m[2] + m[3] });
  }
  return achados;
}

function conferirAssinatura(t: Tabela, campos: CampoDbf[]): string | null {
  const tem = new Set(campos.map((c) => `${c.nome}:${c.tipo}`));
  const faltam = ASSINATURAS[t].filter((x) => !tem.has(x));
  return faltam.length ? `${t}: campos ausentes ou de tipo diferente: ${faltam.join(", ")}` : null;
}

async function* registros(arq: ArquivoEntrada) {
  for await (const r of lerDbf(arq.abrir(), { decodificar: decodificadores.cp850, aparar: false })) yield r;
}

export const adaptadorEmopDbf: Adaptador = {
  id: "emop-dbf",
  versao: "1.0.0",
  fonte: "EMOP",
  descricao: "EMOP-RJ — boletim mensal em DBF (EMOP, DIPR, COMP, MAT, ELEM, REUT)",

  async identificar(arquivos, { uf }) {
    const achados = localizar(arquivos);
    if (achados.size === 0) return null;
    const faltam = TABELAS.filter((t) => !achados.has(t));
    if (faltam.length) return { ok: false, motivo: `Arquivos EMOP incompletos: faltam ${faltam.map((t) => `${t}MMAA.dbf`).join(", ")}.` };
    const meses = new Set([...achados.values()].map((a) => a.mmaa));
    if (meses.size > 1) return { ok: false, motivo: `Arquivos de competências diferentes: ${[...meses].join(", ")}.` };
    if (uf !== "RJ") return { ok: false, motivo: "A EMOP publica apenas para o Estado do Rio de Janeiro (UF RJ)." };
    const mmaa = [...meses][0];
    const mes = Number(mmaa.slice(0, 2));
    if (mes < 1 || mes > 12) return { ok: false, motivo: `Mês inválido no nome dos arquivos: ${mmaa}.` };
    const competencia = `20${mmaa.slice(2)}-${mmaa.slice(0, 2)}`;

    const observacoes: string[] = [];
    let dataArquivo: string | null = null;
    for (const t of TABELAS) {
      try {
        const cab = await lerCabecalhoDbf(achados.get(t)!.arq.abrir());
        const erro = conferirAssinatura(t, cab.campos);
        if (erro) return { ok: false, motivo: `Layout não reconhecido — ${erro}.` };
        dataArquivo ??= cab.ultimaAtualizacao;
        if (cab.ultimaAtualizacao && cab.ultimaAtualizacao.slice(0, 7) < competencia) {
          observacoes.push(`${t}: data gravada no arquivo (${cab.ultimaAtualizacao}) é anterior à competência.`);
        }
      } catch (e) {
        return { ok: false, motivo: `${achados.get(t)!.arq.nome}: ${(e as Error).message}` };
      }
    }
    observacoes.push("Regime pelo dígito final do código (Catálogo de Referência EMOP): 0–4 sem desoneração; A–E com desoneração.");
    observacoes.push("Preço publicado (DIPR.CUSTO) é o valor oficial; o recálculo pela analítica é apenas conferência.");
    return {
      ok: true,
      identificacao: {
        adaptador: this.id,
        versao: this.versao,
        fonte: "EMOP",
        uf: "RJ",
        competencia,
        layout: "EMOP DBF (dBase III, CP850)",
        regimes: REGIMES,
        arquivos: [
          { nome: achados.get("DIPR")!.arq.nome, papel: "Serviços: descrição, unidade e custo" },
          { nome: achados.get("EMOP")!.arq.nome, papel: "Preço dos serviços (conferência com DIPR)" },
          { nome: achados.get("COMP")!.arq.nome, papel: "Composições analíticas" },
          { nome: achados.get("MAT")!.arq.nome, papel: "Insumos (materiais, mão de obra, equipamentos)" },
          { nome: achados.get("REUT")!.arq.nome, papel: "Composições reutilizadas como elementares" },
          { nome: achados.get("ELEM")!.arq.nome, papel: "Preço de todos os elementares" },
        ],
        dataEmissao: dataArquivo,
        observacoes,
      },
    };
  },

  async ler(arquivos, _ident: Identificacao, emitir: Emissor) {
    const a = localizar(arquivos);
    const nome = (t: Tabela) => a.get(t)!.arq.nome;

    // ELEM: preço de todos os elementares
    const precoElem = new Map<string, Dec>();
    for await (const { linha, registro: r } of registros(a.get("ELEM")!.arq)) {
      const codigo = campo(r, "ELEMENTAR");
      const base = { arquivo: nome("ELEM"), linha };
      if (!codigo) { await emitir.ocorrencia({ ...base, regra: "CODIGO_VAZIO", severidade: "ERRO", mensagem: "Elementar sem código." }); continue; }
      const bruto = campo(r, "PRECO");
      const v = lerNumero(bruto);
      if (bruto !== null && v === null) await emitir.ocorrencia({ ...base, regra: "VALOR_INVALIDO", severidade: "ERRO", mensagem: `Preço inválido do elementar ${codigo}.`, valor: bruto });
      if (v) precoElem.set(codigo, v);
      await emitir.preco({ ...base, tipo: "INSUMO", codigo, regime: null, valorTexto: bruto, valor: v ? v.toString() : null });
    }

    // MAT: insumos
    let divergMat = 0;
    for await (const { linha, registro: r } of registros(a.get("MAT")!.arq)) {
      const codigo = campo(r, "ELEMENTAR");
      const base = { arquivo: nome("MAT"), linha };
      if (!codigo) { await emitir.ocorrencia({ ...base, regra: "CODIGO_VAZIO", severidade: "ERRO", mensagem: "Insumo sem código." }); continue; }
      await emitir.item({ ...base, tipo: "INSUMO", codigo, descricao: descricao(r, ["DESCRICAO", "DESCR1", "DESCR2", "DESCR3"]), unidade: campo(r, "UNID"), prioridade: 10 });
      const p = lerNumero(campo(r, "PRECO"));
      const pe = precoElem.get(codigo);
      if (p && pe && !p.eq(pe)) {
        divergMat++;
        await emitir.ocorrencia({ ...base, regra: "PRECO_MAT_DIFERENTE_ELEM", severidade: "AVISO", mensagem: `Preço do insumo ${codigo} no MAT (${p}) difere do ELEM (${pe}); vale o ELEM.`, valor: p.toString() });
      }
    }

    // REUT: composições reutilizadas como elementares
    for await (const { linha, registro: r } of registros(a.get("REUT")!.arq)) {
      const codigo = campo(r, "ELEMENTAR");
      const base = { arquivo: nome("REUT"), linha };
      if (!codigo) { await emitir.ocorrencia({ ...base, regra: "CODIGO_VAZIO", severidade: "ERRO", mensagem: "Elementar reutilizado sem código." }); continue; }
      const compBruto = campo(r, "COMPOSICAO");
      const comp = compBruto ? formatarCodigoEmop(compBruto) : null;
      if (compBruto && !comp) await emitir.ocorrencia({ ...base, regra: "CODIGO_INVALIDO", severidade: "AVISO", mensagem: `Código de composição reutilizada fora do padrão: ${compBruto}.`, valor: compBruto });
      await emitir.item({
        ...base, tipo: "INSUMO", codigo, descricao: descricao(r, ["DESCRICAO", "DESCR1", "DESCR2", "DESCR3"]), unidade: campo(r, "UNIDADE"),
        grupo: "COMPOSIÇÃO REUTILIZADA", atributos: { composicao_reutilizada: comp ?? compBruto }, prioridade: 10,
      });
    }

    // DIPR: serviços (descrição, unidade, custo publicado)
    const custo = new Map<string, Dec>();
    const indices = new Set<string>();
    for await (const { linha, registro: r } of registros(a.get("DIPR")!.arq)) {
      const codigo = campo(r, "CODIGO");
      const base = { arquivo: nome("DIPR"), linha };
      if (!codigo) { await emitir.ocorrencia({ ...base, regra: "CODIGO_VAZIO", severidade: "ERRO", mensagem: "Serviço sem código." }); continue; }
      if (!RE_CODIGO_SERVICO.test(codigo)) await emitir.ocorrencia({ ...base, regra: "CODIGO_FORA_DO_PADRAO", severidade: "AVISO", mensagem: `Código fora do padrão CC.FFF.IIII-D: ${codigo}.`, valor: codigo });
      if (RE_INDICE.test(codigo) && !campo(r, "UNID")) {
        indices.add(codigo);
        await emitir.ocorrencia({
          ...base, regra: "INDICE_SETORIAL", severidade: "INFO", campo: "CUSTO", valor: campo(r, "CUSTO"),
          mensagem: `Índice setorial ${codigo} — ${descricao(r, ["DESCR1", "DESCR2", "DESCR3"])}: ${campo(r, "CUSTO")} (número-índice; não é preço e não entra no catálogo).`,
        });
        continue;
      }
      const regime = regimeEmop(codigo);
      if (!regime) { await emitir.ocorrencia({ ...base, regra: "REGIME_INDEFINIDO", severidade: "ERRO", mensagem: `Dígito final "${codigo.slice(-1)}" não corresponde a regime publicado.`, valor: codigo }); continue; }
      await emitir.item({
        ...base, tipo: "COMPOSICAO", codigo, descricao: descricao(r, ["DESCR1", "DESCR2", "DESCR3", "DESCR4", "DESCR5", "DESCR6"]), unidade: campo(r, "UNID"),
        grupo: codigo.slice(0, 2), atributos: { categoria: codigo.slice(0, 2), familia: codigo.slice(0, 6) }, prioridade: 10,
      });
      const bruto = campo(r, "CUSTO");
      const v = lerNumero(bruto);
      if (bruto !== null && v === null) await emitir.ocorrencia({ ...base, regra: "VALOR_INVALIDO", severidade: "ERRO", mensagem: `Custo inválido do serviço ${codigo}.`, valor: bruto });
      if (v) custo.set(codigo, v);
      await emitir.preco({ ...base, tipo: "COMPOSICAO", codigo, regime, valorTexto: bruto, valor: v ? v.toString() : null });
    }

    // EMOP: preço do serviço deve ser igual ao custo do DIPR
    const vistosEmop = new Set<string>();
    for await (const { linha, registro: r } of registros(a.get("EMOP")!.arq)) {
      const codigo = campo(r, "CODIGO");
      if (!codigo || indices.has(codigo)) continue;
      vistosEmop.add(codigo);
      const v = lerNumero(campo(r, "PRECO"));
      const c = custo.get(codigo);
      const base = { arquivo: nome("EMOP"), linha };
      if (c === undefined) await emitir.ocorrencia({ ...base, regra: "SERVICO_SEM_DESCRICAO", severidade: "ERRO", mensagem: `Serviço ${codigo} tem preço no EMOP mas não consta do DIPR.`, valor: codigo });
      else if (!v || !v.eq(c)) await emitir.ocorrencia({ ...base, regra: "PRECO_EMOP_DIFERENTE_DIPR", severidade: "ERRO", mensagem: `Preço do serviço ${codigo} no EMOP (${v}) difere do custo no DIPR (${c}).`, valor: String(v) });
    }
    for (const codigo of custo.keys()) {
      if (!vistosEmop.has(codigo)) await emitir.ocorrencia({ arquivo: nome("EMOP"), regra: "SERVICO_AUSENTE_EMOP", severidade: "AVISO", mensagem: `Serviço ${codigo} do DIPR não consta do arquivo EMOP.`, valor: codigo });
    }

    // COMP: composições analíticas + conferência do custo publicado
    let atual: string | null = null;
    let soma = dec(0);
    let completo = true;
    const ordens = new Set<number>();
    const stats = { conferem: 0, umCentavo: 0, divergem: 0, semPreco: 0 };
    const fechar = async () => {
      if (!atual) return;
      const publicado = custo.get(atual);
      if (!publicado || !completo) { stats.semPreco++; return; }
      const calc = soma.toDecimalPlaces(2, D.ROUND_DOWN);
      const dif = calc.minus(publicado).abs();
      if (dif.isZero()) stats.conferem++;
      else if (dif.lte("0.01")) stats.umCentavo++;
      else {
        stats.divergem++;
        await emitir.ocorrencia({ arquivo: nome("COMP"), regra: "RECALCULO_DIVERGENTE", severidade: "AVISO", mensagem: `Serviço ${atual}: custo recalculado pela analítica (${calc}) difere do publicado (${publicado}).`, valor: calc.toString() });
      }
    };
    for await (const { linha, registro: r } of registros(a.get("COMP")!.arq)) {
      const codigo = campo(r, "CODIGO");
      const base = { arquivo: nome("COMP"), linha };
      if (!codigo) { await emitir.ocorrencia({ ...base, regra: "CODIGO_VAZIO", severidade: "ERRO", mensagem: "Linha de composição sem código do serviço." }); continue; }
      if (indices.has(codigo)) { await emitir.ocorrencia({ ...base, regra: "ANALITICA_DE_INDICE", severidade: "ERRO", mensagem: `Índice ${codigo} com analítica — layout inesperado.` }); continue; }
      if (codigo !== atual) {
        await fechar();
        atual = codigo;
        soma = dec(0);
        completo = true;
        ordens.clear();
      }
      const seqTxt = campo(r, "SEQUENCIA");
      const ordem = seqTxt && /^\d+$/.test(seqTxt) ? Number(seqTxt) : NaN;
      if (!Number.isInteger(ordem) || ordens.has(ordem)) {
        await emitir.ocorrencia({ ...base, regra: "SEQUENCIA_INVALIDA", severidade: "ERRO", mensagem: `Sequência inválida ou repetida (${seqTxt}) no serviço ${codigo}.`, valor: seqTxt });
        continue;
      }
      ordens.add(ordem);
      const elem = campo(r, "ELEMENTAR");
      if (!elem) { await emitir.ocorrencia({ ...base, regra: "COMPONENTE_SEM_CODIGO", severidade: "ERRO", mensagem: `Componente sem código no serviço ${codigo}.` }); continue; }
      const qTxt = campo(r, "QUANTIDADE");
      const pTxt = campo(r, "PERCENTUAL");
      const q = lerNumero(qTxt);
      const pct = lerNumero(pTxt);
      await emitir.componente({
        ...base, composicao: codigo, regime: null, ordem, componenteTipo: "INSUMO", componenteCodigo: elem,
        coeficienteTexto: qTxt, coeficiente: q ? q.toString() : null, percentualTexto: pTxt, percentual: pct ? pct.toString() : null,
      });
      const pe = precoElem.get(elem);
      if (!q || !pe) completo = false;
      else soma = soma.plus(q.times(pe).times(dec(1).plus((pct ?? dec(0)).div(100))));
    }
    await fechar();
    await emitir.ocorrencia({
      arquivo: nome("COMP"), regra: "RECALCULO_RESUMO", severidade: "INFO",
      mensagem: `Conferência do custo publicado pela analítica: ${stats.conferem} idênticos, ${stats.umCentavo} com diferença de R$ 0,01, ${stats.divergem} divergentes, ${stats.semPreco} sem recálculo possível.`,
    });
    if (divergMat) await emitir.ocorrencia({ arquivo: nome("MAT"), regra: "PRECO_MAT_DIFERENTE_ELEM_RESUMO", severidade: "INFO", mensagem: `${divergMat} insumos com preço diferente entre MAT e ELEM.` });
  },
};
