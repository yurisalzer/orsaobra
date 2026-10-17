// Banco de TESTE com as amostras reais (EMOP e SINAPI 09/2026) importadas e publicadas.
import { executorPg } from "../../src/lib/banco/executor";
import { identificar, lerEmLotes } from "../../src/lib/importacao/processar";
import { confirmarImportacao, gravarLote, iniciarImportacao, publicarBase, validarBase, validarImportacao } from "../../src/lib/importacao/servico";
import { arquivo, EMOP_DBFS, SINAPI_ZIP } from "../importacao/ajuda";
import { limparBanco, prisma } from "../db/ajuda";

async function main() {
  await limparBanco();
  for (const f of [{ codigo: "SINAPI", nome: "SINAPI" }, { codigo: "EMOP", nome: "EMOP-RJ" }, { codigo: "SICRO", nome: "SICRO" }, { codigo: "PROPRIA", nome: "Próprias", oficial: false }]) await prisma.fonte.create({ data: f });
  const u = await prisma.usuario.create({ data: { email: "carga@t.com", nome: "Carga", senhaHash: "x", papel: "ADMIN" } });
  const ex = await executorPg(process.env.DATABASE_URL!);
  for (const arqs of [EMOP_DBFS.map((p) => arquivo(p)), [arquivo(SINAPI_ZIP)]]) {
    const id = await identificar(arqs, { uf: "RJ" });
    const ini = await iniciarImportacao(ex, { ident: id.identificacao, usuarioId: u.id, arquivos: id.originais });
    await lerEmLotes(id, (l) => gravarLote(ex, ini.importacaoId, l));
    await validarImportacao(ex, ini.importacaoId);
    await confirmarImportacao(ex, ini.importacaoId, { usuarioId: u.id, cienteAvisos: true });
    await validarBase(ex, ini.baseRevisaoId, u.id);
    await publicarBase(ex, ini.baseRevisaoId, u.id);
  }
  await ex.encerrar?.();
  await prisma.$disconnect();
}
main();
