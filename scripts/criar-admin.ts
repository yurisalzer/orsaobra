/**
 * Cria (ou redefine a senha de) um administrador.
 * Uso: npm run criar-admin -- email@exemplo.com "Nome Completo"
 * A senha é pedida pela variável ADMIN_SENHA (não fica no histórico de comandos
 * se definida no painel da hospedagem ou digitada com `read -s`).
 */
import { PrismaClient } from "@prisma/client";
import { gerarHashSenha, validarForcaSenha } from "../src/lib/auth/senha";

async function main() {
  const [email, nome] = process.argv.slice(2);
  const senha = process.env.ADMIN_SENHA ?? "";
  if (!email || !nome) throw new Error('Uso: npm run criar-admin -- email "Nome"');
  const problema = validarForcaSenha(senha);
  if (problema) throw new Error(`ADMIN_SENHA inválida: ${problema}`);
  const prisma = new PrismaClient();
  const senhaHash = await gerarHashSenha(senha);
  const u = await prisma.usuario.upsert({
    where: { email: email.toLowerCase() },
    create: { email: email.toLowerCase(), nome, senhaHash, papel: "ADMIN" },
    update: { senhaHash, papel: "ADMIN", ativo: true, tentativas: 0, bloqueadoAte: null },
  });
  await prisma.auditoria.create({ data: { acao: "ADMIN_DEFINIDO_VIA_SCRIPT", entidade: "usuario", entidadeId: u.id } });
  console.log(`Administrador pronto: ${u.email}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
