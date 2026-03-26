# Deployment

## Local Development

1. Create `.env.local` from `.env.example`.
2. Point `DATABASE_URL` to Neon.
3. Run:

```bash
npm install
npm run prisma:generate
npm run db:push
npm run dev
```

## Git Preparation

This project is safe to place in Git once you exclude:

- `.env`
- `.env.local`
- `.next`
- `node_modules`
- generated local evidence files in `public/uploads`
- generated packet drafts in `public/packets`

## App Runner Preparation

Required environment variables for App Runner:

- `DATABASE_URL`
- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SHOPIFY_APP_URL`
- `SHOPIFY_SCOPES`
- `SHOPIFY_WEBHOOK_SECRET`
- `ENCRYPTION_KEY`

Recommended deployment flow:

1. Push repository to GitHub.
2. Create App Runner service from source repository or container build.
3. Attach the environment variables above.
4. Set health check path to `/api/health`.
5. Point Shopify app URLs to the App Runner service URL.
6. Re-run OAuth install and webhook verification on the dev store.

## Neon Notes

- Use the pooled connection string for app traffic if desired.
- Use the direct connection string for schema changes if Neon provides both.
- Run `npm run db:push` or migrations against Neon before first app start.

## Important Limitation

Local file uploads and packet drafts currently write to disk:

- `public/uploads`
- `public/packets`

Before production, move those to S3 or another persistent object store. App Runner local disk is not a durable storage system.
