/** Assinaturas dos documentos de medição (tipos e limites usados no servidor e na tela). */
export const MIN_FISCAIS = 2;
export const MAX_FISCAIS = 3;

export interface AssinaturasMedicao {
  fiscais: { nome: string; cargo: string }[];
  /** bloco da contratada: assinatura do responsável técnico */
  empresa: { nome: string; cnpj: string; responsavel: string; registro: string };
  /** false enquanto ninguém salvou (valores sugeridos a partir do contrato) */
  salvas: boolean;
}
