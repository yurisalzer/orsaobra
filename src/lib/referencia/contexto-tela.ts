import "server-only";
import type { UsuarioSessao } from "../auth/sessao";
import type { Executor } from "../banco/executor";
import { basePadraoPorFonte, basesDisponiveis, type BaseDisponivel } from "./bases";

/** Lê das URLs a base/regime escolhidos por fonte (parâmetros b_<FONTE> e r_<FONTE>). */
export async function selecaoDeBases(ex: Executor, u: UsuarioSessao, sp: Record<string, string | string[] | undefined>) {
  const todas = await basesDisponiveis(ex, { incluirNaoPublicadas: u.papel === "ADMIN" });
  const padrao = basePadraoPorFonte(todas);
  const fontes = [...new Set(todas.map((b) => b.fonte))];
  const selecao: { fonte: string; base: BaseDisponivel; regime: string | null; opcoes: BaseDisponivel[] }[] = [];
  for (const fonte of fontes) {
    const opcoes = todas.filter((b) => b.fonte === fonte);
    const pedido = typeof sp[`b_${fonte}`] === "string" ? (sp[`b_${fonte}`] as string) : null;
    const base = opcoes.find((b) => b.revisaoId === pedido) ?? padrao[fonte];
    const regimePedido = typeof sp[`r_${fonte}`] === "string" ? (sp[`r_${fonte}`] as string) : null;
    // padrão: "sem desoneração" (quando publicado); senão o primeiro regime da base
    const padraoRegime = base.regimes.find((r) => r.codigo === "SEM_DESONERACAO") ?? base.regimes[0];
    const regime = base.regimes.find((r) => r.codigo === regimePedido)?.codigo ?? padraoRegime?.codigo ?? null;
    selecao.push({ fonte, base, regime, opcoes });
  }
  return selecao;
}

export function parametrosSelecao(sel: Awaited<ReturnType<typeof selecaoDeBases>>) {
  const p = new URLSearchParams();
  for (const s of sel) {
    p.set(`b_${s.fonte}`, s.base.revisaoId);
    if (s.regime) p.set(`r_${s.fonte}`, s.regime);
  }
  return p;
}
