import { exigirUsuario, temPermissao, type Permissao } from "@/lib/auth/sessao";
import { rotuloPerfil } from "@/lib/auth/permissoes";
import { MenuPrincipal, type GrupoMenu, type ItemMenu } from "./MenuPrincipal";

type Item = ItemMenu & { permissao?: Permissao };

/** Estrutura do menu; cada item aparece só para quem tem a permissão, e o grupo some se ficar vazio. */
function montarMenu(u: { nome: string; permissoes: readonly Permissao[] }): GrupoMenu[] {
  const pode = (i: Item) => !i.permissao || temPermissao(u, i.permissao);
  const grupo = (rotulo: string, itens: Item[], extra: Partial<GrupoMenu> = {}): GrupoMenu[] => {
    const visiveis: ItemMenu[] = itens.filter(pode).map((i) => ({ href: i.href, rotulo: i.rotulo, emBreve: i.emBreve }));
    return visiveis.length || extra.sair ? [{ rotulo, itens: visiveis, ...extra }] : [];
  };
  const direto = (rotulo: string, href: string, permissao?: Permissao): GrupoMenu[] => (pode({ href, rotulo, permissao }) ? [{ rotulo, href }] : []);
  return [
    { rotulo: "Início", href: "/" },
    ...grupo("Orçamentos", [
      { href: "/orcamentos", rotulo: "Orçamentos", permissao: "ORCAMENTOS_VER" },
      { href: "/composicoes", rotulo: "Composições", permissao: "CONSULTA" },
      { href: "/bdi", rotulo: "BDIs", permissao: "BDI" },
    ]),
    ...direto("Consulta de preços", "/consulta", "CONSULTA"),
    ...direto("Contratos", "/contratos", "MEDICOES_VER"),
    ...grupo("Cadastros", [
      { href: "/usuarios", rotulo: "Usuários e Permissões", permissao: "USUARIOS" },
      { href: "/empresas", rotulo: "Empresas", permissao: "USUARIOS", emBreve: true },
      { href: "/setores", rotulo: "Setores", permissao: "USUARIOS", emBreve: true },
      { href: "/cabecalhos", rotulo: "Cabeçalhos", permissao: "CABECALHOS" },
    ]),
    ...grupo("Administrador", [
      { href: "/importacao", rotulo: "Importações", permissao: "IMPORTACAO" },
      { href: "/conta", rotulo: "Minha conta" },
      { href: "/contato", rotulo: "Contato" },
    ], { sair: true, cabecalho: `${u.nome} · ${rotuloPerfil(u.permissoes)}` }),
  ];
}

export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  const u = await exigirUsuario();
  return (
    <div className="flex-1">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5">
          <MenuPrincipal grupos={montarMenu(u)} />
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
