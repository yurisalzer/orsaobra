/**
 * Conexão com o Neon via WebSocket (porta 443) para scripts de linha de
 * comando. Usado quando a porta 5432 está bloqueada (redes corporativas,
 * ambientes de nuvem) e é o mesmo protocolo usado em produção na Cloudflare.
 */
import { neonConfig, Pool } from "@neondatabase/serverless";
import WebSocket from "ws";
import { HttpsProxyAgent } from "https-proxy-agent";

export function poolNeon(connectionString: string): Pool {
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  if (proxy) {
    const agent = new HttpsProxyAgent(proxy);
    neonConfig.webSocketConstructor = class extends WebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols, { agent });
      }
    } as unknown as typeof WebSocket;
  } else {
    neonConfig.webSocketConstructor = WebSocket;
  }
  return new Pool({ connectionString });
}
