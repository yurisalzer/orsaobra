import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Orçamento de Obras — EMOP, SINAPI e SICRO",
  description: "Elaboração de orçamentos de obras com bases EMOP-RJ, SINAPI e SICRO",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
