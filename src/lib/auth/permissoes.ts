/**
 * Permissões por recurso (marcadas individualmente para cada usuário na
 * área "Usuários"). Usável no servidor e no navegador.
 */
export const PERMISSOES = [
  { codigo: "CONSULTA", nome: "Consulta de preços", descricao: "Consultar insumos, composições, preços e histórico." },
  { codigo: "ORCAMENTOS_VER", nome: "Ver orçamentos", descricao: "Abrir obras, orçamentos, revisões, cronograma e comparações." },
  { codigo: "ORCAMENTOS_EDITAR", nome: "Editar orçamentos", descricao: "Criar e editar obras, orçamentos, itens e cronograma; fechar e duplicar revisões." },
  { codigo: "RELATORIOS", nome: "Relatórios", descricao: "Visualizar e baixar os relatórios em PDF e Excel." },
  { codigo: "COMPOSICOES", nome: "Composições próprias", descricao: "Criar e editar insumos e composições próprias e registrar cotações." },
  { codigo: "BDI", nome: "Perfis de BDI", descricao: "Criar, editar e arquivar perfis de BDI." },
  { codigo: "CABECALHOS", nome: "Cabeçalhos", descricao: "Cadastrar logos e textos dos cabeçalhos dos relatórios." },
  { codigo: "IMPORTACAO", nome: "Importação de bases", descricao: "Importar, validar e publicar bases (SINAPI, EMOP, SICRO, SCO) e conferir bases não publicadas." },
  { codigo: "USUARIOS", nome: "Usuários e permissões", descricao: "Cadastrar usuários, ativar/desativar e alterar permissões (administrador)." },
] as const;

export type Permissao = (typeof PERMISSOES)[number]["codigo"];
export const CODIGOS_PERMISSAO = PERMISSOES.map((p) => p.codigo) as Permissao[];

/** Permissões que exigem outra (marcar a primeira marca a segunda; desmarcar a segunda desmarca a primeira). */
export const DEPENDE_DE: Partial<Record<Permissao, Permissao>> = {
  ORCAMENTOS_EDITAR: "ORCAMENTOS_VER",
  RELATORIOS: "ORCAMENTOS_VER",
  COMPOSICOES: "CONSULTA",
};

/** Ajusta um conjunto de permissões às dependências (sem nada inventado: só acrescenta as exigidas). */
export function completarPermissoes(lista: Iterable<string>): Permissao[] {
  const s = new Set([...lista].filter((p): p is Permissao => (CODIGOS_PERMISSAO as string[]).includes(p)));
  for (const p of [...s]) { const d = DEPENDE_DE[p]; if (d) s.add(d); }
  return CODIGOS_PERMISSAO.filter((p) => s.has(p));
}

/** Modelos para aplicar com um clique. */
export const MODELOS: { nome: string; permissoes: Permissao[] }[] = [
  { nome: "Leitor", permissoes: ["CONSULTA", "ORCAMENTOS_VER", "RELATORIOS"] },
  { nome: "Orçamentista", permissoes: ["CONSULTA", "ORCAMENTOS_VER", "ORCAMENTOS_EDITAR", "RELATORIOS", "COMPOSICOES", "BDI", "CABECALHOS"] },
  { nome: "Administrador", permissoes: [...CODIGOS_PERMISSAO] },
];

export const rotuloPerfil = (p: readonly string[]) =>
  p.includes("USUARIOS") ? "Administrador" : p.includes("ORCAMENTOS_EDITAR") ? "Orçamentista" : p.length ? "Leitor" : "Sem acesso";
