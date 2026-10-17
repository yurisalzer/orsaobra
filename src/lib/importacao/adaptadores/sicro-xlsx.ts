/**
 * Adaptador SICRO (DNIT) — relatórios XLSX por UF e mês.
 * Layout verificado no pacote oficial RJ 07/2026 (ver docs/LAYOUTS.md).
 *
 * Arquivos usados (o pacote traz também PDFs e relatórios de encargos, que
 * não são necessários):
 *  - Relatório Sintético de Composições de Custos  → custo das composições
 *  - Relatório Sintético de Materiais              → preço dos materiais (único)
 *  - Relatório Sintético de Mão de Obra (+ com desoneração)
 *  - Relatório Sintético de Equipamentos (+ com desoneração)
 *  - Relatório Analítico de Composições de Custos  → composição publicada
 *
 * Regras (nada é presumido nem recalculado):
 *  - O SICRO publica o custo das composições somente SEM desoneração (é o
 *    que o pacote traz); mão de obra e equipamentos nos dois regimes;
 *    materiais com preço único.
 *  - Equipamento: preço = custo horário PRODUTIVO; o improdutivo e as demais
 *    parcelas ficam guardados como atributos.
 *  - A composição analítica do SICRO tem estrutura própria (equipamentos com
 *    utilização operativa/improdutiva, produção da equipe, FIC, atividades
 *    auxiliares, tempo fixo e momento de transporte). Ela é guardada como foi
 *    publicada, junto ao custo da composição, para consulta e relatórios —
 *    não é convertida em coeficientes.
 *  - Momento de transporte: o SICRO não inclui o custo (depende da DMT da
 *    obra); o custo unitário publicado é sem transporte.
 *  - Preço "-" na publicação = sem preço (fica sem preço, nunca zero).
 *  - Composição com custo zero (genéricas, ex.: "Concreto") = sem preço.
 *  - Linhas idênticas repetidas (alguns equipamentos) são lidas uma vez.
 */
import { lerNumero } from "@/lib/calculo/decimal";
import type { ArquivoEntrada } from "../leitores/arquivo";
import { PastaXlsx, texto, type LinhaXlsx } from "../leitores/xlsx";
import type { Adaptador, Emissor, Identificacao } from "../tipos";

const RE_ARQUIVO = /^([A-Z]{2}) (\d{2})-(\d{4}) Relatório (Sintético|Analítico) de (.+)\.xlsx$/i;

const UF_NOME: Record<string, string> = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia", CE: "Ceará", DF: "Distrito Federal", ES: "Espírito Santo", GO: "Goiás",
  MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais", PA: "Pará", PB: "Paraíba", PR: "Paraná", PE: "Pernambuco",
  PI: "Piauí", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte", RS: "Rio Grande do Sul", RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina",
  SP: "São Paulo", SE: "Sergipe", TO: "Tocantins",
};
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

const REGIMES = [
  { codigo: "SEM_DESONERACAO", nome: "Sem desoneração" },
  { codigo: "COM_DESONERACAO", nome: "Com desoneração" },
];

/** Papéis dos arquivos e o cabeçalho (linha 1) esperado. */
const PAPEIS = {
  composicoes: { tipo: "Sintético", nome: "Composições de Custos", cab: ["CÓDIGO", "DESCRIÇÃO DO SERVIÇO", "UNIDADE", "CUSTO UNITÁRIO (R$)"] },
  materiais: { tipo: "Sintético", nome: "Materiais", cab: ["CÓDIGO", "DESCRIÇÃO", "UNIDADE", "PREÇO UNITÁRIO (R$)"] },
  maoDeObra: { tipo: "Sintético", nome: "Mão de Obra", cab: ["CÓDIGO", "DESCRIÇÃO", "UNIDADE", "CUSTO (R$)"] },
  maoDeObraDes: { tipo: "Sintético", nome: "Mão de Obra - com desoneração", cab: ["CÓDIGO", "DESCRIÇÃO", "UNIDADE", "CUSTO (R$)"] },
  equipamentos: { tipo: "Sintético", nome: "Equipamentos", cab: CAB_EQUIP() },
  equipamentosDes: { tipo: "Sintético", nome: "Equipamentos - com desoneração", cab: CAB_EQUIP() },
  analitico: { tipo: "Analítico", nome: "Composições de Custos", cab: [] as string[] },
} as const;
type Papel = keyof typeof PAPEIS;

