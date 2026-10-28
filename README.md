# Nexus WhatsApp Agent

Agente de atendimento da Nexus Soluções Digitais usando:

- WhatsApp Business Platform / Cloud API (Meta)
- Cloudflare Workers
- OpenAI Responses API
- GitHub → Cloudflare Workers Builds para deploy automático

## O que já está pronto

- `GET /` — health check
- `GET /webhook` — validação do webhook da Meta
- `POST /webhook` — recebimento de eventos
- validação opcional de `X-Hub-Signature-256` com `META_APP_SECRET`
- leitura de mensagens de texto recebidas
- geração de resposta por IA
- envio da resposta pelo endpoint oficial `/{Phone-Number-ID}/messages`
- confirmação imediata do webhook (`200`) e processamento assíncrono com `waitUntil`
- marcação da mensagem como lida
- prompt comercial da Nexus versionado em `src/prompt.js`

## 1. Criar o repositório

Este projeto está versionado no repositório `MatheusMendesFranco/nexuswhatsapp`, branch `main`.

## 2. Conectar na Cloudflare

No painel Cloudflare:

1. **Workers & Pages**
2. **Create application / Import a repository**
3. Escolha `nexuswhatsapp`
4. Branch de produção: `main`
5. Deploy command: `npx wrangler deploy`
6. Build command: pode ficar vazio

O projeto já contém `wrangler.jsonc`, que é a configuração fonte do Worker.

## 3. Secrets necessários

No Worker, abra **Settings → Variables and Secrets** e cadastre como **Secret**:

- `VERIFY_TOKEN` — uma senha aleatória criada por você; será copiada também para o campo “Verificar token” da Meta
- `META_ACCESS_TOKEN` — token da WhatsApp Cloud API
- `META_PHONE_NUMBER_ID` — ID do número exibido no painel do WhatsApp Cloud API
- `META_APP_SECRET` — App Secret do app Meta (recomendado para validar a assinatura dos POSTs)
- `OPENAI_API_KEY` — chave da OpenAI API

Nunca coloque esses valores no GitHub.

Variáveis não secretas já configuradas em `wrangler.jsonc`:

- `META_GRAPH_VERSION=v26.0`
- `OPENAI_MODEL=gpt-6-luna`

## 4. Configurar o webhook na Meta

Depois do deploy, a Cloudflare fornecerá uma URL parecida com:

`https://nexus-whatsapp-agent.<subdominio>.workers.dev`

Na tela da Meta use:

**URL de callback**

`https://nexus-whatsapp-agent.<subdominio>.workers.dev/webhook`

**Verificar token**

O mesmo valor salvo no secret `VERIFY_TOKEN`.

Clique em **Verificar e salvar**.

Depois assine o campo de webhook:

`messages`

E confirme que o app está inscrito na WABA correspondente.

## 5. Desenvolvimento local

Requisitos: Node.js e npm.

```bash
npm install
cp .dev.vars.example .dev.vars
npm run dev
```

Preencha `.dev.vars` apenas localmente. O arquivo é ignorado pelo Git.

## 6. Deploy manual opcional

```bash
npm install
npx wrangler login
npm run deploy
```

Quando o repositório estiver conectado ao Workers Builds, pushes em `main` podem fazer o deploy automaticamente.

## Segurança

- Não commitar tokens, chaves ou App Secret.
- Em produção, mantenha `META_APP_SECRET` configurado para rejeitar POSTs que não tenham assinatura Meta válida.
- Troque imediatamente qualquer secret que tenha sido exposto em print, chat, commit ou log.

## Escopo atual

Esta primeira versão é propositalmente pequena. Ela não mantém histórico persistente por lead e não faz deduplicação durável de eventos. Antes de expandir a operação, o próximo passo recomendado é adicionar persistência (por exemplo D1) para histórico, idempotência e integração com o CRM.
