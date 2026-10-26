import Link from "next/link";
import { exigirUsuario } from "@/lib/auth/sessao";
import { executor } from "@/lib/banco/servidor";
import { listarCabecalhos } from "@/lib/relatorios/cabecalhos";
import { empresasParaContrato } from "@/lib/empresas/servico";
import { listarRegimes } from "@/lib/contratos/regimes";
import { ImportarPlanilha } from "./ImportarPlanilha";

export const dynamic = "force-dynamic";

export default async function PaginaImportarPlanilha() {
  await exigirUsuario("MEDICOES_EDITAR");
  const ex = await executor();
  const [obras, cabecalhos, empresas, regimes] = await Promise.all([
    ex.consulta<{ id: string; nome: string; codigo: string | null; processo: string | null }>(`SELECT id, nome, codigo, processo FROM obra ORDER BY nome`),
    listarCabecalhos(ex, true),
    empresasParaContrato(ex),
    listarRegimes(ex),
  ]);
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-slate-500"><Link href="/contratos" className="underline">Contratos</Link></p>
        <h1 className="text-2xl font-semibold">Importar planilha da proposta vencedora</h1>
        <p className="text-sm text-slate-500">Arquivo .xls, .xlsx ou .pdf com a planilha contratada. Códigos, descrições, unidades, quantidades e preços unitários são gravados exatamente como no arquivo.</p>
      </div>
      <ImportarPlanilha obras={obras} empresas={empresas} regimes={regimes} cabecalhos={cabecalhos.map((c) => ({ id: c.id, nome: c.nome, padrao: c.padrao }))} />
    </div>
  );
}
