import { db } from "@/lib/db";
import { sampleDashboardDisputes, sampleDisputeDetail } from "@/lib/disputes/sample-data";
import type { DashboardDispute, DisputeDetailView } from "@/lib/types";

function buildChecklist(reason: string | null, categories: Set<string>) {
  const required =
    reason === "FRAUD"
      ? [
          ["Delivery confirmation", "DELIVERY_CONFIRMATION"],
          ["Shipping documentation", "SHIPPING_DOCUMENTATION"],
          ["Customer communication", "CUSTOMER_COMMUNICATION"]
        ]
      : reason === "PRODUCT_NOT_RECEIVED"
        ? [
            ["Delivery confirmation", "DELIVERY_CONFIRMATION"],
            ["Shipping documentation", "SHIPPING_DOCUMENTATION"]
          ]
        : [
            ["Product proof", "PRODUCT_PROOF"],
            ["Customer communication", "CUSTOMER_COMMUNICATION"]
          ];

  return required.map(([label, category]) => ({
    label,
    state: (categories.has(category) ? "ready" : "missing") as "ready" | "missing"
  }));
}

export async function listDashboardDisputes(shopDomain?: string | null): Promise<DashboardDispute[]> {
  if (!shopDomain) {
    return sampleDashboardDisputes;
  }

  const merchant = await db.merchant.findUnique({
    where: { shopDomain },
    include: {
      disputes: {
        orderBy: [{ evidenceDueBy: "asc" }, { createdAt: "desc" }],
        include: {
          evidenceItems: true
        },
        take: 25
      }
    }
  });

  if (!merchant) {
    return sampleDashboardDisputes;
  }

  return merchant.disputes.map((dispute) => ({
    id: dispute.id,
    shopifyDisputeId: dispute.shopifyDisputeId,
    shopifyOrderId: dispute.shopifyOrderId ?? null,
    status: dispute.status,
    reason: dispute.reason ?? null,
    amount: dispute.amount?.toString() ?? "0.00",
    currencyCode: dispute.currencyCode ?? null,
    evidenceDueBy: dispute.evidenceDueBy?.toISOString() ?? null,
    completenessScore: Math.min(100, dispute.evidenceItems.length * 25)
  }));
}

export async function getDisputeDetail(id: string): Promise<DisputeDetailView> {
  const dispute = await db.dispute.findUnique({
    where: { id },
    include: {
      evidenceItems: {
        orderBy: { createdAt: "asc" }
      },
      timelineEvents: {
        orderBy: { eventTimestamp: "asc" }
      },
      packets: {
        orderBy: { version: "desc" },
        take: 1
      }
    }
  });

  if (!dispute) {
    return sampleDisputeDetail;
  }

  const orderSnapshot = dispute.shopifyOrderId
    ? await db.orderSnapshot.findUnique({
        where: { shopifyOrderId: dispute.shopifyOrderId }
      })
    : null;
  const evidenceCategories = new Set(dispute.evidenceItems.map((item) => item.category));

  return {
    id: dispute.id,
    shopifyDisputeId: dispute.shopifyDisputeId,
    status: dispute.status,
    reason: dispute.reason ?? null,
    reasonDetails: dispute.reasonDetails ?? null,
    amount: dispute.amount?.toString() ?? "0.00",
    currencyCode: dispute.currencyCode ?? null,
    evidenceDueBy: dispute.evidenceDueBy?.toISOString() ?? null,
    orderSummary: orderSnapshot
      ? {
          orderName: orderSnapshot.orderName ?? null,
          customerName: orderSnapshot.customerName ?? null,
          customerEmail: orderSnapshot.customerEmail ?? null,
          fulfillmentStatus: orderSnapshot.fulfillmentStatus ?? null
        }
      : null,
    evidenceChecklist: buildChecklist(dispute.reason ?? null, evidenceCategories),
    latestPacket: dispute.packets[0]
      ? {
          version: dispute.packets[0].version,
          status: dispute.packets[0].status,
          generatedAt: dispute.packets[0].generatedAt?.toISOString() ?? null,
          pdfUrl: dispute.packets[0].pdfUrl ?? null,
          summaryText: dispute.packets[0].summaryText ?? null
        }
      : null,
    evidenceItems: dispute.evidenceItems.map((item) => ({
      id: item.id,
      category: item.category,
      title: item.title,
      description: item.description ?? null,
      sourceType: item.sourceType,
      fileUrl: item.fileUrl ?? null
    })),
    timeline: dispute.timelineEvents.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      eventTimestamp: event.eventTimestamp.toISOString(),
      source: event.source
    }))
  };
}
