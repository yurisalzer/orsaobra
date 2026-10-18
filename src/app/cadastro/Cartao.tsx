import Link from "next/link";

/** Moldura das telas públicas de cadastro (mesmo visual do login). */
export function Cartao({ titulo, children, largo }: { titulo: string; children: React.ReactNode; largo?: boolean }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className={`w-full ${largo ? "max-w-lg" : "max-w-sm"} rounded-xl border border-slate-200 bg-white p-8 shadow-sm`}>
        <p className="text-sm font-medium text-marca-900">Orçamento de Obras</p>
        <h1 className="mb-5 mt-1 text-xl font-semibold text-marca-900">{titulo}</h1>
        {children}
        <p className="mt-6 border-t border-slate-100 pt-4 text-center text-sm text-slate-600">
          <Link href="/login" className="font-medium text-marca-700 underline">Voltar ao login</Link>
        </p>
      </div>
    </main>
  );
}
