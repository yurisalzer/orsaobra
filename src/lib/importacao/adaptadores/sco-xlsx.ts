/**
 * Adaptador SCO-Rio (Sistema de Custos de Obras e Serviços de Engenharia da
 * Prefeitura do Rio de Janeiro, elaborado pela FGV) — relatórios XLSX.
 * Layout verificado nos pacotes de 09/2026 (ver docs/LAYOUTS.md).
 *
 * Arquivos (em cada pacote "O" = onerado ou "D" = desonerado):
 *  - CATÁLOGO DOS ITENS DE SERVIÇO - O|D (FGV06)   → serviços: descrição, unidade e preço
 *  - CATÁLOGO DAS COMPOSIÇÕES - O|D (FGV07)        → componentes e quantidades
 *  - REL DE ITENS ELEMENTARES POR DESCRIÇÃO - O|D (FGV04) → insumos ("elementares") e preços
 * (FGV02 "Tabelas" e FGV08 "Ocorrências" não são necessários.)
 *
 * Regras:
 *  - O = regime "sem desoneração" (onerado); D = "com desoneração". O pacote D
 *    usa códigos próprios para os itens que mudam (ex.: AD 04.05.0706 no D
 *    corresponde a AD 05.05.0706 no O; MOD902450 a MOD002450); itens iguais
 *    (ex.: materiais) têm o mesmo código e recebem preço nos dois regimes.
 *  - O código do serviço é o publicado, com a letra de revisão entre
 *    parênteses: "AD 05.05.0050 (/)", "ET 05.05.0100 (A)".
 *  - Preço do serviço = valor publicado no catálogo (FGV06); a composição é
 *    guardada como publicada (FGV07). Nada é recalculado.
 *  - Elementares "EVE" com unidade "%" são percentuais sobre a mão de obra (o
 *    "preço" publicado é o percentual): ficam sem preço em R$ e, na composição,
 *    com a situação "% sobre a mão de obra".
 */
import { lerNumero } from "@/lib/calculo/decimal";
import type { ArquivoEntrada } from "../leitores/arquivo";
import { PastaXlsx, texto } from "../leitores/xlsx";
import type { Adaptador, Emissor, Identificacao } from "../tipos";

const RE_ARQUIVO = /- ([OD]) \(FGV0([467])\)\.xlsx$/i;
const RE_SERVICO = /^([A-Z]{2} \d{2}\.\d{2}\.\d{4}) \(([A-Z/])\)(?:\s*\(([A-Z]{3}\d+)\))?\s*$/;
const RE_ELEMENTAR = /^[A-Z]{3}\d{6}$/;
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

const REGIME = { O: "SEM_DESONERACAO", D: "COM_DESONERACAO" } as const;
const NOME_REGIME = { O: "Sem desoneração (onerado)", D: "Com desoneração (desonerado)" } as const;
const PAPEL = { "6": "Catálogo dos itens de serviço (FGV06)", "7": "Catálogo das composições (FGV07)", "4": "Relação de itens elementares (FGV04)" } as const;

/** Seções do FGV04 (linha de título) → grupo do elementar. */
const SECOES_FGV04 = ["MATERIAIS", "INSTRUMENTOS E EQUIPAMENTOS", "MÃO DE OBRA DIRETA", "MÃO DE OBRA INDIRETA", "EVENTUAIS", "REUTILIZAÇÃO DE SERVIÇOS", "REUTILIZAÇÃO DE INSTRUMENTOS E EQUIPAMENTOS"];

const norm = (s: string | null) => (s ?? "").normalize("NFC").replace(/\s+/g, " ").trim().toUpperCase();
const limpo = (s: string | null) => { const t = (s ?? "").replace(/\s+/g, " ").trim(); return t || null; };
const nomeArq = (a: ArquivoEntrada) => a.nome.split(/[\\/]/).pop()!.normalize("NFC");

type Pacote = "O" | "D";
type Rel = "4" | "6" | "7";

