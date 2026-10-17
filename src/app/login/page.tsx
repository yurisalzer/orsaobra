import { FormLogin } from "./FormLogin";

export default function PaginaLogin() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-marca-900">Orçamento de Obras</h1>
        <p className="mb-6 mt-1 text-sm text-slate-500">Bases de referência EMOP-RJ, SINAPI e SICRO</p>
        <FormLogin />
      </div>
    </main>
  );
}
