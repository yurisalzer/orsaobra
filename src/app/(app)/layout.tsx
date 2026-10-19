import Link from "next/link";
import { exigirUsuario, type Permissao } from "@/lib/auth/sessao";
import { rotuloPerfil } from "@/lib/auth/permissoes";
import { acaoSair } from "./acoes";

// cada item aparece só para quem tem a permissão
const MENU: { href: string; rotulo: string; permissao?: Permissao }[] = [
  { href: "/", rotulo: "Início" },
  { href: "/orcamentos", rotulo: "Orçamentos", permissao: "ORCAMENTOS_VER" },
  { href: "/consulta", rotulo: "Consulta de preços", permissao: "CONSULTA" },
  { href: "/composicoes", rotulo: "Composições", permissao: "CONSULTA" },
  { href: "/bdi", rotulo: "BDI", permissao: "BDI" },
  { href: "/cabecalhos", rotulo: "Cabeçalhos", permissao: "CABECALHOS" },
  { href: "/importacao", rotulo: "Importação", permissao: "IMPORTACAO" },
  { href: "/usuarios", rotulo: "Usuários", permissao: "USUARIOS" },
  { href: "/contato", rotulo: "Contato" },
];

export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  const u = await exigirUsuario();
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="font-semibold text-marca-900">Orçamento de Obras</Link>
          <nav className="flex flex-wrap gap-4 text-sm">
            {MENU.filter((m) => !m.permissao || u.permissoes.includes(m.permissao)).map((m) => (
              <Link key={m.href} href={m.href} className="text-slate-600 hover:text-marca-700">{m.rotulo}</Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <Link href="/conta" className="text-slate-600 hover:text-marca-700">{u.nome} · {rotuloPerfil(u.permissoes)}</Link>
            <form action={acaoSair}>
              <button className="rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-100">Sair</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