function classificar(arquivos: ArquivoEntrada[]) {
  const achados = new Map<`${Pacote}${Rel}`, ArquivoEntrada>();
  for (const a of arquivos) {
    const m = RE_ARQUIVO.exec(nomeArq(a));
    if (m) achados.set(`${m[1].toUpperCase() as Pacote}${m[2] as Rel}`, a);
  }
  const pacotes = (["O", "D"] as Pacote[]).filter((p) => (["4", "6", "7"] as Rel[]).some((r) => achados.has(`${p}${r}`)));
  return { achados, pacotes };
}

/** Lê "REFERÊNCIA: Setembro/2026" (linha 3) → "2026-09". */
async function referencia(pasta: PastaXlsx): Promise<string | null> {
  for await (const l of pasta.linhas(pasta.abas[0].nome)) {
    if (l.numero === 3) {
      const m = /^REFER[ÊE]NCIA:\s*([A-Za-zçÇ]+)\/(\d{4})$/i.exec((texto(l, 0) ?? "").trim());
      const mes = m ? MESES.indexOf(m[1].toLowerCase()) : -1;
      return mes >= 0 ? `${m![2]}-${String(mes + 1).padStart(2, "0")}` : null;
    }
    if (l.numero > 3) break;
  }
  return null;
}

export const adaptadorScoXlsx: Adaptador = {
  id: "sco-rio-xlsx",
  versao: "1.0.0",
  fonte: "SCO",
  descricao: "SCO-Rio (Prefeitura do Rio/FGV) — catálogos XLSX FGV04, FGV06 e FGV07 (onerado e/ou desonerado)",

  async identificar(arquivos, { uf }) {
    const { achados, pacotes } = classificar(arquivos);
    if (!pacotes.length) return null;
    if (uf !== "RJ") return { ok: false, motivo: "O SCO é da Prefeitura do Rio de Janeiro: importe com a UF RJ." };
    const faltando = pacotes.flatMap((p) => (["6", "7", "4"] as Rel[]).filter((r) => !achados.has(`${p}${r}`)).map((r) => `${PAPEL[r]} — ${p}`));
    if (faltando.length) return { ok: false, motivo: `Pacote SCO incompleto: faltam ${faltando.join("; ")}.` };
    const comps = new Set<string | null>();
    for (const a of achados.values()) {
      const r = await referencia(await PastaXlsx.abrir(await a.bytes()));
      if (!r) return { ok: false, motivo: `${nomeArq(a)}: linha "REFERÊNCIA: mês/ano" não encontrada (layout desconhecido).` };
      comps.add(r);
    }
    if (comps.size > 1) return { ok: false, motivo: `Os arquivos são de referências diferentes (${[...comps].join(", ")}).` };
    const competencia = [...comps][0]!;
    return {
      ok: true,
      identificacao: {
        adaptador: this.id,
        versao: this.versao,
        fonte: "SCO",
        uf,
        competencia,
        layout: "SCO-Rio — catálogos XLSX (FGV06 serviços, FGV07 composições, FGV04 elementares)",
        regimes: pacotes.map((p) => ({ codigo: REGIME[p], nome: NOME_REGIME[p] })),
        arquivos: pacotes.flatMap((p) => (["6", "7", "4"] as Rel[]).map((r) => ({ nome: nomeArq(achados.get(`${p}${r}`)!), papel: `${PAPEL[r]} — ${NOME_REGIME[p]}` }))),
        dataEmissao: null,
        observacoes: [
          ...(pacotes.length === 1 ? [`Somente o pacote ${pacotes[0] === "O" ? "onerado (O)" : "desonerado (D)"} foi enviado; envie o outro para ter os dois regimes.`] : []),
          "O pacote desonerado (D) usa códigos próprios para os serviços e a mão de obra (ex.: AD 04.05.0706 ≙ AD 05.05.0706).",
          "Preço do serviço = valor publicado no catálogo de itens de serviço (FGV06); a composição (FGV07) é guardada como publicada.",
          "Elementares EVE em \"%\" (percentual sobre a mão de obra) não têm preço em R$.",
        ],
      },
    };
  },

  async ler(arquivos, ident: Identificacao, emitir: Emissor) {
    const { achados, pacotes } = classificar(arquivos);
    const escolhidos = new Set(ident.regimes.map((r) => r.codigo));
    for (const p of pacotes) {
      const regime = REGIME[p];
      if (!escolhidos.has(regime)) continue; // regime desmarcado no assistente: pacote não é lido

      // ---------- Elementares (FGV04) ----------
      const a4 = achados.get(`${p}4`)!;
      const n4 = nomeArq(a4);
      const pct = new Set<string>(); // EVE em "%"
      let secao: string | null = null;
      let cab = false;
      const pasta4 = await PastaXlsx.abrir(await a4.bytes());
      for await (const l of pasta4.linhas(pasta4.abas[0].nome)) {
        const c0 = limpo(texto(l, 0));
        if (!cab) {
          if (norm(c0) === "CÓDIGO") {
            const lido = [0, 1, 2, 3, 4].map((i) => norm(texto(l, i))).join("|");
            if (lido !== "CÓDIGO|DESCRIÇÃO|UNIDADE|REUTILIZADO|PREÇO") throw new Error(`${n4}: cabeçalho diferente do layout conhecido (${lido}).`);
            cab = true;
          } else if (l.numero > 10) throw new Error(`${n4}: cabeçalho não encontrado.`);
          continue;
        }
        if (!c0) continue;
        const tituloSecao = norm(c0).replace(/\s*\(DESONERADO\)$/, "");
        if (SECOES_FGV04.includes(tituloSecao)) { secao = c0.replace(/\s*\(desonerado\)$/i, ""); continue; }
        const base = { arquivo: n4, planilha: null, linha: l.numero };
        if (!RE_ELEMENTAR.test(c0)) {
          await emitir.ocorrencia({ ...base, regra: "LINHA_DESCONHECIDA", severidade: "AVISO", mensagem: `Linha não reconhecida (código "${c0}") foi ignorada.` });
          continue;
        }
        const unidade = limpo(texto(l, 2));
        const reutilizado = limpo(texto(l, 3));
        const bruto = texto(l, 4);
        const valor = lerNumero(bruto);
        const percentual = c0.startsWith("EVE") && unidade === "%";
        if (percentual) pct.add(c0);
        await emitir.item({
          ...base, tipo: "INSUMO", codigo: c0, descricao: limpo(texto(l, 1)), unidade, grupo: secao, prioridade: 10,
          atributos: { ...(reutilizado ? { reutiliza: reutilizado } : {}), ...(percentual ? { percentual_sobre_mao_de_obra: bruto } : {}) },
        });
        if (bruto !== null && valor === null) await emitir.ocorrencia({ ...base, regra: "VALOR_INVALIDO", severidade: "ERRO", mensagem: `Preço não numérico para o elementar ${c0}.`, valor: bruto });
        // "%" não é preço em R$: fica sem preço (o percentual vai nos atributos)
        await emitir.preco({ ...base, tipo: "INSUMO", codigo: c0, regime, valorTexto: bruto, valor: percentual || !valor ? null : valor.toString() });
      }
      if (!cab) throw new Error(`${n4}: planilha vazia.`);

      // ---------- Serviços (FGV06) ----------
      const a6 = achados.get(`${p}6`)!;
      const n6 = nomeArq(a6);
      const pasta6 = await PastaXlsx.abrir(await a6.bytes());
      let area: string | null = null;
      let grupo: string | null = null;
      let subgrupo: string | null = null;
      const servicos = new Set<string>();
      for await (const l of pasta6.linhas(pasta6.abas[0].nome)) {
        if (l.numero <= 3) continue;
        const [c0, c1, c2] = [limpo(texto(l, 0)), limpo(texto(l, 1)), limpo(texto(l, 2))];
        if (c0 && /^[A-Z]{2} /.test(c0)) { area = c0; continue; }
        if (c1 && /^[A-Z]{2} \d{2} /.test(c1)) { grupo = c1; subgrupo = null; continue; }
        if (!c2) continue;
        // grupo publicado na coluna do subgrupo (ocorre no FGV06, ex.: "IP 07 Torres de Aço")
        if (/^[A-Z]{2} \d{2} /.test(c2)) { grupo = c2; subgrupo = null; continue; }
        if (/^[A-Z]{2} \d{2}\.\d{2} /.test(c2) && !RE_SERVICO.test(c2)) { subgrupo = c2; continue; }
        const base = { arquivo: n6, planilha: null, linha: l.numero };
        const m = RE_SERVICO.exec(c2);
        if (!m) {
          await emitir.ocorrencia({ ...base, regra: "CODIGO_DESCONHECIDO", severidade: "AVISO", mensagem: `Código "${c2}" fora do padrão do SCO — linha ignorada.` });
          continue;
        }
        const codigo = `${m[1]} (${m[2]})`;
        servicos.add(codigo);
        await emitir.item({
          ...base, tipo: "COMPOSICAO", codigo, descricao: limpo(texto(l, 3)), unidade: limpo(texto(l, 4)), grupo: subgrupo ?? grupo, prioridade: 10,
          atributos: { "área": area, grupo, subgrupo },
        });
        const bruto = limpo(texto(l, 5));
        const valor = lerNumero(bruto);
        if (bruto !== null && valor === null) await emitir.ocorrencia({ ...base, regra: "VALOR_INVALIDO", severidade: "ERRO", mensagem: `Preço não numérico para o serviço ${codigo}.`, valor: bruto });
        await emitir.preco({ ...base, tipo: "COMPOSICAO", codigo, regime, valorTexto: bruto, valor: valor && !valor.isZero() ? valor.toString() : null });
      }

      // ---------- Composições (FGV07) ----------
      const a7 = achados.get(`${p}7`)!;
      const n7 = nomeArq(a7);
      const pasta7 = await PastaXlsx.abrir(await a7.bytes());
      let atual: string | null = null;
      let ordem = 0;
      const comComposicao = new Set<string>();
      for await (const l of pasta7.linhas(pasta7.abas[0].nome)) {
        if (l.numero <= 3) continue;
        const c0 = limpo(texto(l, 0));
        const base = { arquivo: n7, planilha: null, linha: l.numero };
        if (c0) {
          const m = RE_SERVICO.exec(c0);
          if (m) {
            atual = `${m[1]} (${m[2]})`;
            ordem = 0;
            comComposicao.add(atual);
            if (!servicos.has(atual)) await emitir.ocorrencia({ ...base, regra: "COMPOSICAO_SEM_SERVICO", severidade: "AVISO", mensagem: `Composição ${atual} não consta do catálogo de itens de serviço.` });
            if (m[3]) await emitir.item({ ...base, tipo: "COMPOSICAO", codigo: atual, descricao: null, unidade: null, prioridade: 40, atributos: { reutilizado_como: m[3] } });
          } else atual = null; // título de área
          continue;
        }
        const codigo = limpo(texto(l, 2));
        if (!codigo || norm(codigo) === "CÓDIGO" || !atual) continue;
        if (!RE_ELEMENTAR.test(codigo)) {
          await emitir.ocorrencia({ ...base, regra: "COMPONENTE_DESCONHECIDO", severidade: "ERRO", mensagem: `Componente "${codigo}" da composição ${atual} fora do padrão.` });
          continue;
        }
        const unidade = limpo(texto(l, 4));
        const qtdTxt = limpo(texto(l, 5));
        const qtd = lerNumero(qtdTxt);
        ordem++;
        // descrição do FGV07 vem cortada em 100 caracteres: menor prioridade que a do FGV04
        await emitir.item({ ...base, tipo: "INSUMO", codigo, descricao: limpo(texto(l, 1)), unidade, prioridade: 30 });
        const percentual = pct.has(codigo) || (codigo.startsWith("EVE") && unidade === "%");
        await emitir.componente({
          ...base, composicao: atual, regime: null, ordem, componenteTipo: "INSUMO", componenteCodigo: codigo,
          coeficienteTexto: qtdTxt, coeficiente: qtd ? qtd.toString() : null,
          situacao: percentual ? "% sobre a mão de obra" : norm(texto(l, 3)) === "R" ? "Reutilização" : null,
        });
      }
      for (const s of servicos) {
        if (!comComposicao.has(s)) await emitir.ocorrencia({ arquivo: n7, regra: "SERVICO_SEM_COMPOSICAO", severidade: "AVISO", mensagem: `Serviço ${s} sem composição no catálogo de composições.` });
      }
    }
  },
};
