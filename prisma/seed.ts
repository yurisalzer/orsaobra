/**
 * Dados iniciais mínimos e factuais: apenas o cadastro das fontes.
 * Regimes, preços e composições vêm exclusivamente da importação dos
 * arquivos oficiais — nada é presumido aqui.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const fontes = [
    { codigo: "SINAPI", nome: "SINAPI — Sistema Nacional de Pesquisa de Custos e Índices da Construção Civil", oficial: true },
    { codigo: "EMOP", nome: "EMOP-RJ — Empresa de Obras Públicas do Estado do Rio de Janeiro", oficial: true },
    { codigo: "PROPRIA", nome: "Composições e insumos próprios", oficial: false },
  ];
  for (const f of fontes) {
    await prisma.fonte.upsert({ where: { codigo: f.codigo }, create: f, update: { nome: f.nome, oficial: f.oficial } });
  }
  console.log("Fontes cadastradas:", fontes.map((f) => f.codigo).join(", "));
}

main().finally(() => prisma.$disconnect());
