import { type Dec, dec } from "./decimal";

/** Chave de item: identifica unicamente um insumo/composição de uma fonte. */
export type ChaveItem = string;

export interface Componente {
  item: ChaveItem;
  coeficiente: string | Dec;
}

export interface FonteDeDados {
  /** Componentes da composição, ou null se o item não é composição (ou não tem analítica). */
  componentes(item: ChaveItem): Componente[] | null;
  /** Preço publicado/cotado do item, ou null se não há preço. */
  preco(item: ChaveItem): Dec | null;
}

export class ReferenciaCircularError extends Error {
  constructor(public readonly caminho: ChaveItem[]) {
    super(`Referência circular entre composições: ${caminho.join(" → ")}`);
  }
}

export class PrecoAusenteError extends Error {
  constructor(public readonly item: ChaveItem, public readonly caminho: ChaveItem[]) {
    super(`Preço ausente para ${item} (em ${caminho.join(" → ")})`);
  }
}

/**
 * Detecta ciclo a partir de `raiz`. Retorna o caminho do ciclo ou null.
 * Usado antes de gravar composições próprias.
 */
export function encontrarCiclo(raiz: ChaveItem, componentesDe: (item: ChaveItem) => ChaveItem[] | null): ChaveItem[] | null {
  const emPilha = new Set<ChaveItem>();
  const concluido = new Set<ChaveItem>();
  const pilha: ChaveItem[] = [];
  const visitar = (n: ChaveItem): ChaveItem[] | null => {
    if (emPilha.has(n)) return [...pilha.slice(pilha.indexOf(n)), n];
    if (concluido.has(n)) return null;
    emPilha.add(n);
    pilha.push(n);
    for (const filho of componentesDe(n) ?? []) {
      const c = visitar(filho);
      if (c) return c;
    }
    pilha.pop();
    emPilha.delete(n);
    concluido.add(n);
    return null;
  };
  return visitar(raiz);
}

export interface LinhaAnalitica {
  item: ChaveItem;
  coeficiente: Dec;
  precoUnitario: Dec;
  custo: Dec; // coeficiente × preço, sem arredondamento
}

/**
 * Custo unitário de uma composição = Σ (coeficiente × custo do componente),
 * recursivamente. Sem arredondamentos intermediários: arredonda-se apenas o
 * resultado, conforme a política do orçamento.
 *
 * Preço de composição publicado (sintético) tem prioridade quando
 * `preferirPrecoPublicado` = true — é o valor oficial da fonte. O cálculo
 * analítico é usado para composições próprias e para conferência.
 */
export function custoComposicao(
  raiz: ChaveItem,
  fonte: FonteDeDados,
  opcoes: { preferirPrecoPublicado?: boolean } = {},
): { custo: Dec; linhas: LinhaAnalitica[] } {
  const memo = new Map<ChaveItem, Dec>();
  const custoDe = (item: ChaveItem, caminho: ChaveItem[]): Dec => {
    if (caminho.includes(item)) throw new ReferenciaCircularError([...caminho, item]);
    const cached = memo.get(item);
    if (cached) return cached;
    const comps = fonte.componentes(item);
    let custo: Dec;
    const publicado = fonte.preco(item);
    if (comps === null || (opcoes.preferirPrecoPublicado && publicado !== null && item !== raiz)) {
      if (publicado === null) throw new PrecoAusenteError(item, [...caminho, item]);
      custo = publicado;
    } else {
      custo = dec(0);
      for (const c of comps) {
        custo = custo.plus(dec(c.coeficiente as string).times(custoDe(c.item, [...caminho, item])));
      }
    }
    memo.set(item, custo);
    return custo;
  };

  const comps = fonte.componentes(raiz);
  if (comps === null) throw new Error(`${raiz} não possui composição analítica`);
  const linhas: LinhaAnalitica[] = comps.map((c) => {
    const coef = dec(c.coeficiente as string);
    const pu = custoDe(c.item, [raiz]);
    return { item: c.item, coeficiente: coef, precoUnitario: pu, custo: coef.times(pu) };
  });
  const custo = linhas.reduce((acc, l) => acc.plus(l.custo), dec(0));
  return { custo, linhas };
}
