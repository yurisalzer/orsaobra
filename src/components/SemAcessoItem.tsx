import Link from "next/link";

/** Página mostrada a quem vê o orçamento/contrato na lista, mas não recebeu acesso a ele. */
export function SemAcessoItem({ tipo, titulo, voltar }: { tipo: "orçamento" | "contrato"; titulo?: string; voltar: string }) {
  return (
    <section role="alert" className="mx-auto max-w-xl space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-6 text-amber-950">
      <h1 className="text-lg font-semibold">Sem acesso a este {tipo}</h1>
      {titulo && <p className="text-sm">{titulo}</p>}
      <p className="text-sm">
        Só quem criou o {tipo}, os administradores e os usuários escolhidos por eles podem abri-lo. Peça acesso a quem o criou ou ao administrador.
      </p>
      <Link href={voltar} className="inline-block rounded-md border border-amber-400 bg-white px-3 py-1.5 text-sm">Voltar à lista</Link>
    </section>
  );
}
