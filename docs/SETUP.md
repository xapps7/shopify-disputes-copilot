# Setup

## Prerequisites

- Node.js 22+
- Neon Postgres or PostgreSQL 15+
- Shopify Partner account
- development store with Shopify Payments enabled or suitable test access
- stable HTTPS app URL for embedded app callbacks

## Environment

Create `.env.local` from `.env.example` and provide:

- `DATABASE_URL`
- `DIRECT_URL`
- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SHOPIFY_APP_URL`
- `SHOPIFY_SCOPES`
- `SHOPIFY_WEBHOOK_SECRET`
- `ENCRYPTION_KEY`

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

- verify the OAuth redirect URI in the Partner Dashboard matches `/api/auth/callback`
- wire App Bridge session tokens to server-side API routes
- move dispute sync and packet generation to async jobs
- move local file storage to S3-compatible object storage
