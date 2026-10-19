"use client";

import { useState, useTransition } from "react";
import { acaoEnviarContato, type EstadoContato } from "./acoes";

const campo = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-marca-600 focus:outline-none focus:ring-1 focus:ring-marca-600";

/** Máscara (00) 00000-0000 enquanto digita. */
const mascaraTelefone = (v: string) => {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  const resto = d.slice(2);
  const corte = d.length === 11 ? 5 : 4;
  return `(${d.slice(0, 2)}) ${resto.length > corte ? `${resto.slice(0, corte)}-${resto.slice(corte)}` : resto}`;
};

export function FormContato({ nome, email, modulos }: { nome: string; email: string; modulos: string[] }) {
  const [estado, setEstado] = useState<EstadoContato>({});
  const [pendente, iniciar] = useTransition();
  const [telefone, setTelefone] = useState("");
  const [chave, setChave] = useState(0); // recria o formulário vazio depois do envio

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
      {estado.enviado && (
        <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          Solicitação enviada. Obrigado! {estado.entregue ? "" : "A mensagem foi registrada e será encaminhada ao responsável."}
        </p>
      )}
      <form key={chave} className="space-y-3" onSubmit={(e) => {
        e.preventDefault();
        const dados = new FormData(e.currentTarget);
        iniciar(async () => {
          const r = await acaoEnviarContato({}, dados);
          setEstado(r);
          if (r.enviado) { setTelefone(""); setChave((k) => k + 1); }
        });
      }}>
        <label className="block text-sm font-medium text-slate-700">Nome
          <input name="nome" required defaultValue={nome} maxLength={120} placeholder="Digite seu nome" className={campo} />
        </label>
        <label className="block text-sm font-medium text-slate-700">Contato
          <input name="contato" type="tel" inputMode="tel" value={telefone} onChange={(e) => setTelefone(mascaraTelefone(e.target.value))} placeholder="(00) 00000-0000" className={campo} />
        </label>
        <label className="block text-sm font-medium text-slate-700">E-mail
          <input name="email" type="email" required defaultValue={email} maxLength={200} placeholder="Digite seu e-mail" className={campo} />
        </label>
        <label className="block text-sm font-medium text-slate-700">Módulo
          <select name="modulo" required defaultValue="" className={campo}>
            <option value="" disabled>Selecione um módulo</option>
            {modulos.map((m) => <option key={m}>{m}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-700">Mensagem
          <textarea name="mensagem" required rows={6} maxLength={5000} placeholder="Digite sua mensagem" className={campo} />
        </label>
        {estado.erro && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{estado.erro}</p>}
        <button type="submit" disabled={pendente} className="w-full rounded-md bg-marca-600 px-4 py-2 font-medium text-white hover:bg-marca-700 disabled:opacity-60">
          {pendente ? "Enviando…" : "Enviar solicitação"}
        </button>
      </form>
    </div>
  );
}
