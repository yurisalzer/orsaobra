import type { Executor } from "@/lib/banco/executor";
import { identificar, lerEmLotes } from "@/lib/importacao/processar";
import { confirmarImportacao, gravarLote, iniciarImportacao, publicarBase, validarBase, validarImportacao } from "@/lib/importacao/servico";
import { arquivo, EMOP_DBFS, SINAPI_ZIP } from "../importacao/ajuda";
import { limparBanco, prisma } from "./ajuda";

/** Banco limpo com as amostras reais (EMOP e SINAPI 09/2026) importadas e publicadas. */
export async function carregarAmostras(ex: Executor) {
  await limparBanco();
  for (const f of [{ codigo: "SINAPI", nome: "SINAPI" }, { codigo: "EMOP", nome: "EMOP-RJ" }, { codigo: "SICRO", nome: "SICRO" }, { codigo: "PROPRIA", nome: "Próprias", oficial: false }]) {
    await prisma.fonte.create({ data: f });
  }
  const usuarioId = (await prisma.usuario.create({ data: { email: "carga@t.com", nome: "Carga", senhaHash: "x", papel: "ADMIN" } })).id;
  const revisoes: Record<string, string> = {};
  for (const arqs of [EMOP_DBFS.map((p) => arquivo(p)), [arquivo(SINAPI_ZIP)]]) {
    const id = await importarPublicar(ex, arqs, usuarioId);
    revisoes[id.fonte] = id.baseRevisaoId;
  }
  return { usuarioId, revisoes };
}

/** Importa e publica; `ajustar` permite alterar o staging antes da validação (simular retificações). */
export async function importarPublicar(
  ex: Executor, arqs: ReturnType<typeof arquivo>[], usuarioId: string,
  opc: { retificacao?: string; ajustar?: (importacaoId: string) => Promise<void> } = {},
) {
  const id = await identificar(arqs, { uf: "RJ" });
  const ini = await iniciarImportacao(ex, {
    ident: id.identificacao, usuarioId, arquivos: id.originais,
    autorizarDuplicidade: !!opc.retificacao, retificacao: opc.retificacao ? { motivo: opc.retificacao } : null,
  });
  await lerEmLotes(id, (l) => gravarLote(ex, ini.importacaoId, l));
  await opc.ajustar?.(ini.importacaoId);
  await validarImportacao(ex, ini.importacaoId);
  await confirmarImportacao(ex, ini.importacaoId, { usuarioId, cienteAvisos: true });
  await validarBase(ex, ini.baseRevisaoId, usuarioId);
  await publicarBase(ex, ini.baseRevisaoId, usuarioId);
  return { fonte: id.identificacao.fonte, baseRevisaoId: ini.baseRevisaoId };
}
