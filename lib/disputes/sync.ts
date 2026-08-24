import { DisputeStatus } from "@prisma/client";

import { db } from "@/lib/db";
import { syncDerivedDisputeState } from "@/lib/disputes/auto-sync";

export type DisputeWebhookPayload = {
  admin_graphql_api_id?: string;
  /** The real disputes/create + disputes/update payload uses `id`. */
  id?: number | string;
  amount?: string;
  currency?: string;
  /** Not sent by Shopify - kept only for backwards compatibility. */
  dispute_id?: number | string;
  order_id?: number | string;
  reason?: string;
  network_reason_code?: string;
  reason_details?: string;
  status?: string;
  type?: string;
  evidence_due_by?: string;
  evidence_sent_on?: string;
  initiated_at?: string;
  finalized_on?: string;
};

function mapStatus(status?: string): DisputeStatus {
  switch (status?.toUpperCase()) {
    case "NEEDS_RESPONSE":
      return "NEEDS_RESPONSE";
    case "UNDER_REVIEW":
      return "UNDER_REVIEW";
    case "WON":
      return "WON";
    case "LOST":
      return "LOST";
    case "ACCEPTED":
      return "ACCEPTED";
    case "CHARGE_REFUNDED":
      return "CHARGE_REFUNDED";
    case "WARNING_NEEDS_RESPONSE":
      return "WARNING_NEEDS_RESPONSE";
    default:
      return "UNKNOWN";
  }
}

export async function upsertDisputeFromWebhook(shopDomain: string, payload: DisputeWebhookPayload) {
  const merchant = await db.merchant.upsert({
    where: { shopDomain },
    update: {},
    create: { shopDomain }
  });

  // Shopify sends `id`. The previous code read `dispute_id`, which does not
  // exist, so EVERY webhook from EVERY shop collapsed onto the single row
  // `gid://shopify/ShopifyPaymentsDispute/unknown` and reassigned its merchant.
  const numericDisputeId = payload.id ?? payload.dispute_id;

  if (!payload.admin_graphql_api_id && !numericDisputeId) {
    throw new Error("Dispute webhook payload has no dispute id; refusing to write.");
  }

  const shopifyDisputeId =
    payload.admin_graphql_api_id ?? `gid://shopify/ShopifyPaymentsDispute/${numericDisputeId}`;

  const previousDispute = await db.dispute.findUnique({
    where: { shopifyDisputeId },
    select: {
      id: true,
      status: true,
      evidenceSentOn: true
    }
  });

  // On UPDATE the merchant is deliberately not set.
  //
  // `merchant` here is resolved from `X-Shopify-Shop-Domain`, which sits OUTSIDE
  // the HMAC - Shopify signs the body only. Reassigning `merchantId` from an
  // unsigned header means a replayed body with a swapped header could move an
  // existing dispute to another shop. The replay guard and the uniqueness of
  // dispute GIDs make that hard to reach, but an existing row already knows
  // which merchant it belongs to, so there is nothing to gain by rewriting it
  // and one whole class of tenancy bug to lose.
  //
  // On CREATE there is no prior owner, so the header is all we have - and a
  // create is exactly the case where the shop domain being wrong just produces
  // a dispute nobody can see, not a stolen one.
  const dispute = await db.dispute.upsert({
    where: { shopifyDisputeId },
    update: {
      shopifyOrderId: payload.order_id ? `gid://shopify/Order/${payload.order_id}` : undefined,
      status: mapStatus(payload.status),
      reason: payload.reason,
      reasonDetails: payload.network_reason_code ?? payload.reason_details,
      amount: payload.amount,
      currencyCode: payload.currency,
      evidenceDueBy: payload.evidence_due_by ? new Date(payload.evidence_due_by) : undefined,
      evidenceSentOn: payload.evidence_sent_on ? new Date(payload.evidence_sent_on) : undefined,
      // The payload has carried `initiated_at` all along and this path never
      // stored it, so a dispute that arrived by webhook had no dispute date.
      // Everything that measures an age from it - the CE 3.0 120-365 day
      // window, the timeline - was working from nothing.
      initiatedAt: payload.initiated_at ? new Date(payload.initiated_at) : undefined,
      sourceSnapshotJson: JSON.stringify(payload)
    },
    create: {
      merchantId: merchant.id,
      shopifyDisputeId,
      shopifyOrderId: payload.order_id ? `gid://shopify/Order/${payload.order_id}` : undefined,
      status: mapStatus(payload.status),
      reason: payload.reason,
      reasonDetails: payload.network_reason_code ?? payload.reason_details,
      amount: payload.amount,
      currencyCode: payload.currency,
      evidenceDueBy: payload.evidence_due_by ? new Date(payload.evidence_due_by) : undefined,
      evidenceSentOn: payload.evidence_sent_on ? new Date(payload.evidence_sent_on) : undefined,
      // The payload has carried `initiated_at` all along and this path never
      // stored it, so a dispute that arrived by webhook had no dispute date.
      // Everything that measures an age from it - the CE 3.0 120-365 day
      // window, the timeline - was working from nothing.
      initiatedAt: payload.initiated_at ? new Date(payload.initiated_at) : undefined,
      sourceSnapshotJson: JSON.stringify(payload)
    }
  });

  await db.disputeTimelineEvent.create({
    data: {
      disputeId: dispute.id,
      eventType: "WEBHOOK_SYNCED",
      eventTimestamp: new Date(),
      source: "shopify_webhook",
      payloadSummaryJson: JSON.stringify({
        status: payload.status,
        reason: payload.reason
      })
    }
  });

  await syncDerivedDisputeState({
    disputeId: dispute.id,
    merchantId: merchant.id,
    currentStatus: dispute.status,
    previousStatus: previousDispute?.status ?? null,
    evidenceSentOn: dispute.evidenceSentOn,
    previousEvidenceSentOn: previousDispute?.evidenceSentOn ?? null,
    source: "shopify_webhook"
  });

  return dispute;
}
