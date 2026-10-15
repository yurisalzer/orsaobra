import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./db";

type Cliente = PrismaClient | Prisma.TransactionClient;

export interface RegistroAuditoria {
  usuarioId?: string | null;
  acao: string;
  entidade: string;
  entidadeId?: string | null;
  antes?: Prisma.InputJsonValue;
  depois?: Prisma.InputJsonValue;
  ip?: string | null;
}

/** Grava auditoria; passe `tx` para gravar na mesma transação da alteração. */
export async function auditar(r: RegistroAuditoria, tx: Cliente = prisma) {
  await tx.auditoria.create({
    data: {
      usuarioId: r.usuarioId ?? null,
      acao: r.acao,
      entidade: r.entidade,
      entidadeId: r.entidadeId ?? null,
      antes: r.antes,
      depois: r.depois,
      ip: r.ip ?? null,
    },
  });
}
