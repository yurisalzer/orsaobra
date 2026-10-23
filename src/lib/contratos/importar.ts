/**
 * Estrutura da planilha contratual importada (proposta vencedora ou planilha
 * de medição): grupos, subgrupos e itens a partir das linhas lidas.
 *
 * - Planilha com grupos numerados ("1", "1.1"): a numeração define a árvore.
 * - Sem numeração (comum nas planilhas de medição em PDF): grupo com valor
 *   total é grupo principal; título sem valor logo abaixo é subgrupo dele
 *   ("SERVIÇOS ADMINISTRATIVOS" → "Geral"). Título em maiúsculas que continua
 *   o anterior (quebra de linha) é juntado a ele.
 */
import { montarEstrutura, type LinhaImportada } from "@/lib/orcamento/importar/analisar";

export interface GrupoImportado { chave: string; titulo: string; paiChave: string | null }
export interface ItemImportado extends LinhaImportada { grupoChave: string; preco: string | null }

const maiusculas = (s: string) => /\p{Lu}/u.test(s) && !/\p{Ll}/u.test(s);

export function estruturaContrato(linhas: LinhaImportada[], colunaPreco: "precoUnitario" | "custoUnitario"): { grupos: GrupoImportado[]; itens: ItemImportado[] } {
  const preco = (l: LinhaImportada) => l[colunaPreco];
  const etapas = linhas.filter((l) => l.tipo === "ETAPA");
  if (etapas.some((e) => e.item && /\d/.test(e.item))) {
    const m = montarEstrutura(linhas);
    return { grupos: m.etapas, itens: m.itens.map((i) => ({ ...i, grupoChave: i.etapaChave, preco: preco(i) })) };
  }
  const comValor = etapas.some((e) => e.total !== null) && etapas.some((e) => e.total === null);
  const grupos: GrupoImportado[] = [];
  const itens: ItemImportado[] = [];
  let principal: GrupoImportado | null = null;
  let atual: GrupoImportado | null = null;
  let anterior: LinhaImportada | null = null;
  let n = 0;
  for (const l of linhas) {
    if (l.tipo === "ETAPA") {
      const titulo = l.descricao.trim().slice(0, 300);
      if (anterior?.tipo === "ETAPA" && atual && anterior.total !== null && l.total === null && maiusculas(titulo) && maiusculas(atual.titulo)) {
        atual.titulo = `${atual.titulo} ${titulo}`.slice(0, 400);
      } else if (comValor && l.total === null && principal) {
        atual = { chave: `g${++n}`, titulo, paiChave: principal.chave };
        grupos.push(atual);
      } else {
        principal = atual = { chave: `g${++n}`, titulo, paiChave: null };
        grupos.push(atual);
      }
    } else if (l.tipo === "ITEM") {
      if (!atual) { principal = atual = { chave: `g${++n}`, titulo: "Itens importados", paiChave: null }; grupos.push(atual); }
      itens.push({ ...l, grupoChave: atual.chave, preco: preco(l) });
    }
    if (l.tipo !== "IGNORADA") anterior = l;
  }
  // grupos sem itens (nem subgrupos com itens) saem: costumam ser rodapés ou títulos repetidos
  const usados = new Set(itens.map((i) => i.grupoChave));
  for (const g of [...grupos].reverse()) if (usados.has(g.chave) && g.paiChave) usados.add(g.paiChave);
  return { grupos: grupos.filter((g) => usados.has(g.chave)), itens };
}
