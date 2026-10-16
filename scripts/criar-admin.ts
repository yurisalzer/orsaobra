/**
 * Cria (ou redefine a senha de) um administrador.
 * Uso: ADMIN_SENHA='...' npm run criar-admin -- email@exemplo.com "Nome Completo"
 * Funciona com PostgreSQL local (TCP) e com o Neon (HTTPS).
 */
import { ProxyAgent, setGlobalDispatcher } from "undici";
import { criarExecutor } from "../src/lib/banco/executor";
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
    `INSERT INTO usuario (email, nome, senha_hash, papel, atualizado_em) VALUES (lower($1), $2, $3, 'ADMIN', now())
     ON CONFLICT (email) DO UPDATE SET senha_hash = EXCLUDED.senha_hash, papel = 'ADMIN', ativo = true, tentativas = 0, bloqueado_ate = NULL, atualizado_em = now()
     RETURNING id, email`,
    [email, nome, senhaHash],
  );
  await ex.consulta(`INSERT INTO auditoria (acao, entidade, entidade_id) VALUES ('ADMIN_DEFINIDO_VIA_SCRIPT', 'usuario', $1)`, [u.id]);
  console.log(`Administrador pronto: ${u.email}`);
  await ex.encerrar?.();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
