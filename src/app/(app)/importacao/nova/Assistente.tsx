"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Identificacao } from "@/lib/importacao/tipos";
import type { Lote } from "@/lib/importacao/servico";
import { acaoCancelar, acaoConfirmar, acaoEnviarLote, acaoIniciar, acaoValidar } from "../acoes";

type Fase = "fonte" | "arquivos" | "analisando" | "identificado" | "enviando" | "validando" | "previa" | "gravando" | "concluido";
interface Original { nome: string; tamanho: number; sha256: string }
interface Progresso { itens: number; precos: number; componentes: number; ocorrencias: number }
type Validacao = Extract<Awaited<ReturnType<typeof acaoValidar>>, { ok: true }>["dados"];

const PASSOS = [
  "Fonte", "Arquivos", "Layout", "Competência", "Regimes", "Envio", "Validação", "Pré-visualização", "Confirmação e gravação", "Relatório",
];
const passoDaFase: Record<Fase, number> = {
  fonte: 0, arquivos: 1, analisando: 2, identificado: 3, enviando: 5, validando: 6, previa: 7, gravando: 8, concluido: 9,
};
const fmtComp = (c: string) => c.split("-").reverse().join("/");
const fmtNum = (n: number) => n.toLocaleString("pt-BR");
const fmtBytes = (n: number) => (n > 1e6 ? `${(n / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB` : `${fmtNum(Math.ceil(n / 1e3))} kB`);
const LIMITE_ARQUIVO = 200 * 1024 * 1024;

