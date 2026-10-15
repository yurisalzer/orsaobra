import { exigirUsuario } from "@/lib/auth/sessao";
import { EmConstrucao } from "@/components/EmConstrucao";

export default async function Pagina() {
  await exigirUsuario();
  return <EmConstrucao titulo="Composições" etapa="Etapa 3" />;
}
