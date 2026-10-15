import bcrypt from "bcryptjs";

const CUSTO = 12;
// Hash usado quando o e-mail não existe, para o tempo de resposta não revelar
// quais e-mails estão cadastrados. Gerado uma vez, sob demanda.
let hashFicticio: Promise<string> | null = null;
const obterHashFicticio = () => (hashFicticio ??= bcrypt.hash("senha-ficticia-0", CUSTO));

export function validarForcaSenha(senha: string): string | null {
  if (senha.length < 10) return "A senha deve ter pelo menos 10 caracteres.";
  if (!/[A-Za-z]/.test(senha) || !/\d/.test(senha)) return "A senha deve conter letras e números.";
  return null;
}

export function gerarHashSenha(senha: string): Promise<string> {
  return bcrypt.hash(senha, CUSTO);
}

export async function conferirSenha(senha: string, hash: string | null): Promise<boolean> {
  const ok = await bcrypt.compare(senha, hash ?? (await obterHashFicticio()));
  return hash !== null && ok;
}
