import Link from "next/link";
import { exigirUsuario } from "@/lib/auth/sessao";
import { executor } from "@/lib/banco/servidor";
import { listarBases, listarImportacoes } from "@/lib/importacao/consultas";
import { AcoesBase } from "./AcoesBase";

export const dynamic = "force-dynamic";

const STATUS_BASE: Record<string, { nome: string; cor: string }> = {
  EM_IMPORTACAO: { nome: "Aguardando validação", cor: "bg-amber-100 text-amber-900" },
  VALIDADA: { nome: "Validada — aguardando publicação", cor: "bg-blue-100 text-blue-900" },
  PUBLICADA: { nome: "Publicada", cor: "bg-green-100 text-green-800" },
  SUBSTITUIDA: { nome: "Substituída por retificação", cor: "bg-slate-100 text-slate-600" },
};
const STATUS_IMP: Record<string, string> = {
  RECEBIDA: "Recebendo dados", ANALISADA: "Analisada", COM_ERROS: "Com erros", VALIDADA: "Validada (não confirmada)",
  CONFIRMADA: "Confirmada", FALHOU: "Falhou (nada gravado)", CANCELADA: "Cancelada",
};

export default async function PaginaImportacao() {
  await exigirUsuario("IMPORTACAO");
  const ex = await executor();
  const [bases, importacoes] = await Promise.all([listarBases(ex), listarImportacoes(ex)]);
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Bases de referência</h1>
        <Link href="/importacao/nova" className="rounded-md bg-marca-600 px-4 py-2 text-sm font-medium text-white hover:bg-marca-700">Nova importação</Link>
      </div>

      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-5">
        <p className="mb-3 text-sm text-slate-500">Fluxo: importar → conferir o relatório → <strong>Validar</strong> → <strong>Publicar</strong>. Só bases publicadas aparecem para novos orçamentos.</p>
        {bases.length === 0 ? <p className="text-sm text-slate-500">Nenhuma base importada.</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500">
              <tr><th className="py-1">Fonte</th><th>UF</th><th>Competência</th><th>Revisão</th><th className="text-right">Preços</th><th className="text-right">Composições</th><th>Situação</th><th>Ações</th></tr>
            </thead>
            <tbody>
              {bases.map((b) => {
                const rotulo = `${b.fonte} ${b.uf} ${b.competencia}${b.numero ? ` (retificação ${b.numero})` : ""}`;
                const st = STATUS_BASE[b.status] ?? { nome: b.status, cor: "bg-slate-100" };
                return (
                  <tr key={b.revisao_id} className="border-t border-slate-100">
                    <td className="py-2 font-medium">{b.fonte}</td><td>{b.uf}</td><td>{b.competencia}</td>
                    <td>{b.numero === 0 ? "Original" : `Retificação ${b.numero}`}{b.motivo ? <div className="text-xs text-slate-500">{b.motivo}</div> : null}</td>
                    <td className="num">{b.precos.toLocaleString("pt-BR")}</td><td className="num">{b.composicoes.toLocaleString("pt-BR")}</td>
                    <td><span className={`rounded px-2 py-0.5 text-xs ${st.cor}`}>{st.nome}</span>{b.publicada_em ? <div className="text-xs text-slate-500">em {b.publicada_em}</div> : null}</td>
                    <td><AcoesBase revisaoId={b.revisao_id} status={b.status} rotulo={rotulo} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 font-medium">Histórico de importações</h2>
        {importacoes.length === 0 ? <p className="text-sm text-slate-500">Nenhuma importação.</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500"><tr><th className="py-1">Data</th><th>Fonte</th><th>Competência</th><th>Arquivos</th><th>Situação</th><th className="text-right">Erros</th><th className="text-right">Avisos</th><th>Por</th><th /></tr></thead>
            <tbody>
              {importacoes.map((i) => (
                <tr key={i.id} className="border-t border-slate-100">
                  <td className="py-2 whitespace-nowrap">{i.iniciada_em}</td><td>{i.fonte}</td><td>{i.competencia}{i.numero ? ` (ret. ${i.numero})` : ""}</td>
                  <td className="max-w-xs truncate" title={i.arquivos}>{i.arquivos}</td><td>{STATUS_IMP[i.status] ?? i.status}</td>
                  <td className="num">{i.erros}</td><td className="num">{i.avisos}</td><td>{i.usuario}</td>
                  <td><Link className="text-marca-700 underline" href={`/importacao/${i.id}`}>Relatório</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