export function Assistente() {
  const [fase, setFase] = useState<Fase>("fonte");
  const [fonte, setFonte] = useState<"SINAPI" | "EMOP" | "SICRO" | "SCO">("SINAPI");
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [ident, setIdent] = useState<Identificacao | null>(null);
  const [originais, setOriginais] = useState<Original[]>([]);
  const [compOk, setCompOk] = useState(false);
  const [regimes, setRegimes] = useState<string[]>([]);
  const [retificar, setRetificar] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [duplicidade, setDuplicidade] = useState<{ pedir: boolean; autorizar: boolean }>({ pedir: false, autorizar: false });
  const [erro, setErro] = useState<string | null>(null);
  const [progresso, setProgresso] = useState<Progresso | null>(null);
  const [importacaoId, setImportacaoId] = useState<string | null>(null);
  const [validacao, setValidacao] = useState<Validacao | null>(null);
  const [ciente, setCiente] = useState(false);
  const worker = useRef<Worker | null>(null);

  useEffect(() => () => worker.current?.terminate(), []);

  function novoWorker() {
    worker.current?.terminate();
    worker.current = new Worker(new URL("./trabalhador.ts", import.meta.url));
    return worker.current;
  }

  function analisar() {
    setErro(null);
    const grande = arquivos.find((a) => a.size > LIMITE_ARQUIVO);
    if (grande) return setErro(`O arquivo ${grande.name} excede o limite de ${fmtBytes(LIMITE_ARQUIVO)}.`);
    setFase("analisando");
    const w = novoWorker();
    w.onmessage = (ev) => {
      const m = ev.data;
      if (m.tipo === "identificado") {
        setIdent(m.identificacao);
        setOriginais(m.originais);
        setRegimes(m.identificacao.regimes.map((r: { codigo: string }) => r.codigo));
        setCompOk(false);
        setFase("identificado");
      } else if (m.tipo === "erro") {
        setErro(m.mensagem);
        setFase("arquivos");
      }
    };
    w.postMessage({ tipo: "identificar", arquivos, uf: "RJ", fonte });
  }

  async function iniciar() {
    if (!ident) return;
    setErro(null);
    const r = await acaoIniciar({
      identificacao: { ...ident, regimes: ident.regimes.filter((x) => regimes.includes(x.codigo)) },
      arquivos: originais,
      competenciaConfirmada: true,
      autorizarDuplicidade: duplicidade.autorizar,
      retificacao: retificar ? motivo : null,
    });
    if (!r.ok) {
      if (r.codigo === "DUPLICADO") setDuplicidade({ pedir: true, autorizar: false });
      if (r.codigo === "COMPETENCIA_PUBLICADA") setRetificar(true);
      return setErro(r.erro);
    }
    setImportacaoId(r.dados.importacaoId);
    setFase("enviando");
    enviar(r.dados.importacaoId);
  }

  function enviar(id: string) {
    const w = worker.current!;
    w.onmessage = async (ev) => {
      const m = ev.data;
      if (m.tipo === "lote") {
        const r = await acaoEnviarLote(id, m.lote as Lote);
        if (!r.ok) setErro(r.erro);
        w.postMessage({ tipo: "ack", id: m.id, ok: r.ok });
      } else if (m.tipo === "progresso") {
        setProgresso(m.progresso);
      } else if (m.tipo === "fim") {
        setProgresso(m.total);
        setFase("validando");
        const v = await acaoValidar(id);
        if (!v.ok) return setErro(v.erro);
        setValidacao(v.dados);
        setFase("previa");
      } else if (m.tipo === "erro") {
        setErro(`Falha na leitura: ${m.mensagem}`);
        await acaoCancelar(id);
      }
    };
    w.postMessage({ tipo: "ler", regimes });
  }

  async function confirmar() {
    if (!importacaoId) return;
    setErro(null);
    setFase("gravando");
    const r = await acaoConfirmar(importacaoId, ciente);
    if (!r.ok) {
      setErro(r.erro);
      setFase("previa");
      return;
    }
    setFase("concluido");
  }

  async function cancelar() {
    if (importacaoId) await acaoCancelar(importacaoId);
    worker.current?.terminate();
    window.location.href = "/importacao";
  }

  const passo = passoDaFase[fase];
  const temErros = (validacao?.resumo.erros ?? 0) > 0;
  const temAvisos = (validacao?.resumo.avisos ?? 0) > 0;

  return (
    <div className="space-y-6">
      <ol className="flex flex-wrap gap-2 text-xs">
        {PASSOS.map((p, i) => (
          <li key={p} className={`rounded-full px-3 py-1 ${i < passo ? "bg-green-100 text-green-800" : i === passo ? "bg-marca-600 text-white" : "bg-slate-100 text-slate-500"}`}>
            {i + 1}. {p}
          </li>
        ))}
      </ol>

      {erro && <p role="alert" className="whitespace-pre-line rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{erro}</p>}

      {fase === "fonte" && (
        <Cartao titulo="1. Fonte de referência">
          <div className="flex gap-4">
            {(["SINAPI", "EMOP", "SICRO", "SCO"] as const).map((f) => (
              <label key={f} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-3 ${fonte === f ? "border-marca-600 bg-marca-50" : "border-slate-200"}`}>
                <input type="radio" name="fonte" checked={fonte === f} onChange={() => setFonte(f)} />
                <span>{f === "SINAPI" ? "SINAPI (Caixa)" : f === "EMOP" ? "EMOP-RJ" : f === "SICRO" ? "SICRO (DNIT)" : "SCO-Rio (Prefeitura/FGV)"}</span>
              </label>
            ))}
          </div>
          <p className="mt-3 text-sm text-slate-500">UF: <strong>RJ</strong> (somente Rio de Janeiro nesta fase).</p>
          <Botao onClick={() => setFase("arquivos")}>Continuar</Botao>
        </Cartao>
      )}

      {(fase === "arquivos" || fase === "analisando") && (
        <Cartao titulo="2. Arquivos oficiais">
          <p className="text-sm text-slate-600">
            {fonte === "SINAPI"
              ? "Envie o ZIP oficial \"SINAPI-AAAA-MM-formato-xlsx.zip\" (ou a planilha SINAPI_Referência_AAAA_MM.xlsx)."
              : fonte === "EMOP"
                ? "Envie o RAR mensal da EMOP (ex.: 092026.rar) ou os arquivos DBF (EMOP, DIPR, COMP, MAT, ELEM, REUT)."
                : fonte === "SCO"
                  ? "Envie os ZIPs do SCO (\"ARQUIVOS-COM-CATALOGO-DAS-COMPOSICOES-O-EXCEL.zip\" e/ou \"...-D-EXCEL.zip\") ou os XLSX FGV04, FGV06 e FGV07 de cada pacote. Envie o O (onerado) e o D (desonerado) juntos para ter os dois regimes."
                  : "Extraia o pacote do SICRO (ex.: rj-07-2026.7z) e selecione os relatórios XLSX (pode selecionar todos; os PDFs não são usados), ou envie-os num ZIP. São necessários: Sintético de Composições de Custos, Materiais, Mão de Obra e Equipamentos (com e sem desoneração) e Analítico de Composições de Custos."}
            {" "}Os arquivos são lidos no seu computador; só os dados extraídos são enviados ao servidor.
          </p>
          <input
            type="file" multiple accept=".zip,.rar,.dbf,.xlsx" disabled={fase === "analisando"}
            onChange={(e) => setArquivos(Array.from(e.target.files ?? []))}
            className="mt-3 block w-full text-sm file:mr-4 file:rounded-md file:border-0 file:bg-marca-600 file:px-4 file:py-2 file:text-white"
            aria-label="Arquivos oficiais"
          />
          {arquivos.length > 0 && (
            <ul className="mt-3 text-sm text-slate-600">
              {arquivos.map((a) => <li key={a.name}>{a.name} — {fmtBytes(a.size)}</li>)}
            </ul>
          )}
          <div className="flex gap-3">
            <Botao onClick={analisar} desabilitado={arquivos.length === 0 || fase === "analisando"}>
              {fase === "analisando" ? "Analisando arquivos…" : "Analisar arquivos"}
            </Botao>
            <Botao secundario onClick={() => setFase("fonte")}>Voltar</Botao>
          </div>
        </Cartao>
      )}

      {fase === "identificado" && ident && (
        <Cartao titulo="3–5. Layout, competência e regimes identificados">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[12rem_1fr]">
            <dt className="text-slate-500">Layout</dt><dd>{ident.layout} <span className="text-slate-400">(importador {ident.adaptador} v{ident.versao})</span></dd>
            <dt className="text-slate-500">Fonte / UF</dt><dd>{ident.fonte} — {ident.uf}</dd>
            <dt className="text-slate-500">Competência (lida do arquivo)</dt><dd className="font-semibold">{fmtComp(ident.competencia)}</dd>
            {ident.dataEmissao && (<><dt className="text-slate-500">Data no arquivo</dt><dd>{ident.dataEmissao}</dd></>)}
            <dt className="text-slate-500">Arquivos usados</dt>
            <dd><ul>{ident.arquivos.map((a) => <li key={a.nome}>{a.nome} — <span className="text-slate-500">{a.papel}</span></li>)}</ul></dd>
            <dt className="text-slate-500">SHA-256</dt>
            <dd><ul className="font-mono text-xs">{originais.map((o) => <li key={o.sha256}>{o.sha256} · {o.nome}</li>)}</ul></dd>
          </dl>
          {ident.observacoes.length > 0 && (
            <ul className="mt-3 list-disc pl-5 text-sm text-slate-600">{ident.observacoes.map((o) => <li key={o}>{o}</li>)}</ul>
          )}
          <fieldset className="mt-4">
            <legend className="text-sm font-medium">Regimes de encargos publicados — importar:</legend>
            {ident.regimes.map((r) => (
              <label key={r.codigo} className="mt-1 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={regimes.includes(r.codigo)}
                  onChange={(e) => setRegimes(e.target.checked ? [...regimes, r.codigo] : regimes.filter((x) => x !== r.codigo))} />
                {r.nome}{r.descricao ? <span className="text-slate-500"> — {r.descricao}</span> : null}
              </label>
            ))}
          </fieldset>
          <label className="mt-4 flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={compOk} onChange={(e) => setCompOk(e.target.checked)} />
            Confirmo que a competência é {fmtComp(ident.competencia)}
          </label>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={retificar} onChange={(e) => setRetificar(e.target.checked)} />
            Esta importação é uma retificação de competência já publicada
          </label>
          {retificar && (
            <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo / referência da retificação"
              className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" aria-label="Motivo da retificação" />
          )}
          {duplicidade.pedir && (
            <label className="mt-3 flex items-center gap-2 rounded-md bg-amber-50 p-2 text-sm text-amber-900">
              <input type="checkbox" checked={duplicidade.autorizar} onChange={(e) => setDuplicidade({ pedir: true, autorizar: e.target.checked })} />
              Autorizo reimportar arquivo já importado (ficará registrado na auditoria)
            </label>
          )}
          <div className="flex gap-3">
            <Botao onClick={iniciar} desabilitado={!compOk || regimes.length === 0 || (retificar && motivo.trim().length < 5)}>Iniciar importação</Botao>
            <Botao secundario onClick={() => setFase("arquivos")}>Trocar arquivos</Botao>
          </div>
        </Cartao>
      )}

      {(fase === "enviando" || fase === "validando") && (
        <Cartao titulo={fase === "enviando" ? "6. Lendo e enviando dados" : "7. Validando"}>
          <p className="text-sm text-slate-600" aria-live="polite">
            {progresso ? `${fmtNum(progresso.itens)} itens, ${fmtNum(progresso.precos)} preços, ${fmtNum(progresso.componentes)} componentes de composições` : "Iniciando…"}
          </p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full w-1/3 animate-pulse rounded-full bg-marca-600" /></div>
          {fase === "validando" && <p className="mt-3 text-sm text-slate-500">Conferindo códigos, preços, unidades, componentes e referências circulares…</p>}
        </Cartao>
      )}

      {(fase === "previa" || fase === "gravando") && validacao && (
        <>
          <Cartao titulo="7. Resultado da validação">
            <div className="grid gap-3 sm:grid-cols-5">
              <Num rotulo="Itens" valor={validacao.resumo.contagens.itens} />
              <Num rotulo="Preços publicados" valor={validacao.resumo.contagens.precos} />
              <Num rotulo="Sem preço" valor={validacao.resumo.contagens.precosAusentes} />
              <Num rotulo="Composições analíticas" valor={validacao.resumo.contagens.composicoes} />
              <Num rotulo="Componentes" valor={validacao.resumo.contagens.componentes} />
            </div>
            <table className="mt-4 w-full text-sm">
              <thead className="text-left text-slate-500"><tr><th className="py-1">Gravidade</th><th>Regra</th><th className="text-right">Registros</th></tr></thead>
              <tbody>
                {validacao.grupos.map((g) => (
                  <tr key={g.severidade + g.regra} className="border-t border-slate-100">
                    <td className="py-1"><Selo severidade={g.severidade} /></td><td>{g.regra}</td><td className="num">{fmtNum(g.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {importacaoId && (
              <p className="mt-3 text-sm">
                <Link className="text-marca-700 underline" href={`/importacao/${importacaoId}`} target="_blank">Ver relatório completo de inconsistências</Link>
                {" · "}
                <a className="text-marca-700 underline" href={`/api/importacao/${importacaoId}/relatorio`}>Baixar em Excel</a>
              </p>
            )}
          </Cartao>

          <Cartao titulo="8. Pré-visualização (amostra aleatória do que será gravado)">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-slate-500"><tr><th className="py-1">Tipo</th><th>Código</th><th>Descrição</th><th>Unid.</th><th>Preços por regime (R$)</th></tr></thead>
                <tbody>
                  {validacao.amostra.map((a) => (
                    <tr key={a.tipo + a.codigo} className="border-t border-slate-100 align-top">
                      <td className="py-1 pr-2">{a.tipo === "INSUMO" ? "Insumo" : "Composição"}</td>
                      <td className="whitespace-nowrap pr-2 font-mono">{a.codigo}</td>
                      <td className="pr-2">{a.descricao}</td>
                      <td className="pr-2">{a.unidade ?? <em className="text-amber-700">não publicada</em>}</td>
                      <td className="whitespace-nowrap text-xs">
                        {a.precos ? Object.entries(a.precos).map(([r, v]) => (
                          <div key={r}>{r}: {v === null ? <em className="text-amber-700">sem preço</em> : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</div>
                        )) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Cartao>

          <Cartao titulo="9. Confirmação e gravação">
            {temErros ? (
              <p className="text-sm text-red-700">Há erros bloqueantes. Corrija os arquivos (ou aguarde atualização do importador) e tente novamente.</p>
            ) : (
              <>
                {temAvisos && (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={ciente} onChange={(e) => setCiente(e.target.checked)} />
                    Li e estou ciente dos {fmtNum(validacao.resumo.avisos)} avisos
                  </label>
                )}
                <p className="mt-2 text-sm text-slate-500">A gravação ocorre numa única transação: ou tudo é gravado, ou nada.</p>
              </>
            )}
            <div className="flex gap-3">
              {!temErros && (
                <Botao onClick={confirmar} desabilitado={fase === "gravando" || (temAvisos && !ciente)}>
                  {fase === "gravando" ? "Gravando…" : "Confirmar importação"}
                </Botao>
              )}
              <Botao secundario onClick={cancelar} desabilitado={fase === "gravando"}>Cancelar importação</Botao>
            </div>
          </Cartao>
        </>
      )}

      {fase === "concluido" && importacaoId && (
        <Cartao titulo="10. Importação gravada">
          <p className="text-sm text-slate-700">
            Os dados foram gravados. A base ainda <strong>não está disponível para orçamentos</strong>: confira o relatório e,
            na lista de bases, use <em>Validar</em> e depois <em>Publicar</em>.
          </p>
          <p className="mt-3 flex gap-4 text-sm">
            <Link className="text-marca-700 underline" href={`/importacao/${importacaoId}`}>Relatório da importação</Link>
            <a className="text-marca-700 underline" href={`/api/importacao/${importacaoId}/relatorio`}>Baixar relatório em Excel</a>
            <Link className="text-marca-700 underline" href="/importacao">Ir para a lista de bases</Link>
          </p>
        </Cartao>
      )}
    </div>
  );
}

function Cartao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="font-medium">{titulo}</h2>
      {children}
    </section>
  );
}

function Botao({ children, onClick, desabilitado, secundario }: { children: React.ReactNode; onClick: () => void; desabilitado?: boolean; secundario?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={desabilitado}
      className={`mt-2 rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 ${secundario ? "border border-slate-300 hover:bg-slate-50" : "bg-marca-600 text-white hover:bg-marca-700"}`}>
      {children}
    </button>
  );
}

function Num({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="text-xs text-slate-500">{rotulo}</p>
      <p className="text-lg font-semibold">{fmtNum(valor)}</p>
    </div>
  );
}

export function Selo({ severidade }: { severidade: string }) {
  const cor = severidade === "ERRO" ? "bg-red-100 text-red-800" : severidade === "AVISO" ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-700";
  const nome = severidade === "ERRO" ? "Erro" : severidade === "AVISO" ? "Aviso" : "Info";
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${cor}`}>{nome}</span>;
}
