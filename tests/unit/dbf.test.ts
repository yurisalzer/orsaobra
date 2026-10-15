import { describe, expect, it } from "vitest";
import { decodificadores, ErroDbf, lerDbf, type RegistroDbf } from "@/lib/importacao/leitores/dbf";

/** Monta um DBF dBase III em memória (mesma estrutura dos arquivos da EMOP). */
function montarDbf(campos: { nome: string; tipo: string; tamanho: number; decimais?: number }[], linhas: (string[] | { excluido: true; valores: string[] })[], opc: { declarar?: number } = {}) {
  const tamRegistro = 1 + campos.reduce((a, c) => a + c.tamanho, 0);
  const tamCab = 32 + 32 * campos.length + 1;
  const total = opc.declarar ?? linhas.length;
  const buf = new Uint8Array(tamCab + tamRegistro * linhas.length + 1);
  const dv = new DataView(buf.buffer);
  buf[0] = 0x03; buf[1] = 126; buf[2] = 10; buf[3] = 5; // 2026-10-05
  dv.setUint32(4, total, true); dv.setUint16(8, tamCab, true); dv.setUint16(10, tamRegistro, true);
  campos.forEach((c, i) => {
    const o = 32 + i * 32;
    for (let k = 0; k < c.nome.length; k++) buf[o + k] = c.nome.charCodeAt(k);
    buf[o + 11] = c.tipo.charCodeAt(0); buf[o + 16] = c.tamanho; buf[o + 17] = c.decimais ?? 0;
  });
  buf[tamCab - 1] = 0x0d;
  linhas.forEach((l, i) => {
    const excl = !Array.isArray(l);
    const valores = Array.isArray(l) ? l : l.valores;
    let o = tamCab + i * tamRegistro;
    buf[o++] = excl ? 0x2a : 0x20;
    campos.forEach((c, j) => {
      const v = valores[j] ?? "";
      const txt = c.tipo === "N" ? v.padStart(c.tamanho, " ") : v.padEnd(c.tamanho, " ");
      for (let k = 0; k < c.tamanho; k++) buf[o + k] = txt.charCodeAt(k) & 0xff;
      o += c.tamanho;
    });
  });
  buf[buf.length - 1] = 0x1a;
  return buf;
}

function fluxo(bytes: Uint8Array, pedaco = 7): ReadableStream<Uint8Array> {
  let pos = 0;
  return new ReadableStream({
    pull(ctrl) {
      if (pos >= bytes.length) return ctrl.close();
      ctrl.enqueue(bytes.slice(pos, pos + pedaco));
      pos += pedaco;
    },
  });
}

async function lerTudo(bytes: Uint8Array, opc: Parameters<typeof lerDbf>[1] = {}) {
  const out: RegistroDbf[] = [];
  const it = lerDbf(fluxo(bytes), opc);
  let r = await it.next();
  while (!r.done) { out.push(r.value.registro); r = await it.next(); }
  return { registros: out, resumo: r.value };
}

const CAMPOS_MAT = [
  { nome: "ELEMENTAR", tipo: "C", tamanho: 5 },
  { nome: "DESCRICAO", tipo: "C", tamanho: 10 },
  { nome: "DESCR1", tipo: "C", tamanho: 10 },
  { nome: "UNID", tipo: "C", tamanho: 6 },
  { nome: "PRECO", tipo: "N", tamanho: 21, decimais: 4 },
];

describe("leitor DBF", () => {
  it("lê campos, preserva zeros à esquerda e números como texto exato", async () => {
    const dbf = montarDbf(CAMPOS_MAT, [["00001", "AREIA", "", "M3", "150.0000"], ["00093", "X", "", "UN", "751642.5000"]]);
    const { registros, resumo } = await lerTudo(dbf);
    expect(registros[0]).toEqual({ ELEMENTAR: "00001", DESCRICAO: "AREIA", DESCR1: null, UNID: "M3", PRECO: "150.0000" });
    expect(registros[1].PRECO).toBe("751642.5000");
    expect(resumo).toEqual({ excluidos: 0, lidos: 2 });
  });

  it("campos numéricos com mais de 20 posições (caso real EMOP)", async () => {
    const dbf = montarDbf(CAMPOS_MAT, [["00002", "A", "", "KG", "123456789012345.1234"]]);
    expect((await lerTudo(dbf)).registros[0].PRECO).toBe("123456789012345.1234");
  });

  it("decodifica CP850 (Nº gravado como 0xA7)", async () => {
    const dbf = montarDbf(CAMPOS_MAT, [["00003", "ARAME N\u00a7 1", "8", "KG", "1"]]); // campo de 10 posições cheio, como no arquivo real
    const r = (await lerTudo(dbf, { decodificar: decodificadores.cp850, aparar: false })).registros[0];
    expect((r.DESCRICAO! + r.DESCR1!).trimEnd()).toBe("ARAME Nº 18");
  });

  it("sem aparar: permite juntar descrição quebrada sem perder espaços", async () => {
    const dbf = montarDbf(CAMPOS_MAT, [["00004", "AREIA PARA", " REGIAO", "M3", "1"]]);
    const r = (await lerTudo(dbf, { aparar: false })).registros[0];
    expect((r.DESCRICAO! + (r.DESCR1 ?? "")).trimEnd()).toBe("AREIA PARA REGIAO");
  });

  it("ignora e conta registros excluídos", async () => {
    const dbf = montarDbf(CAMPOS_MAT, [["00001", "A", "", "M3", "1"], { excluido: true, valores: ["00002", "B", "", "M3", "2"] }]);
    const { registros, resumo } = await lerTudo(dbf);
    expect(registros.map((x) => x.ELEMENTAR)).toEqual(["00001"]);
    expect(resumo).toEqual({ excluidos: 1, lidos: 1 });
  });

  it("arquivo truncado gera erro (não importa parcialmente em silêncio)", async () => {
    const dbf = montarDbf(CAMPOS_MAT, [["00001", "A", "", "M3", "1"]], { declarar: 3 });
    await expect(lerTudo(dbf)).rejects.toThrow(ErroDbf);
    await expect(lerTudo(dbf.slice(0, 20))).rejects.toThrow(/cabeçalho/);
  });

  it("arquivo que não é DBF é rejeitado", async () => {
    const lixo = new TextEncoder().encode("<html>isto não é um DBF, é uma página de erro do servidor</html>");
    await expect(lerTudo(lixo)).rejects.toThrow(ErroDbf);
  });
});
