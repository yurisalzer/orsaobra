import type { NextConfig } from "next";

const seguranca = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["bcryptjs"],
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
  webpack(config, { isServer, dev }) {
    // Grupos de rotas como "(app)" geram arquivos com parênteses no nome; o
    // servidor de arquivos da Cloudflare redireciona "%28app%29" para "(app)"
    // e o navegador entra em laço de redirecionamento. Trocamos os parênteses.
    if (!isServer && !dev) {
      const original = config.output.filename;
      config.output.filename = (dados: { chunk?: { name?: string | null } }) => {
        const nome = dados.chunk?.name;
        if (nome && /[()]/.test(nome)) return `static/chunks/${nome.replace(/[()]/g, "_")}-[contenthash].js`;
        return typeof original === "function" ? original(dados) : original;
      };
    }
    // O PDF dos relatórios é gerado só no navegador: o pdfmake e as fontes
    // (~2 MB) não precisam entrar no código do servidor (worker).
    if (isServer) {
      config.resolve.alias = { ...config.resolve.alias, "pdfmake/build/pdfmake": false, "pdfmake/build/vfs_fonts": false };
    }
    return config;
  },
  async headers() {
    return [{ source: "/:path*", headers: seguranca }];
  },
};

export default nextConfig;
