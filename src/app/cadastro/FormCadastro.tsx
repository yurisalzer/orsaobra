"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { acaoCadastrar, type EstadoCadastro } from "./acoes";

const campo = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 focus:border-marca-600 focus:outline-none focus:ring-1 focus:ring-marca-600";

/** Máscara 000.000.000-00 enquanto digita. */
const mascaraCpf = (v: string) => {
  const d = v.replace(/\D/g, "").slice(0, 11);
  return d.replace(/^(\d{3})(\d)/, "$1.$2").replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
};
/** Máscara (00) 00000-0000 enquanto digita. */
const mascaraTelefone = (v: string) => {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  const resto = d.slice(2);
  const corte = d.length === 11 ? 5 : 4;
  return `(${d.slice(0, 2)}) ${resto.length > corte ? `${resto.slice(0, corte)}-${resto.slice(corte)}` : resto}`;
};

function Campo({ rotulo, obrigatorio, ajuda, children }: { rotulo: string; obrigatorio?: boolean; ajuda?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{rotulo}{obrigatorio ? <span className="text-red-600" aria-hidden> *</span> : <span className="font-normal text-slate-500"> (opcional)</span>}</span>
      {children}
      {ajuda && <span className="mt-1 block text-xs text-slate-500">{ajuda}</span>}
    </label>
  );
}

export function FormCadastro() {
  // envio manual (sem <form action>) para o React não limpar os campos quando há erro
  const [estado, setEstado] = useState<EstadoCadastro>({});
  const [pendente, iniciar] = useTransition();
  const [cpf, setCpf] = useState("");
  const [telefone, setTelefone] = useState("");

  if (estado.enviado) {
    return (
      <div role="status" className="space-y-3 text-sm text-slate-700">
        <p className="rounded-md bg-green-50 px-3 py-2 text-green-800">Cadastro recebido.</p>
        <p>Enviamos um e-mail para <strong>{estado.email}</strong> com o link de confirmação (válido por 48 horas). Abra o link para confirmar o seu e-mail.</p>
        <p>Depois da confirmação, o administrador analisará o cadastro e liberará o acesso às funcionalidades. Você será avisado por e-mail.</p>
        <p className="text-xs text-slate-500">Não chegou? Verifique a caixa de spam ou <Link href="/cadastro/reenviar" className="underline">peça um novo e-mail</Link>.</p>
      </div>
    );
  }

  return (
    <form className="space-y-4" onSubmit={(e) => {
      e.preventDefault();
      const dados = new FormData(e.currentTarget);
      iniciar(async () => setEstado(await acaoCadastrar({}, dados)));
    }}>
      <Campo rotulo="Nome completo" obrigatorio>
        <input name="nome" required minLength={5} maxLength={120} autoComplete="name" className={campo} />
      </Campo>
      <Campo rotulo="E-mail" obrigatorio ajuda="Usado para entrar no sistema, confirmar o cadastro e receber avisos.">
        <input name="email" type="email" required maxLength={200} autoComplete="email" className={campo} />
      </Campo>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="CPF" obrigatorio>
          <input name="cpf" required inputMode="numeric" value={cpf} onChange={(e) => setCpf(mascaraCpf(e.target.value))} placeholder="000.000.000-00" className={campo} />
        </Campo>
        <Campo rotulo="Telefone">
          <input name="telefone" type="tel" inputMode="tel" value={telefone} onChange={(e) => setTelefone(mascaraTelefone(e.target.value))} placeholder="(21) 90000-0000" autoComplete="tel" className={campo} />
        </Campo>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Senha" obrigatorio ajuda="Mínimo de 10 caracteres, com letras e números.">
          <input name="senha" type="password" required minLength={10} maxLength={200} autoComplete="new-password" className={campo} />
        </Campo>
        <Campo rotulo="Confirme a senha" obrigatorio>
          <input name="confirmacao" type="password" required minLength={10} maxLength={200} autoComplete="new-password" className={campo} />
        </Campo>
      </div>
      {/* armadilha para robôs: invisível para pessoas */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>Site<input name="site" tabIndex={-1} autoComplete="off" /></label>
      </div>
      <p className="text-xs text-slate-500">
        O cadastro não libera o acesso automaticamente: depois de confirmar o e-mail, o administrador define quais funcionalidades você poderá usar.
        A senha é guardada de forma cifrada (nunca em texto).
      </p>
      {estado.erro && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{estado.erro}</p>}
      <button type="submit" disabled={pendente}
        className="w-full rounded-md bg-marca-600 px-4 py-2 font-medium text-white hover:bg-marca-700 disabled:opacity-60">
        {pendente ? "Enviando…" : "Criar conta"}
      </button>
    </form>
  );
}
