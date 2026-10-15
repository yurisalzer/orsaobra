import { prisma } from "@/lib/db";
import { exigirUsuario } from "@/lib/auth/sessao";

export const dynamic = "force-dynamic";

const fmtCompetencia = (d: Date) =>
  d.toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric", timeZone: "UTC" });

export default async function Inicio() {
  await exigirUsuario();
  const [bases, orcamentos, obras] = await Promise.all([
    prisma.baseRevisao.findMany({
      where: { status: "PUBLICADA" },
      include: { base: { include: { fonte: true } } },
      orderBy: { base: { competencia: "desc" } },
      take: 12,
    }),
    prisma.orcamento.count(),
    prisma.obra.count(),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Início</h1>
      <div className="grid gap-4 sm:grid-cols-3">
        <Cartao titulo="Obras" valor={obras} />
        <Cartao titulo="Orçamentos" valor={orcamentos} />
        <Cartao titulo="Bases publicadas" valor={bases.length} />
      </div>
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 font-medium">Bases de referência disponíveis</h2>
        {bases.length === 0 ? (
          <p className="text-sm text-slate-500">
            Nenhuma base publicada ainda. Um administrador deve importar e publicar as bases SINAPI e EMOP-RJ
            no menu Importação.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500">
              <tr><th className="py-1">Fonte</th><th>UF</th><th>Competência</th><th>Revisão</th></tr>
            </thead>
            <tbody>
              {bases.map((b) => (
                <tr key={b.id} className="border-t border-slate-100">
                  <td className="py-1">{b.base.fonte.nome}</td>
                  <td>{b.base.uf}</td>
                  <td>{fmtCompetencia(b.base.competencia)}</td>
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
