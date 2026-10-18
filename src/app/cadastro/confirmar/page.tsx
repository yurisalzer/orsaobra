import Link from "next/link";
import { confirmarEmail } from "@/lib/auth/cadastro";
import { urlBase } from "@/lib/auth/requisicao";
import { executor } from "@/lib/banco/servidor";
import { Cartao } from "../Cartao";

export const dynamic = "force-dynamic";
export const metadata = { title: "Confirmação de e-mail — Orçamento de Obras" };

export default async function PaginaConfirmar({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const r = await confirmarEmail(await executor(), token ?? "", await urlBase());
  return (
    <Cartao titulo="Confirmação de e-mail">
      {r.ok ? (
        <div role="status" className="space-y-3 text-sm text-slate-700">
          <p className="rounded-md bg-green-50 px-3 py-2 text-green-800">{r.jaConfirmado ? "Este e-mail já estava confirmado." : "E-mail confirmado. Obrigado!"}</p>
          <p>{r.nome}, o seu cadastro agora aguarda a liberação do acesso pelo administrador. Você receberá um e-mail quando o acesso for liberado.</p>
        </div>
      ) : (
        <div className="space-y-3 text-sm text-slate-700">
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-red-700">{r.mensagem}</p>
          <p><Link href="/cadastro/reenviar" className="font-medium text-marca-700 underline">Pedir um novo e-mail de confirmação</Link></p>
        </div>
      )}
    </Cartao>
  );
}
