/**
 * Formulário de contato: a mensagem vai por e-mail para o responsável pelo
 * sistema (CONTATO_EMAIL, padrão yurisalzer@gmail.com), com "responder para"
 * o e-mail de quem escreveu. Fica registrada na caixa de saída e na auditoria.
 */
import type { Executor } from "../banco/executor";
import { comandoAuditoria } from "../auditoria";
import { enviarEmail, type StatusEnvio } from "../email/enviar";
import { normalizarTelefone } from "../auth/cadastro";

export class ErroContato extends Error {}

export const DESTINO_CONTATO_PADRAO = "yurisalzer@gmail.com";
export const destinoContato = () => process.env.CONTATO_EMAIL?.trim() || DESTINO_CONTATO_PADRAO;

export const MODULOS_CONTATO = [
  "Orçamentos", "Importar orçamento", "Consulta de preços", "Composições próprias", "BDI", "Relatórios", "Cronograma",
  "Cabeçalhos dos relatórios", "Importação de bases (EMOP, SINAPI, SICRO, SCO)", "Usuários e permissões", "Cadastro e acesso", "Outro",
] as const;

const LIMITE_POR_HORA = 10;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface DadosContato { nome: string; contato: string; email: string; modulo: string; mensagem: string }

export async function enviarContato(ex: Executor, d: DadosContato, usuario: { id: string; email: string }): Promise<StatusEnvio> {
  const nome = d.nome.trim().replace(/\s+/g, " ");
  const email = d.email.trim().toLowerCase();
  const mensagem = d.mensagem.trim();
  if (nome.length < 2) throw new ErroContato("Informe o seu nome.");
  if (!RE_EMAIL.test(email)) throw new ErroContato("Informe um e-mail válido.");
  const telefone = normalizarTelefone(d.contato);
  if (telefone === null) throw new ErroContato("Telefone inválido. Informe o DDD e o número.");
  if (!(MODULOS_CONTATO as readonly string[]).includes(d.modulo)) throw new ErroContato("Selecione um módulo.");
  if (mensagem.length < 5) throw new ErroContato("Escreva a mensagem.");
  if (mensagem.length > 5000) throw new ErroContato("Mensagem muito longa (máximo de 5.000 caracteres).");
  const [r] = await ex.consulta<{ n: string }>(
    `SELECT count(*) AS n FROM auditoria WHERE acao = 'CONTATO_ENVIADO' AND usuario_id = $1 AND criado_em > now() - interval '1 hour'`, [usuario.id],
  );
  if (Number(r.n) >= LIMITE_POR_HORA) throw new ErroContato("Muitas mensagens em pouco tempo. Tente novamente em uma hora.");
  const status = await enviarEmail(ex, {
    para: destinoContato(), motivo: "CONTATO", usuarioId: usuario.id, responderPara: email,
    assunto: `[Contato — ${d.modulo}] ${nome}`,
    texto: `Nova solicitação pelo formulário de contato do sistema Orçamento de Obras.\n\nNome: ${nome}\nTelefone: ${telefone || "—"}\nE-mail: ${email}\nMódulo: ${d.modulo}\n` +
      `Usuário do sistema: ${usuario.email}\n\nMensagem:\n${mensagem}`,
  });
  await ex.transacao([comandoAuditoria({ usuarioId: usuario.id, acao: "CONTATO_ENVIADO", entidade: "contato", depois: { modulo: d.modulo, status } })]);
  return status;
}
