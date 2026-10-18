import Link from "next/link";
import { exigirUsuario, temPermissao } from "@/lib/auth/sessao";
import { executor } from "@/lib/banco/servidor";

export const dynamic = "force-dynamic";

export default async function Inicio() {
  const u = await exigirUsuario();
  const ex = await executor();
  const [bases, [contagem]] = await Promise.all([
    ex.consulta<{ id: string; fonte: string; uf: string; competencia: string; numero: number; status: string }>(
      `SELECT r.id, f.nome AS fonte, b.uf, to_char(b.competencia, 'MM/YYYY') AS competencia, r.numero, r.status::text AS status
         FROM base_revisao r JOIN base_mensal b ON b.id = r.base_id JOIN fonte f ON f.id = b.fonte_id
        WHERE r.status IN ('PUBLICADA', 'EM_IMPORTACAO', 'VALIDADA')
        ORDER BY (r.status = 'PUBLICADA') DESC, b.competencia DESC, f.codigo LIMIT 24`,
    ),
    ex.consulta<{ obras: number; orcamentos: number }>(`SELECT (SELECT count(*)::int FROM obra) AS obras, (SELECT count(*)::int FROM orcamento) AS orcamentos`),
  ]);
  const publicadas = bases.filter((b) => b.status === "PUBLICADA");
  const pendentes = bases.filter((b) => b.status !== "PUBLICADA");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Início</h1>
      <div className="grid gap-4 sm:grid-cols-3">
        <Cartao titulo="Obras" valor={contagem.obras} />
        <Cartao titulo="Orçamentos" valor={contagem.orcamentos} />
        <Cartao titulo="Bases publicadas" valor={publicadas.length} />
      </div>
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 font-medium">Bases de referência disponíveis</h2>
        {temPermissao(u, "IMPORTACAO") && pendentes.length > 0 && (
          <p className="mb-3 rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {pendentes.length} base(s) importada(s) aguardando validação/publicação: {pendentes.map((b) => `${b.fonte.split(" ")[0]} ${b.competencia}`).join(", ")}.{" "}
            <Link href="/importacao" className="underline">Revisar e publicar</Link>
          </p>
        )}
        {publicadas.length === 0 ? (
          <p className="text-sm text-slate-500">
            Nenhuma base publicada ainda. Um administrador deve importar e publicar as bases SINAPI, EMOP-RJ, SICRO ou SCO-Rio
            no menu Importação.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500">
              <tr><th className="py-1">Fonte</th><th>UF</th><th>Competência</th><th>Revisão</th></tr>
            </thead>
            <tbody>
              {publicadas.map((b) => (
                <tr key={b.id} className="border-t border-slate-100">
                  <td className="py-1">{b.fonte}</td>
                  <td>{b.uf}</td>
                  <td>{b.competencia}</td>
                  <td>{b.numero === 0 ? "Original" : `Retificação ${b.numero}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Cartao({ titulo, valor }: { titulo: string; valor: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <p className="text-sm text-slate-500">{titulo}</p>
      <p className="mt-1 text-3xl font-semibold text-marca-900">{valor}</p>
    </div>
  );
}
