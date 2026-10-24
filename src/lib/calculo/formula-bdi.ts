/**
 * Fórmula de BDI escrita pelo usuário (alternativa à do Acórdão TCU 2.622/2013).
 *
 * Variáveis: AC, S, R, G, DF, L, I — a soma das parcelas de cada grupo, em
 * fração (5% = 0,05), como na fórmula do TCU. O resultado também é fração:
 * "(1+AC+S+R+G)*(1+DF)*(1+L)/(1-I) - 1" = 0,2223 → BDI de 22,23%.
 *
 * Operadores: + − * × / ÷ ^ (potência inteira) e parênteses. Números no
 * padrão brasileiro ("0,0065") ou com ponto. Cálculo com decimais exatos.
 */
import { D, type Dec, dec, lerNumero } from "./decimal";
import type { TipoParcelaBdi } from "./bdi";

export class ErroFormulaBdi extends Error {}

export const VARIAVEIS_BDI: TipoParcelaBdi[] = ["AC", "S", "R", "G", "DF", "L", "I"];

type Token = { t: "num"; v: Dec } | { t: "var"; v: TipoParcelaBdi } | { t: "op"; v: "+" | "-" | "*" | "/" | "^" } | { t: "(" } | { t: ")" };

function tokenizar(s: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/\d/.test(c)) {
      const m = /^\d[\d.,]*/.exec(s.slice(i))![0].replace(/[.,]+$/, "");
      const v = lerNumero(m);
      if (!v) throw new ErroFormulaBdi(`Número inválido: "${m}".`);
      tokens.push({ t: "num", v });
      i += m.length;
      continue;
    }
    if (/[a-zA-Z]/.test(c)) {
      const m = /^[a-zA-Z]+/.exec(s.slice(i))![0];
      const v = m.toUpperCase() as TipoParcelaBdi;
      if (!VARIAVEIS_BDI.includes(v)) throw new ErroFormulaBdi(`"${m}" não é uma variável da fórmula. Use AC, S, R, G, DF, L ou I.`);
      tokens.push({ t: "var", v });
      i += m.length;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") { tokens.push({ t: "(" }); i++; continue; }
    if (c === ")" || c === "]" || c === "}") { tokens.push({ t: ")" }); i++; continue; }
    if (c === "+") { tokens.push({ t: "op", v: "+" }); i++; continue; }
    if (c === "-" || c === "−" || c === "–") { tokens.push({ t: "op", v: "-" }); i++; continue; }
    if (c === "*" || c === "×" || c === "·") { tokens.push({ t: "op", v: "*" }); i++; continue; }
    if (c === "/" || c === "÷") { tokens.push({ t: "op", v: "/" }); i++; continue; }
    if (c === "^") { tokens.push({ t: "op", v: "^" }); i++; continue; }
    throw new ErroFormulaBdi(`Caractere não permitido na fórmula: "${c}".`);
  }
  if (!tokens.length) throw new ErroFormulaBdi("Escreva a fórmula do BDI.");
  return tokens;
}

function avaliar(tokens: Token[], valores: Record<TipoParcelaBdi, Dec>): Dec {
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
    let v = potencia();
    for (let t = espiar(); t && t.t === "op" && (t.v === "*" || t.v === "/"); t = espiar()) {
      p++;
      const d = potencia();
      if (t.v === "/" && d.isZero()) throw new ErroFormulaBdi("Divisão por zero na fórmula.");
      v = t.v === "*" ? v.times(d) : v.div(d);
    }
    return v;
  };
  const potencia = (): Dec => {
    const b = fator();
    const t = espiar();
    if (t && t.t === "op" && t.v === "^") {
      p++;
      const e = potencia();
      if (!e.isInteger() || e.abs().gt(100)) throw new ErroFormulaBdi("O expoente deve ser um número inteiro (até 100).");
      return b.pow(e);
    }
    return b;
  };
  const fator = (): Dec => {
    const t = espiar();
    if (!t) throw new ErroFormulaBdi("Fórmula incompleta.");
    if (t.t === "op" && (t.v === "-" || t.v === "+")) { p++; const v = fator(); return t.v === "-" ? v.neg() : v; }
    if (t.t === "num") { p++; return t.v; }
    if (t.t === "var") { p++; return valores[t.v]; }
    if (t.t === "(") {
      p++;
      const v = expr();
      if (espiar()?.t !== ")") throw new ErroFormulaBdi("Parêntese não fechado.");
      p++;
      return v;
    }
    throw new ErroFormulaBdi("Operador fora do lugar na fórmula.");
  };
  const v = expr();
  if (p < tokens.length) throw new ErroFormulaBdi(tokens[p].t === ")" ? "Parêntese fechado sem abertura." : "Fórmula com operador, variável ou número sobrando.");
  return v;
}

/** Variáveis usadas na fórmula (para conferir se há parcelas de cada grupo). */
export function variaveisDaFormula(formula: string): TipoParcelaBdi[] {
  return [...new Set(tokenizar(formula).flatMap((t) => (t.t === "var" ? [t.v] : [])))];
}

/**
 * Calcula o BDI (em pontos percentuais, sem arredondar) pela fórmula do
 * usuário, com as somas das parcelas por grupo (em pontos percentuais).
 */
export function calcularBdiPorFormula(formula: string, somas: Record<TipoParcelaBdi, Dec>): Dec {
  const fracoes = Object.fromEntries(VARIAVEIS_BDI.map((k) => [k, dec(somas[k] ?? 0).div(100)])) as Record<TipoParcelaBdi, Dec>;
  const bdi = avaliar(tokenizar(formula), fracoes).times(100);
  if (!bdi.isFinite()) throw new ErroFormulaBdi("A fórmula não produz um número.");
  if (bdi.isNegative()) throw new ErroFormulaBdi("A fórmula resultou em BDI negativo.");
  if (bdi.gte(1000)) throw new ErroFormulaBdi("A fórmula resultou em BDI de 1.000% ou mais — confira se as variáveis estão em fração (ex.: 1 + L).");
  return new D(bdi);
}
