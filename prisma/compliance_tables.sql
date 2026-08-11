-- Apply with `npx prisma db push` (preferred - this repo has no migrations dir),
-- or run this SQL directly against the database.
-- These tables back the mandatory privacy webhooks and webhook replay protection.

CREATE TABLE IF NOT EXISTS "WebhookDelivery" (
  "id"          TEXT PRIMARY KEY,
  "webhookId"   TEXT NOT NULL UNIQUE,
  "topic"       TEXT,
  "shopDomain"  TEXT,
  "apiVersion"  TEXT,
  "triggeredAt" TIMESTAMP(3),
  "receivedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "WebhookDelivery_shopDomain_topic_idx" ON "WebhookDelivery"("shopDomain", "topic");
CREATE INDEX IF NOT EXISTS "WebhookDelivery_receivedAt_idx" ON "WebhookDelivery"("receivedAt");

CREATE TABLE IF NOT EXISTS "ComplianceRequest" (
  "id"                TEXT PRIMARY KEY,
  "shopDomain"        TEXT NOT NULL,
  "shopifyShopId"     TEXT,
  "topic"             TEXT NOT NULL,
  "webhookId"         TEXT,
  "customerId"        TEXT,
  "customerEmailHash" TEXT,
  "payloadJson"       TEXT NOT NULL,
  "assembledJson"     TEXT,
  "status"            TEXT NOT NULL DEFAULT 'PENDING',
  "receivedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt"        TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ComplianceRequest_shopDomain_topic_idx" ON "ComplianceRequest"("shopDomain", "topic");
