import type { Metadata } from "next";
import "./globals.css";
import { SCRIPT_TEMA } from "./TemaSeletor";

export const metadata: Metadata = {
  title: "Orçamento de Obras — EMOP, SINAPI, SICRO e SCO",
  description: "Elaboração de orçamentos de obras com bases EMOP-RJ, SINAPI, SICRO e SCO-Rio",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        {/* tema (claro/escuro/automático) aplicado antes da pintura */}
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
      </head>
      <body className="flex min-h-screen flex-col">
        {children}
        <footer className="border-t border-slate-200 bg-white px-4 py-4 text-center text-xs text-slate-500 print:hidden">
          <p>Desenvolvido por: Yuri Salzer</p>
          <p>© 2026 - Todos os direitos reservados.</p>
        </footer>
      </body>
    </html>
  );
}