function CAB_EQUIP() {
  return ["CÓDIGO", "DESCRIÇÃO", "VALOR DE AQUISIÇÃO (R$)", "DEPRECIAÇÃO (R$/H)", "OPORTUNIDADE DE CAPITAL (R$/H)", "SEGUROS E IMPOSTOS (R$/H)",
    "MANUTENÇÃO (R$/H)", "OPERAÇÃO (R$/H)", "MÃO DE OBRA DE OPERAÇÃO (R$/H)", "CUSTO PRODUTIVO (R$/H)", "CUSTO IMPRODUTIVO (R$/H)"];
}
const ATRIB_EQUIP = ["valor_aquisicao", "depreciacao", "oportunidade_capital", "seguros_impostos", "manutencao", "operacao", "mao_de_obra_operacao", "custo_produtivo", "custo_improdutivo"];

const norm = (s: string | null) => (s ?? "").normalize("NFC").replace(/\s+/g, " ").trim().toUpperCase();
const nomeArq = (a: ArquivoEntrada) => a.nome.split(/[\\/]/).pop()!.normalize("NFC");

function classificar(arquivos: ArquivoEntrada[]) {
  const achados = new Map<Papel, ArquivoEntrada>();
  let uf: string | null = null;
  let competencia: string | null = null;
  for (const a of arquivos) {
    const m = RE_ARQUIVO.exec(nomeArq(a));
    if (!m) continue;
    const [, u, mes, ano, tipo, resto] = m;
    for (const [papel, def] of Object.entries(PAPEIS) as [Papel, (typeof PAPEIS)[Papel]][]) {
      if (norm(tipo) === norm(def.tipo) && norm(resto) === norm(def.nome)) {
        achados.set(papel, a);
        uf ??= u.toUpperCase();
        competencia ??= `${ano}-${mes}`;
      }
    }
  }
  return { achados, uf, competencia };
}

// ---------------------------------------------------------------------------
// Composição analítica SICRO (estrutura publicada)
// ---------------------------------------------------------------------------

export interface AnaliticaSicro {
  fic: string | null;
  producao: { quantidade: string | null; unidade: string | null };
  equipamentos: { codigo: string; descricao: string | null; quantidade: string | null; operativa: string | null; improdutiva: string | null; custoProdutivo: string | null; custoImprodutivo: string | null; custoHorario: string | null }[];
  maoDeObra: { codigo: string; descricao: string | null; quantidade: string | null; unidade: string | null; custoHorario: string | null; custo: string | null }[];
  materiais: { codigo: string; descricao: string | null; quantidade: string | null; unidade: string | null; precoUnitario: string | null; custo: string | null }[];
  auxiliares: { codigo: string; descricao: string | null; quantidade: string | null; unidade: string | null; custoUnitario: string | null; custo: string | null }[];
  tempoFixo: { item: string; descricao: string | null; codigo: string | null; quantidade: string | null; unidade: string | null; custoUnitario: string | null; custo: string | null }[];
  transporte: { item: string; descricao: string | null; quantidade: string | null; unidade: string | null; ln: string | null; rp: string | null; p: string | null; fit: string | null; custo: string | null }[];
  totais: Record<string, string | null>;
  observacoes: string[];
}

const TOTAIS: Record<string, string> = {
  "CUSTO HORÁRIO TOTAL DE EQUIPAMENTOS": "equipamentos",
  "CUSTO HORÁRIO TOTAL DE MÃO DE OBRA": "maoDeObra",
  "CUSTO HORÁRIO TOTAL DE EXECUÇÃO": "execucaoHorario",
  "CUSTO UNITÁRIO DE EXECUÇÃO": "execucaoUnitario",
  "CUSTO DO FIC": "fic",
  "CUSTO UNITÁRIO TOTAL DE MATERIAL": "material",
  "CUSTO TOTAL DE ATIVIDADES AUXILIARES": "auxiliares",
  SUBTOTAL: "subtotal",
  "CUSTO UNITÁRIO TOTAL DE TEMPO FIXO": "tempoFixo",
  "CUSTO UNITÁRIO TOTAL DE TRANSPORTE": "transporte",
  "CUSTO UNITÁRIO DIRETO TOTAL": "total",
};
const SECOES: Record<string, keyof Pick<AnaliticaSicro, "equipamentos" | "maoDeObra" | "materiais" | "auxiliares" | "tempoFixo" | "transporte">> = {
  "A - EQUIPAMENTOS": "equipamentos",
  "B - MÃO DE OBRA": "maoDeObra",
  "C - MATERIAL": "materiais",
  "D - ATIVIDADES AUXILIARES": "auxiliares",
  "E - TEMPO FIXO": "tempoFixo",
  "F - MOMENTO DE TRANSPORTE": "transporte",
};
const MARCA = "SISTEMA DE CUSTOS REFERENCIAIS DE OBRAS - SICRO";

