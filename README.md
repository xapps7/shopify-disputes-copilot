# Shopify Disputes Co-Pilot

Shopify embedded app starter for a Shopify Payments dispute operations product.

## Current State

This repository is a starter implementation for v1. It includes:

- Next.js embedded app scaffold
- Prisma schema for merchants, disputes, evidence, and timeline events
- webhook route handlers for disputes and privacy compliance
- Shopify Admin GraphQL client helpers
- dispute sync and dashboard view models
- sample embedded UI for dashboard and dispute detail views

It does not yet include:

- production billing
- a running queue worker
- final App Bridge session-token wiring
- cloud object storage for uploads and packet drafts

## Quick Start

1. Copy `.env.example` to `.env.local`.
2. Install dependencies with `npm install`.
3. Generate Prisma client with `npm run prisma:generate`.
4. Push schema with `npm run db:push`.
5. Run the app with `npm run dev`.

Additional setup details are in [docs/SETUP.md](/Users/cedcoss/Documents/Shopify/Dispute%20and%20chargeback%20ops/docs/SETUP.md).

Deployment notes are in [docs/DEPLOYMENT.md](/Users/cedcoss/Documents/Shopify/Dispute%20and%20chargeback%20ops/docs/DEPLOYMENT.md).
