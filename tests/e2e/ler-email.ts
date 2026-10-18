// Imprime o texto do último e-mail registrado na caixa de saída para um destinatário/motivo.
import { prisma } from "../db/ajuda";

async function main() {
  const [para, motivo] = process.argv.slice(2);
  const e = await prisma.emailSaida.findFirst({ where: { para, motivo }, orderBy: { criadoEm: "desc" } });
  process.stdout.write(e?.texto ?? "");
  await prisma.$disconnect();
}
main();
