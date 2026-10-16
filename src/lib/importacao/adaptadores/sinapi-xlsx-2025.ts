/**
 * Adaptador SINAPI — formato XLSX publicado a partir de 2025.
 * Layout verificado no arquivo oficial de 09/2026 (ver docs/LAYOUTS.md).
 * Lê somente a UF escolhida (padrão RJ). Nada é presumido: cabeçalhos,
 * competência e regimes são conferidos no próprio arquivo.
 */
import { lerNumero } from "@/lib/calculo/decimal";
import type { ArquivoEntrada } from "../leitores/arquivo";
import { PastaXlsx, texto, type LinhaXlsx } from "../leitores/xlsx";
import { competenciaDeMesAno, type Adaptador, type Emissor, type Identificacao, type TipoItemImp } from "../tipos";

const RE_ARQUIVO = /^SINAPI_Refer[eê]ncia_(\d{4})_(\d{2})\.xlsx$/i;

/** Abas e o texto que o título (linha 2) deve conter para cada regime. */
const ABAS_INSUMOS = [
  { aba: "ISD", regime: "SEM_DESONERACAO", titulo: "INSUMOS - ENCARGOS SOCIAIS SEM DESONERAÇÃO" },
  { aba: "ICD", regime: "COM_DESONERACAO", titulo: "INSUMOS - ENCARGOS SOCIAIS COM DESONERAÇÃO" },
  { aba: "ISE", regime: "SEM_ENCARGOS", titulo: "INSUMOS - SEM ENCARGOS SOCIAIS" },
] as const;
const ABAS_COMPOSICOES = [
  { aba: "CSD", regime: "SEM_DESONERACAO", titulo: "COMPOSIÇÕES - ENCARGOS SOCIAIS SEM DESONERAÇÃO" },
  { aba: "CCD", regime: "COM_DESONERACAO", titulo: "COMPOSIÇÕES - ENCARGOS SOCIAIS COM DESONERAÇÃO" },
  { aba: "CSE", regime: "SEM_ENCARGOS", titulo: "COMPOSIÇÕES - SEM ENCARGOS SOCIAIS" },
] as const;
const ABA_ANALITICO = "Analítico";

const REGIMES = [
  { codigo: "SEM_DESONERACAO", nome: "Encargos sociais sem desoneração" },
  { codigo: "COM_DESONERACAO", nome: "Encargos sociais com desoneração" },
  { codigo: "SEM_ENCARGOS", nome: "Sem encargos sociais" },
];

const norm = (s: string | null) => (s ?? "").replace(/\s+/g, " ").trim().toUpperCase();

async function cabecalho(pasta: PastaXlsx, aba: string, limite = 20) {
  const linhas: LinhaXlsx[] = [];
  for await (const l of pasta.linhas(aba)) {
    linhas.push(l);
    if (l.numero >= limite) break;
  }
  return linhas;
}

function acharArquivo(arquivos: ArquivoEntrada[]) {
  return arquivos.find((a) => RE_ARQUIVO.test(a.nome));
}

