# Orçamento de Obras — EMOP-RJ e SINAPI

Sistema web para orçamentos de obras com bases oficiais EMOP-RJ e SINAPI (UF RJ).

- Planejamento completo: [`docs/PLANEJAMENTO.md`](docs/PLANEJAMENTO.md)
- Layouts dos arquivos oficiais: [`docs/LAYOUTS.md`](docs/LAYOUTS.md)
- Implantação (Cloudflare + Neon): [`docs/IMPLANTACAO.md`](docs/IMPLANTACAO.md)

## Para rodar no seu computador (desenvolvimento)

Requisitos: Node.js 22 e PostgreSQL 16 (ou um banco Neon).

```bash
npm install
cp .env.example .env          # ajuste DATABASE_URL
npm run db:migrar             # cria as tabelas
npm run db:seed               # cadastra as fontes (SINAPI, EMOP, PRÓPRIA)
ADMIN_SENHA='UmaSenhaForte123' npm run criar-admin -- seu@email.com "Seu Nome"
npm run dev                   # abre em http://localhost:3000
```

## Testes

```bash
npm test          # unidade + banco (usa .env.test, banco separado)
AMOSTRAS_REAIS=/pasta/com/os/originais npm test   # inclui os arquivos oficiais completos
npm run build && npm run test:e2e   # navegador real (Playwright)
```

## Regras importantes

- Preços, composições, coeficientes e unidades vêm **somente** dos arquivos oficiais importados.
- Preço ausente nunca é tratado como zero.
- Bases publicadas e revisões de orçamento fechadas são imutáveis (garantido pelo banco).
- Credenciais do banco ficam apenas no servidor (variáveis de ambiente), nunca no navegador.
