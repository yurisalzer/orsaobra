/**
 * Erros no navegador. O caso mais comum é uma aba aberta antes de uma
 * atualização do sistema: ela pede arquivos da versão antiga, que não existem
 * mais. Nesse caso basta recarregar a página — feito automaticamente uma vez
 * (marcado na sessão do navegador para não entrar em laço).
 */
const CHAVE = "orsaobra:recarregou-em";

export function ehVersaoAntiga(e: Error): boolean {
  return /ChunkLoadError|Loading (CSS )?chunk|Failed to fetch dynamically imported module|Failed to find Server Action|importing a module script failed/i.test(`${e.name} ${e.message}`);
}

/** Recarrega se o erro for de versão antiga e não houve recarga no último minuto. */
export function tentarRecarregar(e: Error): boolean {
  if (!ehVersaoAntiga(e)) return false;
  try {
    const ultima = Number(sessionStorage.getItem(CHAVE) ?? 0);
    if (Date.now() - ultima < 60_000) return false;
    sessionStorage.setItem(CHAVE, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}
