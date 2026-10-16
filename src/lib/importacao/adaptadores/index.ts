import type { Adaptador } from "../tipos";
import { adaptadorEmopDbf } from "./emop-dbf";
import { adaptadorSinapiXlsx2025 } from "./sinapi-xlsx-2025";

/**
 * Adaptadores disponíveis. Quando a fonte mudar o layout, crie um novo
 * adaptador (com nova versão) e adicione aqui — os antigos continuam
 * servindo para reimportar competências antigas.
 */
export const ADAPTADORES: Adaptador[] = [adaptadorSinapiXlsx2025, adaptadorEmopDbf];

export function adaptadorPorId(id: string): Adaptador | undefined {
  return ADAPTADORES.find((a) => a.id === id);
}
