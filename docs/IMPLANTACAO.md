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

## Situação atual

- No ar em **https://orsaobra.orsaobra.workers.dev** (Worker `orsaobra`, conta Cloudflare do usuário).
- Segredo `DATABASE_URL` configurado no Worker (URL *pooled* do Neon).
- Medido em produção: login ≈ 0,95 s de CPU (criptografia da senha) — concluído
  normalmente na conta atual; acompanhe em Workers → orsaobra → Metrics.

## Implantação automática a cada atualização (GitHub Actions)

O fluxo `.github/workflows/testes.yml` roda os testes e, se passarem, publica
na Cloudflare. Para ativar, cadastre 2 segredos no GitHub (uma única vez):
**github.com/yurisalzer/orsaobra → Settings → Secrets and variables → Actions → New repository secret**

| Nome | Valor |
|---|---|
| `CLOUDFLARE_API_TOKEN` | o token da Cloudflare (começa com `cfat_`) |
| `CLOUDFLARE_ACCOUNT_ID` | `2138d6809e04a1508fbc87b3deb396cb` |

## Passo a passo alternativo (pelo painel, sem programar)

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

## E-mails (cadastro, confirmação e avisos)

O sistema envia e-mails pela API da [Resend](https://resend.com) (plano gratuito: 3.000/mês, 100/dia).
1. Crie a conta na Resend e verifique um domínio próprio (registros DNS indicados pela Resend).
2. Gere uma chave de API ("Sending access").
3. Cadastre os segredos no Worker:
   ```
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put EMAIL_REMETENTE   # ex.: Orçamento de Obras <nao-responda@seudominio.com.br>
   npx wrangler secret put APP_URL           # ex.: https://orca.yws.eng.br
   ```
Sem essas variáveis, nada é enviado: cada mensagem fica registrada em "Usuários e permissões → E-mails enviados pelo sistema" com o status "não enviado".

## Endereço próprio

O sistema atende em **https://orca.yws.eng.br** (zona `yws.eng.br` na Cloudflare; domínio registrado na
Locaweb, com os nameservers da Cloudflare). O domínio está em `wrangler.jsonc` (`routes`, `custom_domain`);
o endereço `orsaobra.orsaobra.workers.dev` continua ativo. Os registros do Resend (DKIM, SPF, DMARC) ficam
na zona da Cloudflare; o remetente é `Orçamento de Obras <orcamento@yws.eng.br>`.
