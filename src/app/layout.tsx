import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Orçamento de Obras — EMOP, SINAPI, SICRO e SCO",
  description: "Elaboração de orçamentos de obras com bases EMOP-RJ, SINAPI, SICRO e SCO-Rio",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
