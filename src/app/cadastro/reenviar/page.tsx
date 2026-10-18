import { Cartao } from "../Cartao";
import { FormReenviar } from "./FormReenviar";

export const metadata = { title: "Reenviar confirmação — Orçamento de Obras" };

export default function PaginaReenviar() {
  return (
    <Cartao titulo="Reenviar confirmação">
      <FormReenviar />
    </Cartao>
  );
}
