# Implantação — Cloudflare Workers + Neon

## Plano da Cloudflare: recomendação

| | Workers Free | Workers Paid (US$ 5/mês) |
|---|---|---|
| CPU por requisição | **10 ms** | até 5 min (padrão 30 s) |
| Requisições | 100 mil/dia | sem limite diário (10 mi/mês incluídas) |
| Tamanho do Worker | 64 MiB (o nosso: 8,6 MiB) | 64 MiB |

Tempo esperando o banco **não** conta como CPU, mas o login (criptografia da
senha, ~200 ms de CPU por segurança) e a montagem das páginas ultrapassam
10 ms. No plano gratuito haveria falhas intermitentes ("Worker exceeded CPU
time limit"). **Recomendação: Workers Paid (US$ 5/mês).** O banco Neon
continua no plano gratuito.

## Passo a passo (pelo painel, sem programar)

1. Crie/acesse sua conta em <https://dash.cloudflare.com>.
2. **Workers & Pages → Create → Import a repository** → conecte o GitHub e
   escolha `yurisalzer/orsaobra`.
3. Configurações de build:
   - Build command: `npx opennextjs-cloudflare build`
   - Deploy command: `npx opennextjs-cloudflare deploy`
4. Em **Settings → Variables and Secrets**, adicione como **Secret**:
   - `DATABASE_URL` = a URL do Neon com `-pooler` (a mesma enviada no chat).
5. Salve e faça o deploy. A Cloudflare mostra o endereço
   `https://orsaobra.<sua-conta>.workers.dev`.
6. A cada `push` no GitHub, a Cloudflare publica a nova versão
   automaticamente (e o GitHub Actions roda todos os testes).

Alternativa: gerar um **API Token** da Cloudflare (modelo "Edit Cloudflare
Workers") e informar o token e o Account ID para a implantação ser feita
pela linha de comando (`npm run cf:deploy`).

## Banco de dados (Neon)

- Migrações: `npm run db:migrar` (porta 5432) ou, em redes que bloqueiam a
  5432, `npx dotenv -e .env.neon -- tsx scripts/migrar-neon-http.ts` (HTTPS).
- Nunca coloque a URL do banco no código ou no GitHub: ela fica só nos
  segredos da Cloudflare e no arquivo local `.env.neon` (ignorado pelo Git).
- Recomendação de segurança: como a senha do banco foi compartilhada em
  conversa, troque-a no painel do Neon (Roles → Reset password) após a
  implantação e atualize o segredo na Cloudflare.

## Importação pela linha de comando (opcional)

```bash
npx dotenv -e .env.neon -- tsx scripts/importar.ts --email admin@x.com arquivo.rar            # só analisa
npx dotenv -e .env.neon -- tsx scripts/importar.ts --email admin@x.com --confirmar --ciente-avisos arquivo.rar
```
