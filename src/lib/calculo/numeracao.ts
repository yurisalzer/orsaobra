export interface NoEtapa {
  id: string;
  paiId: string | null;
  ordem: number;
}

/** Numeração hierárquica "1", "1.1", "1.1.2" a partir da árvore de etapas. */
export function numerarEtapas(etapas: NoEtapa[]): Map<string, string> {
  const filhos = new Map<string | null, NoEtapa[]>();
  for (const e of etapas) {
    const l = filhos.get(e.paiId) ?? [];
    l.push(e);
    filhos.set(e.paiId, l);
  }
  const resultado = new Map<string, string>();
  const percorrer = (pai: string | null, prefixo: string) => {
    const l = (filhos.get(pai) ?? []).sort((a, b) => a.ordem - b.ordem);
    l.forEach((e, i) => {
      const n = prefixo ? `${prefixo}.${i + 1}` : String(i + 1);
      resultado.set(e.id, n);
      percorrer(e.id, n);
    });
  };
  percorrer(null, "");
  return resultado;
}
