import ExcelJS from "exceljs";
import { z } from "zod";
import { temPermissao, usuarioAtual } from "@/lib/auth/sessao";
import { executor } from "@/lib/banco/servidor";
import { detalheImportacao, verificacoes } from "@/lib/importacao/consultas";
import type { Identificacao } from "@/lib/importacao/tipos";

export const dynamic = "force-dynamic";

/** Relatório de inconsistências da importação em XLSX. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await usuarioAtual();
  if (!u || !temPermissao(u, "IMPORTACAO")) return new Response("Não autorizado", { status: 403 });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return new Response("Não encontrado", { status: 404 });
  const ex = await executor();
  const d = await detalheImportacao(ex, id);
  if (!d) return new Response("Não encontrado", { status: 404 });
  const ident = d.resumo.identificacao as Identificacao;
  const lista = await verificacoes(ex, id, 100_000);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Orçamento de Obras";
  const r = wb.addWorksheet("Resumo");
  r.columns = [{ width: 28 }, { width: 100 }];
  const linhas: [string, string][] = [
    ["Fonte", `${ident.fonte} — ${ident.uf}`],
    ["Competência", ident.competencia.split("-").reverse().join("/")],
    ["Revisão da base", d.numero === 0 ? "Original" : `Retificação ${d.numero}`],
    ["Regimes", ident.regimes.map((x) => x.nome).join("; ")],
    ["Importador", `${d.adaptador} v${d.adaptador_versao} — ${ident.layout}`],
    ["Situação", d.status + (d.erro ? ` — ${d.erro}` : "")],
    ["Início", d.iniciada_em], ["Conclusão", d.concluida_em ?? "—"], ["Usuário", d.usuario],
    ...d.arquivos.map((a) => [`Arquivo`, `${a.nome_original} (${a.tamanho_bytes} bytes) SHA-256 ${a.sha256}`] as [string, string]),
    ...d.grupos.map((g) => [`${g.severidade} — ${g.regra}`, String(g.total)] as [string, string]),
  ];
  linhas.forEach((l) => r.addRow(l));
  r.getColumn(1).font = { bold: true };

  const v = wb.addWorksheet("Verificações");
  v.columns = [
    { header: "Gravidade", key: "severidade", width: 10 }, { header: "Regra", key: "regra", width: 26 },
    { header: "Mensagem", key: "mensagem", width: 90 }, { header: "Arquivo", key: "arquivo", width: 34 },
    { header: "Planilha", key: "planilha", width: 12 }, { header: "Linha", key: "linha", width: 8 },
    { header: "Campo", key: "campo", width: 12 }, { header: "Valor", key: "valor", width: 20 },
  ];
  v.getRow(1).font = { bold: true };
  v.views = [{ state: "frozen", ySplit: 1 }];
  lista.forEach((x) => v.addRow(x));
  v.autoFilter = { from: "A1", to: "H1" };

  const buf = await wb.xlsx.writeBuffer();
  const nome = `importacao-${ident.fonte}-${ident.competencia}-${id.slice(0, 8)}.xlsx`;
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nome}"`,
      "Cache-Control": "no-store",
    },
  });
}
