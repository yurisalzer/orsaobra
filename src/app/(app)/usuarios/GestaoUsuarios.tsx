"use client";

import { useRouter } from "next/navigation";
import { Fragment, useEffect, useState, useTransition } from "react";
import { completarPermissoes, MODELOS, PERMISSOES, rotuloPerfil, type Permissao } from "@/lib/auth/permissoes";
import type { UsuarioLista } from "@/lib/auth/usuarios";
import { acaoAplicarModelo, acaoCriarUsuario, acaoDefinirAtivo, acaoDefinirPermissao, acaoRedefinirSenha } from "./acoes";

const campo = "mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm";

function NovoUsuario({ aoFechar }: { aoFechar: () => void }) {
  const [d, setD] = useState({ nome: "", email: "", senha: "", modelo: "Orçamentista" });
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();
  const criar = () => iniciar(async () => {
    setErro(null);
    const r = await acaoCriarUsuario({ nome: d.nome, email: d.email, senha: d.senha, permissoes: MODELOS.find((m) => m.nome === d.modelo)!.permissoes });
    if (!r.ok) return setErro(r.erro);
    aoFechar();
    router.refresh();
  });
  return (
    <section className="space-y-3 rounded-xl border border-marca-200 bg-white p-5">
      <h2 className="font-medium">Novo usuário</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Nome<input value={d.nome} onChange={(e) => setD({ ...d, nome: e.target.value })} className={campo} /></label>
        <label className="text-sm">E-mail<input type="email" value={d.email} onChange={(e) => setD({ ...d, email: e.target.value })} className={campo} /></label>
        <label className="text-sm">Senha provisória (mín. 10 caracteres, letras e números)
          <input value={d.senha} onChange={(e) => setD({ ...d, senha: e.target.value })} autoComplete="new-password" className={campo} />
        </label>
        <label className="text-sm">Permissões iniciais
          <select value={d.modelo} onChange={(e) => setD({ ...d, modelo: e.target.value })} aria-label="Permissões iniciais" className={campo}>
            {MODELOS.map((m) => <option key={m.nome}>{m.nome}</option>)}
          </select>
        </label>
      </div>
      <p className="text-xs text-slate-500">Depois de criar, ajuste as permissões nas caixas. Informe a senha ao usuário; ele pode trocá-la em “Minha conta”.</p>
      {erro && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{erro}</p>}
      <div className="flex gap-2">
        <button onClick={criar} disabled={pendente} className="rounded-md bg-marca-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{pendente ? "Criando…" : "Criar usuário"}</button>
        <button onClick={aoFechar} className="rounded-md border border-slate-300 px-4 py-2 text-sm">Cancelar</button>
      </div>
    </section>
  );
}