export const adaptadorSinapiXlsx2025: Adaptador = {
  id: "sinapi-xlsx-2025",
  versao: "1.0.0",
  fonte: "SINAPI",
  descricao: "SINAPI — planilha de referência XLSX (formato 2025+)",

  async identificar(arquivos, { uf }) {
    const arq = acharArquivo(arquivos);
    if (!arq) return null;
    const [, ano, mes] = RE_ARQUIVO.exec(arq.nome)!;
    let pasta: PastaXlsx;
    try {
      pasta = await PastaXlsx.abrir(await arq.bytes());
    } catch (e) {
      return { ok: false, motivo: `${arq.nome}: ${(e as Error).message}` };
    }
    const nomes = pasta.abas.map((a) => a.nome);
    const exigidas = [...ABAS_INSUMOS.map((a) => a.aba), ...ABAS_COMPOSICOES.map((a) => a.aba), ABA_ANALITICO];
    const faltando = exigidas.filter((a) => !nomes.includes(a));
    if (faltando.length) return { ok: false, motivo: `Layout não reconhecido: faltam as abas ${faltando.join(", ")}.` };

    const competencia = `${ano}-${mes}`;
    let dataEmissao: string | null = null;
    for (const aba of exigidas) {
      const cab = await cabecalho(pasta, aba, 3);
      const titulo = norm(texto(cab.find((l) => l.numero === 2)!, 0));
      const linhaMes = cab.find((l) => l.numero === 3);
      const comp = competenciaDeMesAno(linhaMes ? texto(linhaMes, 1) : null);
      if (comp !== competencia) {
        return { ok: false, motivo: `Aba ${aba}: mês de referência "${linhaMes ? texto(linhaMes, 1) : "?"}" diverge do nome do arquivo (${mes}/${ano}).` };
      }
      const esperado = [...ABAS_INSUMOS, ...ABAS_COMPOSICOES].find((a) => a.aba === aba)?.titulo;
      if (esperado && !titulo.includes(esperado)) {
        return { ok: false, motivo: `Aba ${aba}: título "${titulo}" não corresponde ao regime esperado (${esperado}).` };
      }
    }
    const isd = await cabecalho(pasta, "ISD", 4);
    dataEmissao = texto(isd.find((l) => l.numero === 4)!, 1);

    return {
      ok: true,
      identificacao: {
        adaptador: this.id,
        versao: this.versao,
        fonte: "SINAPI",
        uf,
        competencia,
        layout: "SINAPI XLSX 2025+ (ISD/ICD/ISE, CSD/CCD/CSE, Analítico)",
        regimes: REGIMES,
        arquivos: [{ nome: arq.nome, papel: "Planilha de referência" }],
        dataEmissao,
        observacoes: [
          `Somente a UF ${uf} será importada.`,
          "Preço de insumo em branco = sem coleta mínima no mês (fica sem preço).",
          "Custo de composição zerado = item sem custo/preço (fica sem preço, conforme nota oficial).",
        ],
      },
    };
  },

  async ler(arquivos, ident: Identificacao, emitir: Emissor) {
    const arq = acharArquivo(arquivos)!;
    const pasta = await PastaXlsx.abrir(await arq.bytes());
    const uf = ident.uf;

    // ---------------- Insumos ----------------
    for (const [idx, def] of ABAS_INSUMOS.entries()) {
      let colUf = -1;
      let cabecalhoOk = false;
      for await (const l of pasta.linhas(def.aba)) {
        if (!cabecalhoOk) {
          if (norm(texto(l, 0)) === "CLASSIFICAÇÃO" && norm(texto(l, 1)).startsWith("CÓDIGO DO")) {
            for (const [c, cel] of l.celulas) if (norm(cel.valor) === uf) colUf = c;
            if (colUf < 0) throw new Error(`Aba ${def.aba}: coluna da UF ${uf} não encontrada no cabeçalho.`);
            if (norm(texto(l, 2)) !== "DESCRIÇÃO DO INSUMO" || norm(texto(l, 3)) !== "UNIDADE" || !norm(texto(l, 4)).startsWith("ORIGEM DE")) {
              throw new Error(`Aba ${def.aba}: cabeçalho da linha ${l.numero} diferente do layout conhecido.`);
            }
            cabecalhoOk = true;
          } else if (l.numero > 20) throw new Error(`Aba ${def.aba}: cabeçalho não encontrado.`);
          continue;
        }
        const codigo = texto(l, 1);
        if (codigo === null) {
          if ([...l.celulas.values()].some((c) => c.valor?.trim())) {
            await emitir.ocorrencia({ regra: "LINHA_SEM_CODIGO", severidade: "AVISO", mensagem: "Linha com conteúdo e sem código foi ignorada.", arquivo: arq.nome, planilha: def.aba, linha: l.numero });
          }
          continue;
        }
        const base = { arquivo: arq.nome, planilha: def.aba, linha: l.numero };
        await emitir.item({ ...base, tipo: "INSUMO", codigo, descricao: texto(l, 2), unidade: texto(l, 3), grupo: texto(l, 0), prioridade: 10 + idx }); // descrição preferencial: ISD
        const bruto = texto(l, colUf);
        const valor = lerNumero(bruto);
        if (bruto !== null && valor === null) {
          await emitir.ocorrencia({ ...base, regra: "VALOR_INVALIDO", severidade: "ERRO", mensagem: `Preço não numérico para o insumo ${codigo}.`, campo: uf, valor: bruto });
        }
        await emitir.preco({
          ...base, tipo: "INSUMO", codigo, regime: def.regime, valorTexto: bruto,
          valor: valor ? valor.toString() : null, origemPreco: texto(l, 4),
        });
      }
      if (!cabecalhoOk) throw new Error(`Aba ${def.aba}: cabeçalho não encontrado.`);
    }

    // ---------------- Composições (custos sintéticos) ----------------
    for (const [idx, def] of ABAS_COMPOSICOES.entries()) {
      let colCusto = -1;
      let linhaUfs: LinhaXlsx | null = null;
      let cabecalhoOk = false;
      for await (const l of pasta.linhas(def.aba)) {
        if (!cabecalhoOk) {
          if (norm(texto(l, 0)) === "GRUPO" && norm(texto(l, 1)).startsWith("CÓDIGO DA")) {
            if (!linhaUfs) throw new Error(`Aba ${def.aba}: linha com as UFs não encontrada.`);
            for (const [c, cel] of linhaUfs.celulas) if (norm(cel.valor) === uf) colCusto = c;
            if (colCusto < 0) throw new Error(`Aba ${def.aba}: coluna da UF ${uf} não encontrada.`);
            if (!norm(texto(l, colCusto)).startsWith("CUSTO") || norm(texto(l, colCusto + 1)) !== "%AS") {
              throw new Error(`Aba ${def.aba}: colunas Custo/%AS da UF ${uf} não estão no layout conhecido.`);
            }
            cabecalhoOk = true;
          } else {
            if ([...l.celulas.values()].some((c) => norm(c.valor) === uf)) linhaUfs = l;
            if (l.numero > 20) throw new Error(`Aba ${def.aba}: cabeçalho não encontrado.`);
          }
          continue;
        }
        const cel = l.celulas.get(1);
        const base = { arquivo: arq.nome, planilha: def.aba, linha: l.numero };
        let codigo: string | null = null;
        if (cel?.valor && cel.valor !== "0") codigo = cel.valor.trim();
        else if (cel?.formula) codigo = /MATCH\(\s*(\d+)\s*,/.exec(cel.formula)?.[1] ?? null;
        if (!codigo) {
          if (texto(l, 2)) await emitir.ocorrencia({ ...base, regra: "CODIGO_NAO_EXTRAIDO", severidade: "ERRO", mensagem: "Não foi possível obter o código da composição (nem valor nem fórmula).", valor: cel?.formula ?? null });
          continue;
        }
        await emitir.item({ ...base, tipo: "COMPOSICAO", codigo, descricao: texto(l, 2), unidade: texto(l, 3), grupo: texto(l, 0), prioridade: 10 + idx });
        const bruto = texto(l, colCusto);
        const valor = lerNumero(bruto);
        const as = texto(l, colCusto + 1);
        if (bruto !== null && valor === null && bruto !== "-") {
          await emitir.ocorrencia({ ...base, regra: "VALOR_INVALIDO", severidade: "ERRO", mensagem: `Custo não numérico para a composição ${codigo}.`, campo: uf, valor: bruto });
        }
        // Nota oficial: "Custo zerado (hífen) indica que pelo menos um dos itens da composição não tem custo/preço."
        const semCusto = valor === null || valor.isZero();
        await emitir.preco({
          ...base, tipo: "COMPOSICAO", codigo, regime: def.regime, valorTexto: bruto,
          valor: semCusto ? null : valor!.toString(),
          atributos: { "%AS": as, ...(semCusto && bruto !== null ? { sem_custo: "custo zerado na publicação" } : {}) },
        });
      }
      if (!cabecalhoOk) throw new Error(`Aba ${def.aba}: cabeçalho não encontrado.`);
    }

    // ---------------- Analítico ----------------
    let cabecalhoOk = false;
    let atual: string | null = null;
    let ordem = 0;
    for await (const l of pasta.linhas(ABA_ANALITICO)) {
      if (!cabecalhoOk) {
        if (norm(texto(l, 0)) === "GRUPO" && norm(texto(l, 2)) === "TIPO ITEM") {
          const esperado = ["GRUPO", "CÓDIGO DA COMPOSIÇÃO", "TIPO ITEM", "CÓDIGO DO ITEM", "DESCRIÇÃO", "UNIDADE", "COEFICIENTE", "SITUAÇÃO"];
          const lido = esperado.map((_, i) => norm(texto(l, i)));
          if (lido.join("|") !== esperado.join("|")) throw new Error(`Aba Analítico: cabeçalho diferente do layout conhecido (${lido.join(", ")}).`);
          cabecalhoOk = true;
        } else if (l.numero > 20) throw new Error("Aba Analítico: cabeçalho não encontrado.");
        continue;
      }
      const base = { arquivo: arq.nome, planilha: ABA_ANALITICO, linha: l.numero };
      const comp = texto(l, 1);
      if (!comp) continue;
      const tipoItem = norm(texto(l, 2));
      if (tipoItem === "") {
        atual = comp;
        ordem = 0;
        await emitir.item({ ...base, tipo: "COMPOSICAO", codigo: comp, descricao: texto(l, 4), unidade: texto(l, 5), grupo: texto(l, 0), atributos: { situacao: texto(l, 7) }, prioridade: 20 });
        continue;
      }
      if (comp !== atual) {
        await emitir.ocorrencia({ ...base, regra: "COMPONENTE_SEM_CABECALHO", severidade: "ERRO", mensagem: `Componente da composição ${comp} sem a linha de cabeçalho da composição.` });
        atual = comp;
        ordem = 0;
      }
      if (tipoItem !== "INSUMO" && tipoItem !== "COMPOSICAO") {
        await emitir.ocorrencia({ ...base, regra: "TIPO_ITEM_DESCONHECIDO", severidade: "ERRO", mensagem: `Tipo de item desconhecido: ${texto(l, 2)}`, valor: texto(l, 2) });
        continue;
      }
      const codItem = texto(l, 3);
      if (!codItem) {
        await emitir.ocorrencia({ ...base, regra: "COMPONENTE_SEM_CODIGO", severidade: "ERRO", mensagem: `Componente sem código na composição ${comp}.` });
        continue;
      }
      const coefTxt = texto(l, 6);
      const coef = lerNumero(coefTxt);
      ordem++;
      const tipo = tipoItem as TipoItemImp;
      // o item componente também é descrito aqui (há insumos "SEM PREÇO" que só aparecem no Analítico)
      await emitir.item({ ...base, tipo, codigo: codItem, descricao: texto(l, 4), unidade: texto(l, 5), prioridade: 30 });
      await emitir.componente({
        ...base, composicao: comp, regime: null, ordem, componenteTipo: tipo, componenteCodigo: codItem,
        coeficienteTexto: coefTxt, coeficiente: coef ? coef.toString() : null, situacao: texto(l, 7),
      });
    }
    if (!cabecalhoOk) throw new Error("Aba Analítico: cabeçalho não encontrado.");
  },
};
