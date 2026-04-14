import { db } from "@/lib/db";
import {
  getSampleDisputeDetail,
  sampleDashboardDisputes,
  sampleDisputeDetail,
  sampleDisputeDetails
} from "@/lib/disputes/sample-data";
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
          {
            label: "Delivery confirmation",
            category: "DELIVERY_CONFIRMATION",
            whyItMatters:
              "Delivery proof helps show that the shipment reached the destination tied to the transaction.",
            howToGet:
              "Pull the carrier delivery scan, proof-of-delivery page, or Shopify fulfillment tracking details for the exact shipment.",
            bestSource: "Carrier tracking page or Shopify fulfillment timeline",
            appSupport: "The app can convert shipment data and uploads into packet-ready delivery evidence."
          },
          {
            label: "Shipping documentation",
            category: "SHIPPING_DOCUMENTATION",
            whyItMatters:
              "Shipment records verify when the order was fulfilled and which address was used for the shipment.",
            howToGet:
              "Export the carrier label, manifest, or fulfillment confirmation showing the recipient address and ship date.",
            bestSource: "Shipping label PDF, carrier receipt, or fulfillment export",
            appSupport: "The app can organize carrier records and explain how they support the reply."
          },
          {
            label: "Customer communication",
            category: "CUSTOMER_COMMUNICATION",
            whyItMatters:
              "Customer messages can show purchase recognition, delivery follow-up, or prior engagement after the order.",
            howToGet:
              "Collect support tickets, order emails, chat transcripts, or delivery follow-up messages connected to the same customer.",
            bestSource: "Helpdesk thread, order confirmation email, or chat transcript",
            appSupport: "The app can summarize the thread and place the strongest excerpts into the packet narrative."
          }
        ]
      : reason === "PRODUCT_NOT_RECEIVED"
        ? [
            {
              label: "Delivery confirmation",
              category: "DELIVERY_CONFIRMATION",
              whyItMatters:
                "Delivery confirmation is the strongest proof that the shipment was completed successfully.",
              howToGet:
                "Download the proof-of-delivery scan or tracking event showing delivered status and timestamp.",
              bestSource: "Carrier proof-of-delivery page",
              appSupport: "The app can surface the delivery proof as the lead evidence in the packet."
            },
            {
              label: "Shipping documentation",
              category: "SHIPPING_DOCUMENTATION",
              whyItMatters:
                "Shipment records establish when the parcel moved through the carrier network and where it was addressed.",
              howToGet:
                "Gather the label, tracking history, and any carrier exception or final-mile notes for the shipment.",
              bestSource: "Carrier tracking history and shipping label",
              appSupport: "The app can combine the tracking sequence with the merchant narrative."
            }
          ]
        : [
            {
              label: "Product proof",
              category: "PRODUCT_PROOF",
              whyItMatters:
                "Product proof shows what was sold and how the item matched the seller's listing or policy disclosure.",
              howToGet:
                "Export the product page, order line item, and any policy or listing screenshot tied to the order.",
              bestSource: "Product admin, storefront capture, or order snapshot",
              appSupport: "The app can turn order and catalog data into packet-ready factual summaries."
            },
            {
              label: "Customer communication",
              category: "CUSTOMER_COMMUNICATION",
              whyItMatters:
                "Customer messages help show expectations, acknowledgement, and merchant support handling.",
              howToGet:
                "Collect support emails, chat threads, and any message where the customer discussed the order or requested help.",
              bestSource: "Helpdesk thread or email conversation",
              appSupport: "The app can summarize the communication and highlight the strongest supporting points."
            }
          ];

  return required.map((item) => ({
    ...item,
    state: (categories.has(item.category) ? "ready" : "missing") as "ready" | "missing"
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
    return [];
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
    return sampleDisputeDetails.flatMap((detail) =>
      detail.evidenceItems.map((item, index) => ({
        id: item.id,
        disputeId: detail.id,
        disputeReference: detail.shopifyDisputeId.split("/").pop() ?? detail.id,
        title: item.title,
        category: item.category,
        sourceType: item.sourceType,
        description: item.description,
        fileUrl: item.fileUrl,
        createdAt: detail.timeline[index]?.eventTimestamp ?? new Date().toISOString()
      }))
    );
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
    return sampleDisputeDetails.flatMap((item) => item.recommendations);
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
    if (!id.startsWith("local-")) {
      throw new Error("Dispute not found.");
    }
    return getSampleDisputeDetail(id);
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
