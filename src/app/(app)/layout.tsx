import Link from "next/link";
import { exigirUsuario } from "@/lib/auth/sessao";
import { acaoSair } from "./acoes";

const MENU = [
  { href: "/", rotulo: "Início" },
  { href: "/orcamentos", rotulo: "Orçamentos" },
  { href: "/consulta", rotulo: "Consulta de preços" },
  { href: "/composicoes", rotulo: "Composições" },
  { href: "/importacao", rotulo: "Importação", admin: true },
];

const NOME_PAPEL = { ADMIN: "Administrador", ORCAMENTISTA: "Orçamentista", LEITOR: "Leitor" } as const;

export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  const u = await exigirUsuario();
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="font-semibold text-marca-900">Orçamento de Obras</Link>
          <nav className="flex flex-wrap gap-4 text-sm">
            {MENU.filter((m) => !m.admin || u.papel === "ADMIN").map((m) => (
              <Link key={m.href} href={m.href} className="text-slate-600 hover:text-marca-700">{m.rotulo}</Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-slate-600">{u.nome} · {NOME_PAPEL[u.papel]}</span>
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
