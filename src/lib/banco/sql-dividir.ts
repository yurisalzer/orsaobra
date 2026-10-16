/**
 * Divide um script SQL em comandos individuais, respeitando comentários,
 * aspas simples/duplas e blocos com cifrão ($$ ... $$, $tag$ ... $tag$).
 * Necessário para aplicar migrações pelo endpoint HTTP do Neon, que aceita
 * um comando por consulta (mas vários comandos numa transação em lote).
 */
export function dividirSql(sql: string): string[] {
  const comandos: string[] = [];
  let atual = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const prox = sql[i + 1];
    if (c === "-" && prox === "-") {
      const fim = sql.indexOf("\n", i);
      i = fim === -1 ? n : fim + 1;
      atual += "\n";
      continue;
    }
    if (c === "/" && prox === "*") {
      const fim = sql.indexOf("*/", i + 2);
      if (fim === -1) throw new Error("Comentário /* sem fechamento");
      i = fim + 2;
      atual += " ";
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === c) {
          if (sql[j + 1] === c) { j += 2; continue; } // aspas escapadas ('')
          break;
        }
        j++;
      }
      if (j >= n) throw new Error(`Texto entre ${c} sem fechamento`);
      atual += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === "$") {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const fim = sql.indexOf(tag, i + tag.length);
        if (fim === -1) throw new Error(`Bloco ${tag} sem fechamento`);
        atual += sql.slice(i, fim + tag.length);
        i = fim + tag.length;
        continue;
      }
    }
    if (c === ";") {
      if (atual.trim()) comandos.push(atual.trim());
      atual = "";
      i++;
      continue;
    }
    atual += c;
    i++;
  }
  if (atual.trim()) comandos.push(atual.trim());
  return comandos;
}
