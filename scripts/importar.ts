/**
 * Importador de linha de comando (mesmos adaptadores e regras do assistente web).
 *
 *   npx dotenv -e .env.neon -- tsx scripts/importar.ts --email admin@x.com [--uf RJ]
 *        [--confirmar] [--ciente-avisos] [--publicar] [--retificacao "motivo"] [--autorizar-duplicidade] arquivo1 [arquivo2...]
 *
 * Sem --confirmar, apenas analisa e valida (nada vai para as tabelas definitivas).
 */
import fs from "node:fs";
import { ProxyAgent, setGlobalDispatcher } from "undici";
import { criarExecutor } from "../src/lib/banco/executor";
import { arquivoDeBytes } from "../src/lib/importacao/leitores/arquivo";
import { identificar, lerEmLotes } from "../src/lib/importacao/processar";
import {
  confirmarImportacao, gravarLote, iniciarImportacao, publicarBase, validarBase, validarImportacao, registrarFalha,
} from "../src/lib/importacao/servico";

const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
if (proxy) setGlobalDispatcher(new ProxyAgent(proxy));

function args() {
  const a = process.argv.slice(2);
  const o = { email: "", uf: "RJ", confirmar: false, ciente: false, publicar: false, retificacao: null as string | null, autorizar: false, arquivos: [] as string[] };
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (x === "--email") o.email = a[++i];
    else if (x === "--uf") o.uf = a[++i].toUpperCase();
    else if (x === "--confirmar") o.confirmar = true;
    else if (x === "--ciente-avisos") o.ciente = true;
    else if (x === "--publicar") o.publicar = true;
    else if (x === "--retificacao") o.retificacao = a[++i];
    else if (x === "--autorizar-duplicidade") o.autorizar = true;
    else o.arquivos.push(x);
  }
  if (!o.email || o.arquivos.length === 0) throw new Error("Uso: importar.ts --email <admin> [opções] arquivos...");
  return o;
}

async function main() {
  const o = args();
  const ex = await criarExecutor(process.env.DATABASE_URL);
  const [u] = await ex.consulta<{ id: string; papel: string }>(`SELECT id, papel FROM usuario WHERE email = $1 AND ativo`, [o.email.toLowerCase()]);
  if (!u || u.papel !== "ADMIN") throw new Error("Usuário administrador não encontrado.");

  const t0 = Date.now();
  const originais = o.arquivos.map((p) => arquivoDeBytes(p, new Uint8Array(fs.readFileSync(p))));
  const id = await identificar(originais, { uf: o.uf });
  const ident = id.identificacao;
  console.log(`Layout: ${id.adaptador.descricao} v${ident.versao}`);
  console.log(`Fonte ${ident.fonte} · UF ${ident.uf} · competência ${ident.competencia} · regimes: ${ident.regimes.map((r) => r.nome).join(", ")}`);
  for (const ob of ident.observacoes) console.log(`  · ${ob}`);
  for (const a of id.originais) console.log(`  SHA-256 ${a.sha256}  ${a.nome} (${a.tamanho} bytes)`);

  const ini = await iniciarImportacao(ex, {
    ident, usuarioId: u.id, autorizarDuplicidade: o.autorizar, retificacao: o.retificacao ? { motivo: o.retificacao } : null,
    arquivos: id.originais.map((a) => ({ ...a, papel: ident.arquivos.map((x) => x.nome).join(", ") })),
  });
  console.log(`Importação ${ini.importacaoId} (revisão ${ini.numeroRevisao} da base)`);
  try {
    const tot = await lerEmLotes(id, (lote) => gravarLote(ex, ini.importacaoId, lote), {
      tamanhoLote: 3000,
      aoProgresso: (p) => process.stdout.write(`\r  enviados: ${p.itens} itens, ${p.precos} preços, ${p.componentes} componentes`),
    });
    console.log(`\nLeitura concluída: ${JSON.stringify(tot)} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (e) {
    await registrarFalha(ex, ini.importacaoId, u.id, (e as Error).message);
    throw e;
  }

  const v = await validarImportacao(ex, ini.importacaoId);
  console.log(`Validação: ${v.status} — ${v.erros} erros, ${v.avisos} avisos; ${JSON.stringify(v.contagens)}`);
  const ocorr = await ex.consulta<{ severidade: string; regra: string; n: number; exemplo: string }>(
    `SELECT severidade, regra, count(*)::int AS n, min(mensagem) AS exemplo FROM verificacao_importacao WHERE importacao_id = $1 GROUP BY 1, 2 ORDER BY 1, 2`,
    [ini.importacaoId],
  );
  for (const r of ocorr) console.log(`  [${r.severidade}] ${r.regra}: ${r.n} registro(s) — ex.: ${r.exemplo}`);
  if (v.status !== "VALIDADA" || !o.confirmar) {
    console.log(o.confirmar ? "Não confirmada (há erros)." : "Somente análise (use --confirmar para gravar).");
    return;
  }
  const t1 = Date.now();
  await confirmarImportacao(ex, ini.importacaoId, { usuarioId: u.id, cienteAvisos: o.ciente });
  const [g] = await ex.consulta<{ resumo: { gravado: unknown } }>(`SELECT resumo FROM importacao WHERE id = $1`, [ini.importacaoId]);
  console.log(`Confirmada em ${((Date.now() - t1) / 1000).toFixed(1)} s: ${JSON.stringify(g.resumo.gravado)}`);
  if (o.publicar) {
    await validarBase(ex, ini.baseRevisaoId, u.id);
    await publicarBase(ex, ini.baseRevisaoId, u.id);
    console.log("Base validada e publicada.");
  }
  await ex.encerrar?.();
}

main().catch((e) => {
  console.error("\nERRO:", e.message);
  process.exit(1);
});