export function GestaoUsuarios({ usuarios, euId }: { usuarios: UsuarioLista[]; euId: string }) {
  const router = useRouter();
  const [novo, setNovo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  // estado local para resposta imediata das caixas
  const [perms, setPerms] = useState<Record<string, Permissao[]>>(() => Object.fromEntries(usuarios.map((u) => [u.id, u.permissoes])));
  // quando a lista do servidor muda (após salvar ou criar), ela prevalece
  const [ativos, setAtivos] = useState<Record<string, boolean>>(() => Object.fromEntries(usuarios.map((u) => [u.id, u.ativo])));
  useEffect(() => {
    setPerms(Object.fromEntries(usuarios.map((u) => [u.id, u.permissoes])));
    setAtivos(Object.fromEntries(usuarios.map((u) => [u.id, u.ativo])));
  }, [usuarios]);

  const rodar = <T,>(f: () => Promise<{ ok: true; dados: T } | { ok: false; erro: string }>, depois?: (d: T) => void) => iniciar(async () => {
    setErro(null); setAviso(null);
    const r = await f();
    if (!r.ok) {
      setErro(r.erro);
      setPerms(Object.fromEntries(usuarios.map((u) => [u.id, u.permissoes])));
      setAtivos(Object.fromEntries(usuarios.map((u) => [u.id, u.ativo])));
      router.refresh();
      return;
    }
    depois?.(r.dados);
    router.refresh();
  });

  const alternar = (u: UsuarioLista, p: Permissao, conceder: boolean) => {
    const atual = new Set(perms[u.id]);
    if (conceder) atual.add(p); else atual.delete(p);
    setPerms({ ...perms, [u.id]: completarPermissoes(atual) });
    rodar(() => acaoDefinirPermissao(u.id, p, conceder), (final) => setPerms((x) => ({ ...x, [u.id]: final })));
  };

  return (
    <div className="space-y-4">
      {!novo && <button onClick={() => setNovo(true)} className="rounded-md bg-marca-600 px-4 py-2 text-sm font-medium text-white">Novo usuário</button>}
      {novo && <NovoUsuario aoFechar={() => setNovo(false)} />}
      {erro && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{erro}</p>}
      {aviso && <p role="status" className="whitespace-pre-line rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">{aviso}</p>}
      {pendente && <p className="text-xs text-slate-500" aria-live="polite">Salvando…</p>}

      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left">Usuário</th>
              <th className="px-2 text-center">Ativo</th>
              {PERMISSOES.map((p) => <th key={p.codigo} className="px-2 text-center font-medium" title={p.descricao}>{p.nome}</th>)}
              <th className="px-3 text-left">Ações</th>
            </tr>
          </thead>
          <tbody>
            {usuarios.map((u) => {
              const eu = u.id === euId;
              const ps = perms[u.id] ?? [];
              const ativo = ativos[u.id] ?? u.ativo;
              return (
                <tr key={u.id} className={`border-t border-slate-100 align-middle ${ativo ? "" : "bg-slate-50 text-slate-400"}`}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{u.nome}{eu && <span className="ml-1 text-xs text-slate-500">(você)</span>}</div>
                    <div className="text-xs text-slate-500">{u.email}</div>
                    <div className="text-xs text-slate-500">{rotuloPerfil(ps)} · último acesso: {u.ultimoAcesso ?? "nunca"}</div>
                  </td>
                  <td className="text-center">
                    <input type="checkbox" checked={ativo} disabled={eu || pendente} aria-label={`Ativo — ${u.nome}`} className="h-4 w-4"
                      onChange={(e) => { const v = e.target.checked; setAtivos({ ...ativos, [u.id]: v }); rodar(() => acaoDefinirAtivo(u.id, v)); }} />
                  </td>
                  {PERMISSOES.map((p) => (
                    <td key={p.codigo} className="text-center">
                      <input type="checkbox" className="h-4 w-4" checked={ps.includes(p.codigo)} disabled={pendente || !ativo || (eu && p.codigo === "USUARIOS")}
                        aria-label={`${p.nome} — ${u.nome}`} title={p.descricao} onChange={(e) => alternar(u, p.codigo, e.target.checked)} />
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-3 text-xs">
                    <select aria-label={`Aplicar modelo — ${u.nome}`} value="" disabled={pendente || !ativo} className="rounded border border-slate-300 px-1 py-0.5"
                      onChange={(e) => {
                        const m = MODELOS.find((x) => x.nome === e.target.value);
                        if (m && window.confirm(`Aplicar o modelo "${m.nome}" a ${u.nome}? As permissões atuais serão substituídas.`)) {
                          setPerms({ ...perms, [u.id]: m.permissoes });
                          rodar(() => acaoAplicarModelo(u.id, m.permissoes));
                        }
                      }}>
                      <option value="">Aplicar modelo…</option>
                      {MODELOS.map((m) => <option key={m.nome}>{m.nome}</option>)}
                    </select>{" "}
                    <button className="text-marca-700 underline disabled:opacity-50" disabled={pendente} onClick={() => {
                      if (window.confirm(`Gerar nova senha provisória para ${u.nome}? As sessões abertas dele(a) serão encerradas.`)) {
                        rodar(() => acaoRedefinirSenha(u.id), (senha) => setAviso(`Nova senha provisória de ${u.nome} (${u.email}):\n${senha}\nAnote e informe ao usuário — ela não será mostrada de novo.`));
                      }
                    }}>Nova senha</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 text-sm">
        <h2 className="font-medium">O que cada permissão libera</h2>
        <dl className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-[14rem_1fr]">
          {PERMISSOES.map((p) => <Fragment key={p.codigo}><dt className="font-medium">{p.nome}</dt><dd className="text-slate-600">{p.descricao}</dd></Fragment>)}
        </dl>
        <p className="mt-2 text-xs text-slate-500">
          “Editar orçamentos” e “Relatórios” incluem “Ver orçamentos”; “Composições próprias” inclui “Consulta de preços”. Deve sempre existir ao menos um usuário ativo com
          “Usuários e permissões”, e ninguém retira essa permissão de si mesmo nem se desativa.
        </p>
      </section>
    </div>
  );
}
