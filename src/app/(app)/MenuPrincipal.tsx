"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { TemaSeletor } from "../TemaSeletor";
import { acaoSair } from "./acoes";

export interface ItemMenu { href: string; rotulo: string; emBreve?: boolean }
export interface GrupoMenu { rotulo: string; href?: string; itens?: ItemMenu[]; sair?: boolean; cabecalho?: string }

const ativo = (caminho: string, href: string) => (href === "/" ? caminho === "/" : caminho === href || caminho.startsWith(`${href}/`));
/** itens por coluna no painel (como no menu de referência, as colunas crescem para o lado) */
const POR_COLUNA = 6;

/**
 * Menu principal: links diretos e grupos que abrem um painel escuro abaixo do
 * item (ao passar o mouse, ao clicar ou pelo teclado), com os itens em colunas.
 */
export function MenuPrincipal({ grupos }: { grupos: GrupoMenu[] }) {
  const caminho = usePathname();
  const [aberto, setAberto] = useState<string | null>(null);
  const nav = useRef<HTMLElement>(null);
  const fechar = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setAberto(null); }, [caminho]);
  useEffect(() => {
    const fora = (e: MouseEvent) => { if (!nav.current?.contains(e.target as Node)) setAberto(null); };
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") setAberto(null); };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", tecla);
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", tecla); };
  }, []);

  const entrar = (r: string) => { if (fechar.current) clearTimeout(fechar.current); setAberto(r); };
  const sair = () => { fechar.current = setTimeout(() => setAberto(null), 180); };
  const base = "inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 font-medium transition-colors";

  return (
    <nav ref={nav} aria-label="Menu principal" className="flex flex-wrap items-center gap-1 text-sm">
      {grupos.map((g) => {
        if (g.href) {
          const a = ativo(caminho, g.href);
          return (
            <Link key={g.rotulo} href={g.href} aria-current={a ? "page" : undefined}
              className={`${base} ${a ? "text-marca-700" : "text-slate-700 hover:text-marca-700"}`}>{g.rotulo}</Link>
          );
        }
        const itens = g.itens ?? [];
        const a = itens.some((i) => ativo(caminho, i.href));
        const colunas = Math.max(1, Math.ceil((itens.length + (g.sair ? 1 : 0)) / POR_COLUNA));
        const id = `menu-${g.rotulo.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\W+/g, "-")}`;
        return (
          <div key={g.rotulo} className="relative" onMouseEnter={() => entrar(g.rotulo)} onMouseLeave={sair}>
            <button type="button" aria-expanded={aberto === g.rotulo} aria-controls={id} onClick={() => setAberto(aberto === g.rotulo ? null : g.rotulo)}
              className={`${base} ${a || aberto === g.rotulo ? "text-marca-700" : "text-slate-700 hover:text-marca-700"}`}>
              {g.rotulo}
              <svg aria-hidden="true" viewBox="0 0 20 20" className={`h-3.5 w-3.5 transition-transform ${aberto === g.rotulo ? "rotate-180" : ""}`}><path fill="currentColor" d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4z" /></svg>
            </button>
            {aberto === g.rotulo && (
              <div id={id} role="menu" aria-label={g.rotulo}
                className="menu-painel absolute left-0 top-full z-50 mt-2 rounded-lg p-5 shadow-2xl"
                style={{ minWidth: `${Math.min(colunas, 3) * 11}rem` }}>
                {g.cabecalho && <p className="mb-3 border-b border-white/10 pb-2 text-xs text-white/60">{g.cabecalho}</p>}
                <ul className="grid grid-flow-col gap-x-8 gap-y-2.5" style={{ gridTemplateRows: `repeat(${Math.min(POR_COLUNA, itens.length + (g.sair ? 1 : 0))}, auto)` }}>
                  {itens.map((i) => (
                    <li key={i.href} role="none">
                      <Link role="menuitem" href={i.href} aria-current={ativo(caminho, i.href) ? "page" : undefined}
                        className={`menu-item block whitespace-nowrap ${ativo(caminho, i.href) ? "menu-item-ativo" : ""}`}>
                        {i.rotulo}{i.emBreve && <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-white/70">em breve</span>}
                      </Link>
                    </li>
                  ))}
                  {g.sair && (
                    <li role="none">
                      <form action={acaoSair}>
                        <button role="menuitem" type="submit" className="menu-item block whitespace-nowrap text-left">Sair</button>
                      </form>
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>
        );
      })}
      <span className="ml-1"><TemaSeletor /></span>
    </nav>
  );
}
