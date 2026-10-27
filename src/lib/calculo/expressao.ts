/**
 * Avalia a expressão escrita na memória de cálculo do quantitativo.
 *
 * Regras (pensadas para a forma como orçamentistas escrevem):
 *  - Cada linha é calculada e as linhas são SOMADAS (ex.: uma parede por linha).
 *  - O que vem depois de "=" é o resultado escrito pelo orçamentista; é usado
 *    só para conferência (avisamos se diferir do calculado).
 *  - Unidades e comentários são ignorados: "30m", "2 m²", "(comprimento)",
 *    "Parede A:". Parênteses só com texto são comentários.
 *  - Texto entre aspas simples ('...', também ‘...’) é só texto: números e
 *    símbolos (/ + - * = %) dentro delas não entram na conta nem no resultado
 *    escrito. Aspas não fechadas valem até o fim da linha.
 *  - Operadores: + − x X × * / ÷ e parênteses. "2(3+4)" = 2 × (3+4).
 *  - Números no padrão brasileiro: "2,5" = 2.5; "1.234,56" = 1234.56.
 *    Sem vírgula, o ponto é decimal ("2.5" = 2.5).
 * Cálculo com decimais exatos (sem erros de ponto flutuante).
 */
import { D, type Dec, lerNumero } from "./decimal";

export interface ResultadoExpressao {
  valor: Dec;
  /** Expressão normalizada que foi calculada, linha a linha (para exibição) */
  expressoes: string[];
  /** Resultado escrito após "=" (última linha que tiver), se houver */
  escrito: Dec | null;
}

export class ErroExpressao extends Error {}

type Token = { t: "num"; v: Dec } | { t: "op"; v: "+" | "-" | "*" | "/" } | { t: "(" } | { t: ")" };

/** Remove parênteses que contêm apenas texto (comentários), de dentro para fora. */
function removerComentarios(s: string): string {
  let anterior;
  do {
    anterior = s;
    s = s.replace(/\(([^()]*)\)/g, (m, dentro: string) => (/\d/.test(dentro) ? m : " "));
  } while (s !== anterior);
  return s;
}

function tokenizar(linha: string): Token[] {
  const s = removerComentarios(linha);
  const tokens: Token[] = [];
  let i = 0;
  const ultimo = () => tokens[tokens.length - 1];
  const termina = () => ultimo() && (ultimo().t === "num" || ultimo().t === ")");
  while (i < s.length) {
    const c = s[i];
    if (/\d/.test(c)) {
      const m = /^\d[\d.,]*/.exec(s.slice(i))![0].replace(/[.,]+$/, "");
      const v = lerNumero(m);
      if (!v) throw new ErroExpressao(`Número inválido: "${m}"`);
      if (termina()) tokens.push({ t: "op", v: "*" }); // "2 (3+4)" ou ")2"
      tokens.push({ t: "num", v });
      i += m.length;
      continue;
    }
    if (c === "(") { if (termina()) tokens.push({ t: "op", v: "*" }); tokens.push({ t: "(" }); i++; continue; }
    if (c === ")") { tokens.push({ t: ")" }); i++; continue; }
    if (c === "+") { tokens.push({ t: "op", v: "+" }); i++; continue; }
    if (c === "-" || c === "−" || c === "–") { tokens.push({ t: "op", v: "-" }); i++; continue; }
    if (c === "*" || c === "×" || c === "·") { tokens.push({ t: "op", v: "*" }); i++; continue; }
    if (c === "/" || c === "÷") { tokens.push({ t: "op", v: "/" }); i++; continue; }
    if ((c === "x" || c === "X") && termina() && /^\s*([\d(]|$)/.test(s.slice(i + 1))) {
      // "x" é multiplicação entre número/")" e número/"(": "30 x 2", "(5)x(3)"
      tokens.push({ t: "op", v: "*" });
      i++;
      continue;
    }
    if (/[a-zA-Zà-úÀ-Ú]/.test(c)) {
      // palavra/unidade: ignora inclusive dígitos colados ("m2", "m3", "cm2", "A1")
      const m = /^[a-zA-Zà-úÀ-Ú][a-zA-Zà-úÀ-Ú\d²³]*/.exec(s.slice(i))![0];
      i += m.length;
      continue;
    }
    i++; // letras de unidade, espaços, ":", "²" etc. são ignorados
  }
  return tokens;
}

function avaliar(tokens: Token[]): Dec {
  let p = 0;
  const espiar = () => tokens[p];
  const expr = (): Dec => {
    let v = termo();
    for (let t = espiar(); t && t.t === "op" && (t.v === "+" || t.v === "-"); t = espiar()) {
      p++;
      const d = termo();
      v = t.v === "+" ? v.plus(d) : v.minus(d);
    }
    return v;
  };
  const termo = (): Dec => {
    let v = fator();
    for (let t = espiar(); t && t.t === "op" && (t.v === "*" || t.v === "/"); t = espiar()) {
      p++;
      const d = fator();
      if (t.v === "/" && d.isZero()) throw new ErroExpressao("Divisão por zero.");
      v = t.v === "*" ? v.times(d) : v.div(d);
    }
    return v;
  };
  const fator = (): Dec => {
    const t = espiar();
    if (!t) throw new ErroExpressao("Expressão incompleta.");
    if (t.t === "op" && (t.v === "-" || t.v === "+")) { p++; const v = fator(); return t.v === "-" ? v.neg() : v; }
    if (t.t === "num") { p++; return t.v; }
    if (t.t === "(") {
      p++;
      const v = expr();
      if (espiar()?.t !== ")") throw new ErroExpressao("Parêntese não fechado.");
      p++;
      return v;
    }
    throw new ErroExpressao("Operador fora do lugar.");
  };
  const v = expr();
  if (p < tokens.length) throw new ErroExpressao(tokens[p].t === ")" ? "Parêntese fechado sem abertura." : "Expressão com operador ou número sobrando.");
  return v;
}

const texto = (tokens: Token[]) =>
  tokens.map((t) => (t.t === "num" ? t.v.toString().replace(".", ",") : t.t === "op" ? ` ${t.v === "*" ? "×" : t.v === "/" ? "÷" : t.v === "-" ? "−" : "+"} ` : t.t)).join("").replace(/\s+/g, " ").trim();

/** Remove os trechos entre aspas simples ('...' ou ‘...’), que são só texto. */
export function removerTextoEntreAspas(linha: string): string {
  return linha.replace(/['‘’][^'‘’]*(['‘’]|$)/g, " ");
}

/** null = não há conta na memória (só texto). Lança ErroExpressao se a conta estiver malformada. */
export function avaliarMemoria(memoria: string): ResultadoExpressao | null {
  let total = new D(0);
  let temConta = false;
  let escrito: Dec | null = null;
  const expressoes: string[] = [];
  const linhas = memoria.split(/\r?\n/);
  for (const [n, linha] of linhas.entries()) {
    const [antes, ...depois] = removerTextoEntreAspas(linha).split("=");
    const tokens = tokenizar(antes);
    if (depois.length) {
      const t = tokenizar(depois.join("=")).filter((x) => x.t === "num");
      if (t.length) escrito = (t[0] as { v: Dec }).v;
    }
    if (!tokens.some((t) => t.t === "num")) continue;
    try {
      total = total.plus(avaliar(tokens));
    } catch (e) {
      throw new ErroExpressao(`${linhas.length > 1 ? `Linha ${n + 1}: ` : ""}${(e as Error).message}`);
    }
    temConta = true;
    expressoes.push(texto(tokens));
  }
  return temConta ? { valor: total, expressoes, escrito } : null;
}
