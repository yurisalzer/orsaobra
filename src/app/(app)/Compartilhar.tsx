"use client";

import { useState } from "react";
import type { Recurso, UsuarioCompartilhamento } from "@/lib/acesso";
import { acaoDefinirAcesso, acaoListarAcesso } from "./acesso-acoes";

/**
 * Botão "Acesso" no orçamento/contrato: o criador ou o administrador escolhe
 * quem mais pode abrir (ver) ou editar.
 */
export function Compartilhar({ tipo, id }: { tipo: Recurso; id: string }) {
  const [aberto, setAberto] = useState(false);
  const [usuarios, setUsuarios] = useState<UsuarioCompartilhamento[] | null>(null);
  const [filtro, setFiltro] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState<string | null>(null);
  const nome = tipo === "orcamento" ? "orçamento" : "contrato";

  const abrir = async () => {
    setAberto(true);
    setErro(null);
    const r = await acaoListarAcesso(tipo, id);
    if (!r.ok) return setErro(r.erro);
    setUsuarios(r.dados);
  };
  const definir = async (u: UsuarioCompartilhamento, nivel: "VER" | "EDITAR" | null) => {
    setSalvando(u.id);
    setErro(null);
    const r = await acaoDefinirAcesso(tipo, id, u.id, nivel);
    setSalvando(null);
    if (!r.ok) return setErro(r.erro);
    setUsuarios((us) => us?.map((x) => (x.id === u.id ? { ...x, nivel } : x)) ?? null);
  };

  const visiveis = (usuarios ?? []).filter((u) => !filtro.trim() || `${u.nome} ${u.email}`.toLowerCase().includes(filtro.trim().toLowerCase()));
  return (
    <>
      <button onClick={abrir} className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50">Acesso</button>
      {aberto && (
        <div role="dialog" aria-modal="true" aria-label={`Acesso ao ${nome}`} className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
          <div className="mt-10 w-full max-w-2xl space-y-3 rounded-xl bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Quem pode acessar este {nome}</h2>
                <p className="text-sm text-slate-500">O criador e os administradores sempre têm acesso. Os demais só entram se forem escolhidos aqui; sem acesso, veem o {nome} na lista, mas não conseguem abri-lo.</p>
              </div>
              <button onClick={() => setAberto(false)} className="rounded-md border border-slate-300 px-3 py-1 text-sm">Fechar</button>
            </div>
            {erro && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{erro}</p>}
            {!usuarios ? <p className="text-sm text-slate-500">Carregando…</p> : (
              <>
                <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Filtrar por nome ou e-mail" aria-label="Filtrar usuários" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                <ul className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto">
                  {visiveis.map((u) => (
                    <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                      <div>
                        <p className="font-medium">{u.nome}</p>
                        <p className="text-xs text-slate-500">{u.email}</p>
                      </div>
                      {u.criador || u.administrador ? (
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{u.criador ? "Criador" : "Administrador"} — acesso total</span>
                      ) : (
                        <select value={u.nivel ?? ""} disabled={salvando === u.id} aria-label={`Acesso de ${u.nome}`}
                          onChange={(e) => definir(u, (e.target.value || null) as "VER" | "EDITAR" | null)}
                          className="rounded-md border border-slate-300 px-2 py-1 text-sm">
                          <option value="">Sem acesso</option>
                          <option value="VER">Pode ver</option>
                          <option value="EDITAR" disabled={!u.podeEditarGeral}>Pode ver e editar{u.podeEditarGeral ? "" : " (sem permissão de edição)"}</option>
                        </select>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
