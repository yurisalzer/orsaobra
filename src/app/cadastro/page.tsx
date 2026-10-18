import { Cartao } from "./Cartao";
import { FormCadastro } from "./FormCadastro";

export const metadata = { title: "Criar conta — Orçamento de Obras" };

export default function PaginaCadastro() {
  return (
    <Cartao titulo="Criar conta" largo>
      <FormCadastro />
    </Cartao>
  );
}
