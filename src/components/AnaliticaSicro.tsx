import type { AnaliticaSicro } from "@/lib/importacao/adaptadores/sicro-xlsx";
import { formatarCoeficiente, formatarPreco } from "@/lib/formato/precos";

const p = (v: string | null | undefined) => (v === null || v === undefined || v === "" ? "—" : formatarPreco(v));
const q = (v: string | null | undefined) => (v === null || v === undefined || v === "" ? "—" : formatarCoeficiente(v));

function Tabela({ titulo, cab, linhas, total }: { titulo: string; cab: string[]; linhas: (string | null)[][]; total?: [string, string | null] }) {
  return (
    <div className="mt-3">
      <h3 className="text-sm font-medium text-marca-700">{titulo}</h3>
      {linhas.length === 0 ? <p className="text-xs text-slate-500">—</p> : (
        <table className="mt-1 w-full text-sm">
          <thead className="text-left text-xs text-slate-500"><tr>{cab.map((c, i) => <th key={c} className={i >= 2 ? "text-right" : ""}>{c}</th>)}</tr></thead>
          <tbody>{linhas.map((l, i) => (
            <tr key={i} className="border-t border-slate-100 align-top">{l.map((c, j) => <td key={j} className={j === 0 ? "whitespace-nowrap font-mono" : j >= 2 ? "num whitespace-nowrap" : ""}>{c}</td>)}</tr>
          ))}</tbody>
        </table>
      )}
      {total && <p className="mt-1 text-right text-sm"><span className="text-slate-500">{total[0]}:</span> <strong>{p(total[1])}</strong></p>}
    </div>
  );
}

/** Composição de custo unitário do SICRO, como publicada pelo DNIT. */
export function ComposicaoSicro({ a }: { a: AnaliticaSicro }) {
  const t = a.totais;
  return (
    <div>
      <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[16rem_1fr]">
        <dt className="text-slate-500">Produção da equipe</dt><dd>{q(a.producao.quantidade)} {a.producao.unidade}/h</dd>
        <dt className="text-slate-500">FIC (fator de influência de chuvas)</dt><dd>{a.fic ? formatarCoeficiente(a.fic) : "—"}</dd>
      </dl>
      <Tabela titulo="A — Equipamentos" cab={["Código", "Descrição", "Quantidade", "Utiliz. operativa", "Utiliz. improdutiva", "Custo produtivo", "Custo improdutivo", "Custo horário total"]}
        linhas={a.equipamentos.map((e) => [e.codigo, e.descricao, q(e.quantidade), q(e.operativa), q(e.improdutiva), p(e.custoProdutivo), p(e.custoImprodutivo), p(e.custoHorario)])}
        total={["Custo horário total de equipamentos", t.equipamentos]} />
      <Tabela titulo="B — Mão de obra" cab={["Código", "Descrição", "Quantidade", "Unid.", "Custo horário", "Custo horário total"]}
        linhas={a.maoDeObra.map((m) => [m.codigo, m.descricao, q(m.quantidade), m.unidade, p(m.custoHorario), p(m.custo)])}
        total={["Custo horário total de mão de obra", t.maoDeObra]} />
      <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[22rem_1fr]">
        <dt className="text-slate-500">Custo horário total de execução</dt><dd>{p(t.execucaoHorario)}</dd>
        <dt className="text-slate-500">Custo unitário de execução (÷ produção da equipe)</dt><dd>{p(t.execucaoUnitario)}</dd>
        <dt className="text-slate-500">Custo do FIC</dt><dd>{p(t.fic)}</dd>
      </dl>
      <Tabela titulo="C — Material" cab={["Código", "Descrição", "Quantidade", "Unid.", "Preço unitário", "Custo unitário"]}
        linhas={a.materiais.map((m) => [m.codigo, m.descricao, q(m.quantidade), m.unidade, p(m.precoUnitario), p(m.custo)])}
        total={["Custo unitário total de material", t.material]} />
      <Tabela titulo="D — Atividades auxiliares" cab={["Código", "Descrição", "Quantidade", "Unid.", "Custo unitário", "Custo"]}
        linhas={a.auxiliares.map((m) => [m.codigo, m.descricao, q(m.quantidade), m.unidade, p(m.custoUnitario), p(m.custo)])}
        total={["Custo total de atividades auxiliares", t.auxiliares]} />
      <p className="mt-2 text-right text-sm"><span className="text-slate-500">Subtotal:</span> <strong>{p(t.subtotal)}</strong></p>
      <Tabela titulo="E — Tempo fixo" cab={["Item", "Descrição", "Composição", "Quantidade", "Unid.", "Custo unitário", "Custo"]}
        linhas={a.tempoFixo.map((m) => [m.item, m.descricao, m.codigo, q(m.quantidade), m.unidade, p(m.custoUnitario), p(m.custo)])}
        total={["Custo unitário total de tempo fixo", t.tempoFixo]} />
      <Tabela titulo="F — Momento de transporte" cab={["Item", "Descrição", "Quantidade", "Unid.", "DMT LN", "DMT RP", "DMT P"]}
        linhas={a.transporte.map((m) => [m.item, m.descricao, q(m.quantidade), m.unidade, m.ln, m.rp, m.p])} />
      {a.transporte.length > 0 && <p className="mt-1 text-xs text-amber-800">O custo do momento de transporte não está incluído: depende da DMT (distância) da obra e deve ser orçado à parte com as composições de transporte indicadas.</p>}
      <p className="mt-3 text-right"><span className="text-slate-500">Custo unitário direto total:</span> <strong>{p(t.total)}</strong></p>
      {a.observacoes.length > 0 && <p className="mt-2 text-xs text-slate-600">Obs.: {a.observacoes.join(" ")}</p>}
    </div>
  );
}
