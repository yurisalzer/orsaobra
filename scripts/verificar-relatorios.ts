/**
 * Monta os 10 relatórios de uma revisão (somente leitura) e grava PDF/XLSX
 * numa pasta — para conferir os relatórios com os dados de um banco real.
 * Uso: npx dotenv -e .env.neon -- npx tsx scripts/verificar-relatorios.ts <pasta> [revisaoId]
 */
import fs from "node:fs";
import ExcelJS from "exceljs";
import { ProxyAgent, setGlobalDispatcher } from "undici";
import { criarExecutor } from "../src/lib/banco/executor";
import { RELATORIOS } from "../src/lib/relatorios/documento";
import { montarRelatorio } from "../src/lib/relatorios/montar";
import { definicaoPdf } from "../src/lib/relatorios/pdf";
import { gerarXlsx } from "../src/lib/relatorios/xlsx";

// no contêiner de desenvolvimento, o acesso externo passa por um proxy
const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
if (proxy) setGlobalDispatcher(new ProxyAgent(proxy));

async function main() {
  const [pasta, revisao] = process.argv.slice(2);
  const ex = await criarExecutor(process.env.DATABASE_URL!);
  const revs = await ex.consulta<{ id: string; numero: number; orcamento_id: string }>(
    `SELECT id, numero, orcamento_id FROM orcamento_revisao ${revisao ? "WHERE id = $1" : "ORDER BY criado_em DESC LIMIT 1"}`, revisao ? [revisao] : [],
  );
  const r = revs[0];
  const outras = await ex.consulta<{ id: string }>(`SELECT id FROM orcamento_revisao WHERE orcamento_id = $1 AND id <> $2 ORDER BY numero`, [r.orcamento_id, r.id]);
  const pdfmake = (await import("pdfmake")).default as unknown as {
    setFonts: (f: unknown) => void; setUrlAccessPolicy: (f: () => boolean) => void; setLocalAccessPolicy: (f: (p: string) => boolean) => void;
    createPdf: (d: unknown) => { getBuffer: () => Promise<Buffer> };
  };
  const dir = "node_modules/pdfmake/build/fonts/Roboto/";
  pdfmake.setFonts({ Roboto: { normal: `${dir}Roboto-Regular.ttf`, bold: `${dir}Roboto-Medium.ttf`, italics: `${dir}Roboto-Italic.ttf`, bolditalics: `${dir}Roboto-MediumItalic.ttf` } });
  pdfmake.setUrlAccessPolicy(() => false);
  pdfmake.setLocalAccessPolicy((p) => p.startsWith(dir));
  for (const t of RELATORIOS) {
    if (t.tipo === "comparativo" && !outras.length) continue;
    const t0 = Date.now();
    const d = await montarRelatorio(ex, r.id, t.tipo, { emitidoPor: "verificação", outraRevisaoId: outras.at(-1)?.id });
    const ms = Date.now() - t0;
    fs.writeFileSync(`${pasta}/${t.tipo}.pdf`, await pdfmake.createPdf(definicaoPdf(d)).getBuffer());
    fs.writeFileSync(`${pasta}/${t.tipo}.xlsx`, Buffer.from(await gerarXlsx(ExcelJS, d)));
    console.log(`${t.tipo.padEnd(13)} ${String(ms).padStart(5)} ms  linhas: ${d.secoes.reduce((a, s) => a + (s.tabela?.linhas.length ?? 0), 0)}  avisos: ${d.avisos.length}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
