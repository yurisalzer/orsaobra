// Zera o banco de TESTE e cadastra as fontes (usado pelos testes de navegador).
import { limparBanco, prisma } from "../db/ajuda";

async function main() {
  await limparBanco();
  for (const f of [{ codigo: "SINAPI", nome: "SINAPI" }, { codigo: "EMOP", nome: "EMOP-RJ" }, { codigo: "SICRO", nome: "SICRO" }, { codigo: "SCO", nome: "SCO-Rio" }, { codigo: "PROPRIA", nome: "Próprias", oficial: false }]) {
    await prisma.fonte.create({ data: f });
  }
  await prisma.$disconnect();
}
main();