interface BlocoLido { codigo: string; descricao: string | null; analitica: AnaliticaSicro; linha: number; local: string | null; mes: string | null }

/** Lê o analítico inteiro (uma composição por bloco). */
async function lerAnalitico(pasta: PastaXlsx, arquivo: string, emitir: Emissor): Promise<Map<string, BlocoLido>> {
  const blocos = new Map<string, BlocoLido>();
  let atual: BlocoLido | null = null;
  let secao: (typeof SECOES)[string] | "obs" | null = null;
  let etapa = 0; // 0 = marca lida; 1 = linha do mês lida; 2 = código lido
  const fechar = () => { if (atual) blocos.set(atual.codigo, atual); };
  for await (const l of pasta.linhas(pasta.abas[0].nome)) {
    const t = (c: number) => texto(l, c);
    const a = norm(t(0));
    if (a === MARCA) {
      fechar();
      atual = { codigo: "", descricao: null, linha: l.numero, local: t(3), mes: null, analitica: { fic: null, producao: { quantidade: null, unidade: null }, equipamentos: [], maoDeObra: [], materiais: [], auxiliares: [], tempoFixo: [], transporte: [], totais: {}, observacoes: [] } };
      if (norm(t(6)) === "FIC") atual.analitica.fic = t(7);
      secao = null;
      etapa = 0;
      continue;
    }
    if (!atual) continue;
    if (etapa === 0) {
      if (norm(t(0)) !== "CUSTO UNITÁRIO DE REFERÊNCIA" || !norm(t(6)).startsWith("PRODUÇÃO DA EQUIPE")) {
        throw new Error(`${arquivo}, linha ${l.numero}: cabeçalho da composição diferente do layout conhecido.`);
      }
      atual.mes = t(3);
      atual.analitica.producao = { quantidade: t(7), unidade: t(8) };
      etapa = 1;
      continue;
    }
    if (etapa === 1) {
      atual.codigo = t(0) ?? "";
      atual.descricao = t(1);
      if (!/^\d+$/.test(atual.codigo)) throw new Error(`${arquivo}, linha ${l.numero}: código da composição não encontrado.`);
      etapa = 2;
      continue;
    }
    if (SECOES[a]) { secao = SECOES[a]; continue; }
    if (a === "OBS.") { secao = "obs"; continue; }
    // totais: o rótulo pode estar nas colunas 2, 4 ou 6; o valor na coluna 8
    const rotulo = [2, 4, 6].map((c) => norm(t(c))).find((x) => TOTAIS[x]);
    if (rotulo) { atual.analitica.totais[TOTAIS[rotulo]] = t(8); continue; }
    if (secao === "obs") { const o = [...l.celulas.values()].map((c) => c.valor?.trim()).filter(Boolean).join(" "); if (o) atual.analitica.observacoes.push(o); continue; }
    const codigo = t(0);
    if (!codigo || !secao) continue; // linhas de títulos de colunas e vazias
    if (["QUANTIDADE", "UTILIZAÇÃO"].includes(norm(t(2))) || norm(t(3)) === "OPERATIVA" || norm(t(4)) === "LN") continue;
    const an = atual.analitica;
    switch (secao) {
      case "equipamentos": an.equipamentos.push({ codigo, descricao: t(1), quantidade: t(2), operativa: t(3), improdutiva: t(4), custoProdutivo: t(5), custoImprodutivo: t(6), custoHorario: t(8) }); break;
      case "maoDeObra": an.maoDeObra.push({ codigo, descricao: t(1), quantidade: t(2), unidade: t(3), custoHorario: t(5), custo: t(8) }); break;
      case "materiais": an.materiais.push({ codigo, descricao: t(1), quantidade: t(2), unidade: t(3), precoUnitario: t(5), custo: t(8) }); break;
      case "auxiliares": an.auxiliares.push({ codigo, descricao: t(1), quantidade: t(2), unidade: t(3), custoUnitario: t(5), custo: t(8) }); break;
      case "tempoFixo": an.tempoFixo.push({ item: codigo, descricao: t(1), codigo: t(2), quantidade: t(3), unidade: t(4), custoUnitario: t(6), custo: t(8) }); break;
      case "transporte": an.transporte.push({ item: codigo, descricao: t(1), quantidade: t(2), unidade: t(3), ln: t(4), rp: t(5), p: t(6), fit: t(7), custo: t(8) }); break;
    }
  }
  fechar();
  if (!blocos.size) throw new Error(`${arquivo}: nenhuma composição encontrada no layout conhecido.`);
  void emitir;
  return blocos;
}

