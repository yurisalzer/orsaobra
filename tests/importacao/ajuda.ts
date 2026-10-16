import fs from "node:fs";
import path from "node:path";
import { arquivoDeBytes, type ArquivoEntrada } from "@/lib/importacao/leitores/arquivo";
import type { Emissor, Ocorrencia, RegComponente, RegItem, RegPreco } from "@/lib/importacao/tipos";

export const FIXTURES = path.join(process.cwd(), "tests", "fixtures");
export const EMOP_DBFS = ["EMOP", "DIPR", "COMP", "MAT", "ELEM", "REUT"].map((t) => path.join(FIXTURES, `${t}0926.dbf`));
export const SINAPI_ZIP = path.join(FIXTURES, "SINAPI-2026-09-amostra.zip");

export function arquivo(p: string, nome = path.basename(p)): ArquivoEntrada {
  return arquivoDeBytes(nome, new Uint8Array(fs.readFileSync(p)));
}

export function coletor() {
  const r = { itens: [] as RegItem[], precos: [] as RegPreco[], componentes: [] as RegComponente[], ocorrencias: [] as Ocorrencia[] };
  const emissor: Emissor = {
    item: (x) => { r.itens.push(x); },
    preco: (x) => { r.precos.push(x); },
    componente: (x) => { r.componentes.push(x); },
    ocorrencia: (x) => { r.ocorrencias.push(x); },
  };
  return { ...r, emissor };
}
