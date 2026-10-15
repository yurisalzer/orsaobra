import { exigirUsuario } from "@/lib/auth/sessao";
import { EmConstrucao } from "@/components/EmConstrucao";

export default async function Pagina() {
  await exigirUsuario("ADMIN");
  return <EmConstrucao titulo="Importação de bases" etapa="Etapa 2" />;
}