/**
 * Linhas de dados (após o cabeçalho). Uma linha IDÊNTICA a outra já lida (o
 * DNIT repete alguns equipamentos) é ignorada com registro informativo; se o
 * código se repetir com valores diferentes, segue adiante e a validação acusa.
 */
async function* linhasDados(pasta: PastaXlsx, arquivo: string, cabEsperado: readonly string[], emitir: Emissor): AsyncGenerator<LinhaXlsx> {
  let cabOk = false;
  const vistas = new Map<string, number>();
  for await (const l of pasta.linhas(pasta.abas[0].nome)) {
    if (!cabOk) {
      const lido = cabEsperado.map((_, i) => norm(texto(l, i)));
      if (lido.join("|") !== cabEsperado.join("|")) throw new Error(`${arquivo}: cabeçalho diferente do layout conhecido (${lido.join(", ")}).`);
      cabOk = true;
      continue;
    }
    const assinatura = JSON.stringify([...l.celulas.entries()].filter(([, c]) => c.valor !== null).map(([i, c]) => [i, c.valor]));
    const anterior = vistas.get(assinatura);
    if (anterior !== undefined && texto(l, 0)) {
      await emitir.ocorrencia({ arquivo, linha: l.numero, regra: "LINHA_REPETIDA", severidade: "INFO", mensagem: `Linha idêntica à linha ${anterior} (código ${texto(l, 0)}) — ignorada.` });
      continue;
    }
    vistas.set(assinatura, l.numero);
    yield l;
  }
  if (!cabOk) throw new Error(`${arquivo}: planilha vazia.`);
}

