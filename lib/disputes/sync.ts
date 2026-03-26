import { DisputeStatus } from "@prisma/client";

import { db } from "@/lib/db";

export type DisputeWebhookPayload = {
  admin_graphql_api_id?: string;
  amount?: string;
  currency?: string;
  dispute_id?: number | string;
  order_id?: number | string;
  reason?: string;
  reason_details?: string;
  status?: string;
  evidence_due_by?: string;
  evidence_sent_on?: string;
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

  const shopifyDisputeId =
    payload.admin_graphql_api_id ??
    `gid://shopify/ShopifyPaymentsDispute/${payload.dispute_id ?? "unknown"}`;

  const dispute = await db.dispute.upsert({
    where: { shopifyDisputeId },
    update: {
      merchantId: merchant.id,
      shopifyOrderId: payload.order_id ? `gid://shopify/Order/${payload.order_id}` : undefined,
      status: mapStatus(payload.status),
      reason: payload.reason,
      reasonDetails: payload.reason_details,
      amount: payload.amount,
      currencyCode: payload.currency,
      evidenceDueBy: payload.evidence_due_by ? new Date(payload.evidence_due_by) : undefined,
      evidenceSentOn: payload.evidence_sent_on ? new Date(payload.evidence_sent_on) : undefined,
      sourceSnapshotJson: JSON.stringify(payload)
    },
    create: {
      merchantId: merchant.id,
      shopifyDisputeId,
      shopifyOrderId: payload.order_id ? `gid://shopify/Order/${payload.order_id}` : undefined,
      status: mapStatus(payload.status),
      reason: payload.reason,
      reasonDetails: payload.reason_details,
      amount: payload.amount,
      currencyCode: payload.currency,
      evidenceDueBy: payload.evidence_due_by ? new Date(payload.evidence_due_by) : undefined,
      evidenceSentOn: payload.evidence_sent_on ? new Date(payload.evidence_sent_on) : undefined,
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

  return dispute;
}
