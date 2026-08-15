-- Complete schema catch-up. Prefer `npx prisma db push`; this exists so the
-- state can be reached by hand if the CLI is unavailable.
--
-- The earlier compliance_tables.sql was INCOMPLETE - it created two tables and
-- none of the columns, which left the app in a half-migrated state where every
-- page hit the error boundary. This file is the whole set.

-- Columns -------------------------------------------------------------------
ALTER TABLE "Dispute"      ADD COLUMN IF NOT EXISTS "evidenceFieldsJson"    TEXT;
ALTER TABLE "EvidenceItem" ADD COLUMN IF NOT EXISTS "fileSizeBytes"         INTEGER;
ALTER TABLE "Merchant"     ADD COLUMN IF NOT EXISTS "accessTokenExpiresAt"  TIMESTAMP(3);
ALTER TABLE "Merchant"     ADD COLUMN IF NOT EXISTS "refreshTokenEncrypted" TEXT;
ALTER TABLE "Merchant"     ADD COLUMN IF NOT EXISTS "refreshTokenExpiresAt" TIMESTAMP(3);

-- Tables --------------------------------------------------------------------
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

CREATE TABLE IF NOT EXISTS "DisputeAlert" (
  "id"             TEXT PRIMARY KEY,
  "merchantId"     TEXT NOT NULL,
  "disputeId"      TEXT NOT NULL,
  "kind"           TEXT NOT NULL,
  "thresholdHours" INTEGER,
  "title"          TEXT NOT NULL,
  "body"           TEXT NOT NULL,
  "readAt"         TIMESTAMP(3),
  "deliveredAt"    TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "DisputeAlert_disputeId_kind_thresholdHours_key"
  ON "DisputeAlert"("disputeId", "kind", "thresholdHours");
CREATE INDEX IF NOT EXISTS "DisputeAlert_merchantId_readAt_idx"    ON "DisputeAlert"("merchantId", "readAt");
CREATE INDEX IF NOT EXISTS "DisputeAlert_merchantId_createdAt_idx" ON "DisputeAlert"("merchantId", "createdAt");
