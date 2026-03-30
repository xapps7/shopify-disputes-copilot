# Setup

## Prerequisites

- Node.js 22+
- Neon Postgres or PostgreSQL 15+
- Shopify Partner account
- Shopify CLI for app configuration deploys
- development store with Shopify Payments enabled or suitable test access
- stable HTTPS app URL for embedded app callbacks

## Environment

Create `.env.local` from `.env.example` and provide:

- `DATABASE_URL`
- `DIRECT_URL`
- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SHOPIFY_APP_URL`
- `SHOPIFY_APP_HANDLE`
- `SHOPIFY_SCOPES`
- `SHOPIFY_WEBHOOK_SECRET`
- `ENCRYPTION_KEY`

## Shopify App Config

This project now includes [shopify.app.toml](/Users/cedcoss/Documents/Shopify/Dispute%20and%20chargeback%20ops/shopify.app.toml) as the source of truth for:

- embedded app metadata
- application URL
- callback URL
- access scopes
- privacy webhooks

Changes to that file do not affect Shopify until you deploy the app configuration with Shopify CLI.

Recommended flow:

```bash
shopify app config link
shopify app deploy
```

For the current codebase, `use_legacy_install_flow` remains enabled because install/auth still uses manual OAuth routes. A later auth reset should migrate this app to managed install + token exchange.

## Run Locally

```bash
npm install
npm run prisma:generate
npm run db:push
npm run dev
```

For Neon:

- `DATABASE_URL` should be the pooled connection string for runtime
- `DIRECT_URL` should be the non-pooled connection string for Prisma schema operations

## Next Build Steps

- deploy `shopify.app.toml` so Shopify app-home metadata stops relying on stale dashboard state
- wire App Bridge session tokens to server-side API routes
- move dispute sync and packet generation to async jobs
- move local file storage to S3-compatible object storage