export const adaptadorSicroXlsx: Adaptador = {
  id: "sicro-xlsx",
  versao: "1.0.0",
  fonte: "SICRO",
  descricao: "SICRO (DNIT) — relatórios XLSX por UF (sintéticos e analítico de composições)",

  async identificar(arquivos, { uf }) {
    const { achados, uf: ufArq, competencia } = classificar(arquivos);
    if (!achados.size) return null;
    const faltando = (Object.keys(PAPEIS) as Papel[]).filter((p) => !achados.has(p));
    if (faltando.length) {
      return { ok: false, motivo: `Pacote SICRO incompleto: faltam os relatórios ${faltando.map((p) => `${PAPEIS[p].tipo} de ${PAPEIS[p].nome}`).join("; ")} (XLSX).` };
    }
    if (ufArq !== uf) return { ok: false, motivo: `Os arquivos são da UF ${ufArq}, mas a importação é para ${uf}.` };
    const ufs = new Set([...achados.values()].map((a) => RE_ARQUIVO.exec(nomeArq(a))![1].toUpperCase()));
    const comps = new Set([...achados.values()].map((a) => { const m = RE_ARQUIVO.exec(nomeArq(a))!; return `${m[3]}-${m[2]}`; }));
    if (ufs.size > 1 || comps.size > 1) return { ok: false, motivo: "Os arquivos são de UFs ou meses diferentes." };
    // confere UF e mês no conteúdo do analítico (primeira composição)
    const pasta = await PastaXlsx.abrir(await achados.get("analitico")!.bytes());
    let local: string | null = null;
    let mes: string | null = null;
    for await (const l of pasta.linhas(pasta.abas[0].nome)) {
      if (l.numero === 1) local = texto(l, 3);
      if (l.numero === 2) { mes = texto(l, 3); break; }
    }
    const [ano, mm] = competencia!.split("-");
    const mesEsperado = `${MESES[Number(mm) - 1]}/${ano}`;
    if (norm(local) !== norm(UF_NOME[uf] ?? uf) || norm(mes) !== norm(mesEsperado)) {
      return { ok: false, motivo: `O analítico indica "${local ?? "?"} — ${mes ?? "?"}", diferente do nome dos arquivos (${uf}, ${mm}/${ano}).` };
    }
    return {
      ok: true,
      identificacao: {
        adaptador: this.id,
        versao: this.versao,
        fonte: "SICRO",
        uf,
        competencia: competencia!,
        layout: "SICRO — relatórios XLSX (sintéticos de composições, materiais, mão de obra e equipamentos; analítico de composições)",
        regimes: REGIMES,
        arquivos: (Object.keys(PAPEIS) as Papel[]).map((p) => ({ nome: nomeArq(achados.get(p)!), papel: `${PAPEIS[p].tipo} de ${PAPEIS[p].nome}` })),
        dataEmissao: null,
        observacoes: [
          "Composições: o SICRO publica o custo somente sem desoneração (com desoneração não vem no pacote e não é recalculado).",
          "Mão de obra e equipamentos: nos dois regimes. Materiais: preço único.",
          "Equipamentos: preço = custo horário produtivo (o improdutivo fica registrado).",
          "Composição analítica guardada como publicada pelo DNIT. Momento de transporte sem custo: depende da DMT da obra.",
        ],
      },
    };
  },

  async ler(arquivos, ident: Identificacao, emitir: Emissor) {
    const { achados } = classificar(arquivos);
    const abrir = async (p: Papel) => ({ pasta: await PastaXlsx.abrir(await achados.get(p)!.bytes()), nome: nomeArq(achados.get(p)!) });

    // 1. Analítico (lido primeiro: vai junto do custo de cada composição)
    const an = await abrir("analitico");
    const analiticas = await lerAnalitico(an.pasta, an.nome, emitir);

    // 2. Composições (custo sem desoneração)
    const cp = await abrir("composicoes");
    const vistas = new Set<string>();
    for await (const l of linhasDados(cp.pasta, cp.nome, PAPEIS.composicoes.cab, emitir)) {
      const codigo = texto(l, 0);
      const base = { arquivo: cp.nome, planilha: null, linha: l.numero };
      if (!codigo) continue;
      vistas.add(codigo);
      await emitir.item({ ...base, tipo: "COMPOSICAO", codigo, descricao: texto(l, 1), unidade: texto(l, 2), grupo: "Composição", prioridade: 10 });
      const bruto = texto(l, 3);
      const valor = lerNumero(bruto);
      if (bruto !== null && bruto !== "-" && valor === null) await emitir.ocorrencia({ ...base, regra: "VALOR_INVALIDO", severidade: "ERRO", mensagem: `Custo não numérico para a composição ${codigo}.`, valor: bruto });
      const bloco = analiticas.get(codigo);
      if (!bloco) {
        await emitir.ocorrencia({ ...base, regra: "SEM_ANALITICA", severidade: "AVISO", mensagem: `Composição ${codigo} sem bloco no relatório analítico.` });
      } else {
        const total = lerNumero(bloco.analitica.totais.total ?? null);
        if (!total || !valor || !total.eq(valor)) {
          await emitir.ocorrencia({ ...base, regra: "ANALITICO_DIVERGENTE", severidade: "AVISO", mensagem: `Composição ${codigo}: custo do sintético (${bruto}) diferente do custo unitário direto total do analítico (${bloco.analitica.totais.total ?? "—"}).` });
        }
        if (norm(bloco.descricao) !== norm(texto(l, 1))) {
          await emitir.ocorrencia({ ...base, regra: "DESCRICAO_DIVERGENTE", severidade: "INFO", mensagem: `Composição ${codigo}: descrição do analítico difere da do sintético.` });
        }
      }
      // custo zero: composições genéricas (ex.: "Concreto", "Material de base") — ficam sem preço, nunca R$ 0,00 no orçamento
      const zero = valor !== null && valor.isZero();
      await emitir.preco({
        ...base, tipo: "COMPOSICAO", codigo, regime: "SEM_DESONERACAO", valorTexto: bruto, valor: valor && !zero ? valor.toString() : null,
        atributos: { ...(bloco ? { analitica_sicro: bloco.analitica } : {}), ...(zero ? { sem_custo: "custo zero na publicação" } : {}) },
      });
    }
    for (const [codigo, b] of analiticas) {
      if (!vistas.has(codigo)) await emitir.ocorrencia({ arquivo: an.nome, linha: b.linha, regra: "ANALITICA_SEM_SINTETICO", severidade: "AVISO", mensagem: `Composição ${codigo} está no analítico e não no sintético (ignorada).` });
    }

    // 3. Materiais (preço único)
    const mt = await abrir("materiais");
    for await (const l of linhasDados(mt.pasta, mt.nome, PAPEIS.materiais.cab, emitir)) {
      const codigo = texto(l, 0);
      if (!codigo) continue;
      const base = { arquivo: mt.nome, planilha: null, linha: l.numero };
      await emitir.item({ ...base, tipo: "INSUMO", codigo, descricao: texto(l, 1), unidade: texto(l, 2), grupo: "Material", prioridade: 10 });
      const bruto = texto(l, 3);
      const valor = lerNumero(bruto);
      if (bruto !== null && bruto !== "-" && valor === null) await emitir.ocorrencia({ ...base, regra: "VALOR_INVALIDO", severidade: "ERRO", mensagem: `Preço não numérico para o material ${codigo}.`, valor: bruto });
      await emitir.preco({ ...base, tipo: "INSUMO", codigo, regime: null, valorTexto: bruto, valor: valor ? valor.toString() : null });
    }

    // 4. Mão de obra (dois regimes)
    for (const [papel, regime, prioridade] of [["maoDeObra", "SEM_DESONERACAO", 10], ["maoDeObraDes", "COM_DESONERACAO", 11]] as const) {
      const mo = await abrir(papel);
      for await (const l of linhasDados(mo.pasta, mo.nome, PAPEIS[papel].cab, emitir)) {
        const codigo = texto(l, 0);
        if (!codigo) continue;
        const base = { arquivo: mo.nome, planilha: null, linha: l.numero };
        await emitir.item({ ...base, tipo: "INSUMO", codigo, descricao: texto(l, 1), unidade: texto(l, 2), grupo: "Mão de obra", prioridade });
        const bruto = texto(l, 3);
        const valor = lerNumero(bruto);
        if (bruto !== null && bruto !== "-" && valor === null) await emitir.ocorrencia({ ...base, regra: "VALOR_INVALIDO", severidade: "ERRO", mensagem: `Custo não numérico para a mão de obra ${codigo}.`, valor: bruto });
        await emitir.preco({ ...base, tipo: "INSUMO", codigo, regime, valorTexto: bruto, valor: valor ? valor.toString() : null });
      }
    }

    // 5. Equipamentos (dois regimes; preço = custo horário produtivo)
    for (const [papel, regime, prioridade] of [["equipamentos", "SEM_DESONERACAO", 10], ["equipamentosDes", "COM_DESONERACAO", 11]] as const) {
      const eq = await abrir(papel);
      for await (const l of linhasDados(eq.pasta, eq.nome, PAPEIS[papel].cab, emitir)) {
        const codigo = texto(l, 0);
        if (!codigo) continue;
        const base = { arquivo: eq.nome, planilha: null, linha: l.numero };
        await emitir.item({ ...base, tipo: "INSUMO", codigo, descricao: texto(l, 1), unidade: "h", grupo: "Equipamento", prioridade });
        const bruto = texto(l, 9);
        const valor = lerNumero(bruto);
        if (bruto !== null && bruto !== "-" && valor === null) await emitir.ocorrencia({ ...base, regra: "VALOR_INVALIDO", severidade: "ERRO", mensagem: `Custo produtivo não numérico para o equipamento ${codigo}.`, valor: bruto });
        await emitir.preco({
          ...base, tipo: "INSUMO", codigo, regime, valorTexto: bruto, valor: valor ? valor.toString() : null,
          atributos: Object.fromEntries(ATRIB_EQUIP.map((k, i) => [k, texto(l, i + 2)])),
        });
      }
    }
  },
};
