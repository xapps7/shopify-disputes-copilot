import { db } from "@/lib/db";
import { decideWebhookDelivery, type DeliveryDecision } from "@/lib/compliance/replay";

export type WebhookDeliveryMeta = {
  webhookId: string | null;
  topic: string | null;
  shopDomain: string | null;
  triggeredAt: string | null;
  apiVersion: string | null;
};

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "P2002"
  );
}

/**
 * Record a delivery and report whether we had already seen it.
 *
 * Uses the unique index on `WebhookDelivery.webhookId` as the dedupe primitive:
 * an INSERT that trips the constraint means a concurrent/earlier delivery of the
 * same webhook already claimed it. That is race-free in a way a
 * `findUnique`-then-`create` check is not.
 */
export async function recordWebhookDelivery(
  meta: WebhookDeliveryMeta
): Promise<{ alreadySeen: boolean; recorded: boolean }> {
  if (!meta.webhookId) {
    // Nothing to dedupe on. Process it rather than dropping a real event.
    return { alreadySeen: false, recorded: false };
  }

  const triggeredAtMs = meta.triggeredAt ? Date.parse(meta.triggeredAt) : Number.NaN;

  try {
    await db.webhookDelivery.create({
      data: {
        webhookId: meta.webhookId,
        topic: meta.topic,
        shopDomain: meta.shopDomain,
        apiVersion: meta.apiVersion,
        triggeredAt: Number.isNaN(triggeredAtMs) ? null : new Date(triggeredAtMs)
      }
    });

    return { alreadySeen: false, recorded: true };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { alreadySeen: true, recorded: false };
    }

    throw error;
  }
}

/**
 * Full guard: reject stale deliveries (>5 minutes old) and replays.
 *
 * Staleness is evaluated BEFORE the insert so a flood of replayed-but-stale
 * bodies cannot grow the delivery table.
 */
export async function guardWebhookDelivery(meta: WebhookDeliveryMeta): Promise<DeliveryDecision> {
  const staleness = decideWebhookDelivery({ alreadySeen: false, triggeredAt: meta.triggeredAt });

  if (!staleness.process) {
    return staleness;
  }

  const { alreadySeen } = await recordWebhookDelivery(meta);

  return decideWebhookDelivery({ alreadySeen, triggeredAt: meta.triggeredAt });
}
