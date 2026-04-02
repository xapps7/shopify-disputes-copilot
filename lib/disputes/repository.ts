import { db } from "@/lib/db";
import { sampleDashboardDisputes, sampleDisputeDetail } from "@/lib/disputes/sample-data";
import type {
  AnalyticsSnapshotView,
  DashboardDispute,
  DisputeOptionView,
  DisputeDetailView,
  EvidenceLibraryItemView,
  OverviewMetricsView,
  PreventionRecommendationView
} from "@/lib/types";

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

export async function getOverviewMetrics(shopDomain?: string | null): Promise<OverviewMetricsView> {
  const disputes = await listDashboardDisputes(shopDomain);

  return {
    openDisputes: disputes.filter((dispute) =>
      ["NEEDS_RESPONSE", "UNDER_REVIEW", "WARNING_NEEDS_RESPONSE"].includes(dispute.status)
    ).length,
    dueSoon: disputes.filter((dispute) => {
      if (!dispute.evidenceDueBy) return false;
      const delta = Math.ceil((new Date(dispute.evidenceDueBy).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      return delta <= 2;
    }).length,
    totalAmount: disputes.reduce((sum, dispute) => sum + Number(dispute.amount), 0),
    evidenceReady: disputes.filter((dispute) => dispute.completenessScore >= 75).length
  };
}

export async function listEvidenceLibrary(shopDomain?: string | null): Promise<EvidenceLibraryItemView[]> {
  if (!shopDomain) {
    return sampleDisputeDetail.evidenceItems.map((item, index) => ({
      id: item.id,
      disputeId: sampleDisputeDetail.id,
      disputeReference: sampleDisputeDetail.shopifyDisputeId.split("/").pop() ?? "1001",
      title: item.title,
      category: item.category,
      sourceType: item.sourceType,
      description: item.description,
      fileUrl: item.fileUrl,
      createdAt: sampleDisputeDetail.timeline[index]?.eventTimestamp ?? new Date().toISOString()
    }));
  }

  const merchant = await db.merchant.findUnique({
    where: { shopDomain },
    include: {
      disputes: {
        include: {
          evidenceItems: {
            orderBy: { createdAt: "desc" }
          }
        }
      }
    }
  });

  if (!merchant) {
    return [];
  }

  return merchant.disputes.flatMap((dispute) =>
    dispute.evidenceItems.map((item) => ({
      id: item.id,
      disputeId: dispute.id,
      disputeReference: dispute.shopifyDisputeId.split("/").pop() ?? dispute.id,
      title: item.title,
      category: item.category,
      sourceType: item.sourceType,
      description: item.description ?? null,
      fileUrl: item.fileUrl ?? null,
      createdAt: item.createdAt.toISOString()
    }))
  );
}

export async function getAnalyticsSnapshot(shopDomain?: string | null): Promise<AnalyticsSnapshotView> {
  const disputes = await listDashboardDisputes(shopDomain);

  return {
    openCount: disputes.filter((item) => ["NEEDS_RESPONSE", "UNDER_REVIEW", "WARNING_NEEDS_RESPONSE"].includes(item.status)).length,
    wonCount: disputes.filter((item) => item.status === "WON").length,
    lostCount: disputes.filter((item) => item.status === "LOST").length,
    acceptedCount: disputes.filter((item) => item.status === "ACCEPTED").length,
    dueSoonCount: disputes.filter((item) => {
      if (!item.evidenceDueBy) return false;
      const delta = Math.ceil((new Date(item.evidenceDueBy).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      return delta <= 2;
    }).length,
    fraudCount: disputes.filter((item) => item.reason === "FRAUD").length,
    productNotReceivedCount: disputes.filter((item) => item.reason === "PRODUCT_NOT_RECEIVED").length,
    avgReadiness:
      disputes.length > 0
        ? Math.round(disputes.reduce((sum, dispute) => sum + dispute.completenessScore, 0) / disputes.length)
        : 0
  };
}

export async function listRecommendations(shopDomain?: string | null): Promise<PreventionRecommendationView[]> {
  if (!shopDomain) {
    return sampleDisputeDetail.recommendations;
  }

  const merchant = await db.merchant.findUnique({
    where: { shopDomain },
    include: {
      recommendations: {
        orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
        take: 24
      }
    }
  });

  if (!merchant) {
    return [];
  }

  return merchant.recommendations.map((item) => ({
    id: item.id,
    category: item.category,
    recommendationText: item.recommendationText,
    priority: item.priority,
    state: item.state
  }));
}

export async function listDisputeOptions(shopDomain?: string | null): Promise<DisputeOptionView[]> {
  const disputes = await listDashboardDisputes(shopDomain);

  return disputes.map((dispute) => ({
    id: dispute.id,
    label: `${dispute.shopifyDisputeId.split("/").pop()} · ${dispute.currencyCode ?? "USD"} ${dispute.amount}`
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
      },
      merchant: {
        include: {
          recommendations: {
            where: {
              disputeId: id
            },
            orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
            take: 6
          }
        }
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
    evidenceSentOn: dispute.evidenceSentOn?.toISOString() ?? null,
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
          summaryText: dispute.packets[0].summaryText ?? null,
          submittedAt: dispute.packets[0].submittedAt?.toISOString() ?? null
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
    })),
    recommendations: dispute.merchant.recommendations.map((item) => ({
      id: item.id,
      category: item.category,
      recommendationText: item.recommendationText,
      priority: item.priority,
      state: item.state
    }))
  };
}
