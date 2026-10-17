/**
 * Dados iniciais mínimos e factuais: apenas o cadastro das fontes.
 * Regimes, preços e composições vêm exclusivamente da importação dos
 * arquivos oficiais — nada é presumido aqui.
 */
import { ProxyAgent, setGlobalDispatcher } from "undici";
import { criarExecutor } from "../src/lib/banco/executor";

const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
if (proxy) setGlobalDispatcher(new ProxyAgent(proxy));

async function main() {
  const fontes = [
    { codigo: "SINAPI", nome: "SINAPI — Sistema Nacional de Pesquisa de Custos e Índices da Construção Civil", oficial: true },
    { codigo: "EMOP", nome: "EMOP-RJ — Empresa de Obras Públicas do Estado do Rio de Janeiro", oficial: true },
    { codigo: "SICRO", nome: "SICRO — Sistema de Custos Referenciais de Obras (DNIT)", oficial: true },
    { codigo: "SCO", nome: "SCO-Rio — Sistema de Custos de Obras e Serviços de Engenharia (Prefeitura do Rio de Janeiro)", oficial: true },
    { codigo: "PROPRIA", nome: "Composições e insumos próprios", oficial: false },
  ];
  const ex = await criarExecutor();
  for (const f of fontes) {
    await ex.consulta(
      `INSERT INTO fonte (codigo, nome, oficial) VALUES ($1, $2, $3) ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, oficial = EXCLUDED.oficial`,
      [f.codigo, f.nome, f.oficial],
    );
  }
  console.log("Fontes cadastradas:", fontes.map((f) => f.codigo).join(", "));
  await ex.encerrar?.();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
