"use client";

import "./globals.css";
import { TelaErro } from "./TelaErro";

// Erro no próprio layout raiz: precisa desenhar <html> e <body>.
export default function ErroGlobal({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="pt-BR">
      <body className="px-4">
        <TelaErro error={error} />
      </body>
    </html>
  );
}
