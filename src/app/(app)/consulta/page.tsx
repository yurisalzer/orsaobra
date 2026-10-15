import { exigirUsuario } from "@/lib/auth/sessao";
import { EmConstrucao } from "@/components/EmConstrucao";

export default async function Pagina() {
  await exigirUsuario();
  return <EmConstrucao titulo="Consulta de preços" etapa="Etapa 3" />;
}
