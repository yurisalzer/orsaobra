import Link from "next/link";
import { FormLogin } from "./FormLogin";

export default function PaginaLogin() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-marca-900">Orçamento de Obras</h1>
        <p className="mb-6 mt-1 text-sm text-slate-500">Bases de referência EMOP-RJ, SINAPI, SICRO e SCO-Rio</p>
        <FormLogin />
        <p className="mt-6 border-t border-slate-100 pt-4 text-center text-sm text-slate-600">
          Ainda não tem acesso? <Link href="/cadastro" className="font-medium text-marca-700 underline">Criar conta</Link>
        </p>
      </div>
    </main>
  );
}
