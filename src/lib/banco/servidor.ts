import "server-only";
import { criarExecutor, type Executor } from "./executor";

// Uma instância por processo (servidor local) ou por isolate (Cloudflare).
let instancia: Promise<Executor> | null = null;

export function executor(): Promise<Executor> {
  instancia ??= criarExecutor(process.env.DATABASE_URL);
  return instancia;
}
