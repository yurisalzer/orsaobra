/**
 * Cria (ou redefine a senha de) um administrador.
 * Uso: ADMIN_SENHA='...' npm run criar-admin -- email@exemplo.com "Nome Completo"
 * Funciona com PostgreSQL local (TCP) e com o Neon (HTTPS).
 */
import { ProxyAgent, setGlobalDispatcher } from "undici";
import { criarExecutor } from "../src/lib/banco/executor";
import { CODIGOS_PERMISSAO } from "../src/lib/auth/permissoes";
import { gerarHashSenha, validarForcaSenha } from "../src/lib/auth/senha";

const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
if (proxy) setGlobalDispatcher(new ProxyAgent(proxy));

async function main() {
  const [email, nome] = process.argv.slice(2);
  const senha = process.env.ADMIN_SENHA ?? "";
  if (!email || !nome) throw new Error('Uso: npm run criar-admin -- email "Nome"');
  const problema = validarForcaSenha(senha);
  if (problema) throw new Error(`ADMIN_SENHA inválida: ${problema}`);
  const ex = await criarExecutor();
  const senhaHash = await gerarHashSenha(senha);
  const [u] = await ex.consulta<{ id: string; email: string }>(
    `INSERT INTO usuario (email, nome, senha_hash, papel, email_confirmado_em, aprovado_em, atualizado_em) VALUES (lower($1), $2, $3, 'ADMIN', now(), now(), now())
     ON CONFLICT (email) DO UPDATE SET senha_hash = EXCLUDED.senha_hash, papel = 'ADMIN', ativo = true,
       email_confirmado_em = coalesce(usuario.email_confirmado_em, now()), aprovado_em = coalesce(usuario.aprovado_em, now()), tentativas = 0, bloqueado_ate = NULL, atualizado_em = now()
     RETURNING id, email`,
    [email, nome, senhaHash],
  );
  // administrador = todas as permissões
  await ex.consulta(`INSERT INTO usuario_permissao (usuario_id, permissao) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING`, [u.id, CODIGOS_PERMISSAO]);
  await ex.consulta(`INSERT INTO auditoria (acao, entidade, entidade_id) VALUES ('ADMIN_DEFINIDO_VIA_SCRIPT', 'usuario', $1)`, [u.id]);
  console.log(`Administrador pronto: ${u.email}`);
  await ex.encerrar?.();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
