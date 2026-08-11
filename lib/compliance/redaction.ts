import { db } from "@/lib/db";
import { orderIdCandidates, scrubJsonString } from "@/lib/compliance/scrub";

/* ------------------------------------------------------------------ *
 * shop/redact
 * ------------------------------------------------------------------ */

export type ShopRedactionResult = {
  found: boolean;
  merchantId: string | null;
  deleted: {
    disputes: number;
    orderSnapshots: number;
    evidenceItems: number;
    evidencePackets: number;
    timelineEvents: number;
    recommendations: number;
    syncRuns: number;
  };
  /**
   * Stored objects that belong to the erased disputes.
   *
   * `lib/storage.ts` exposes only `persistUploadedFile` / `persistPacketDraft` -
   * there is NO delete helper, and that file is outside this change's ownership.
   * The URLs are therefore recorded on the ComplianceRequest row so the bytes can
   * be swept (and the sweep can be evidenced) once a `deleteStoredFile` helper is
   * added to lib/storage.ts.
   */
  filesPendingDeletion: string[];
};

export async function redactShop(shopDomain: string): Promise<ShopRedactionResult> {
  const merchant = await db.merchant.findUnique({
    where: { shopDomain },
    select: {
      id: true,
      _count: { select: { orderSnapshots: true, recommendations: true, syncRuns: true } },
      disputes: {
        select: {
          id: true,
          _count: { select: { timelineEvents: true } },
          evidenceItems: { select: { fileUrl: true } },
          packets: { select: { pdfUrl: true } }
        }
      }
    }
  });

  if (!merchant) {
    // Already gone (or never installed). shop/redact must still succeed - Shopify
    // retries any non-2xx and an absent shop is the desired end state anyway.
    return {
      found: false,
      merchantId: null,
      deleted: {
        disputes: 0,
        orderSnapshots: 0,
        evidenceItems: 0,
        evidencePackets: 0,
        timelineEvents: 0,
        recommendations: 0,
        syncRuns: 0
      },
      filesPendingDeletion: []
    };
  }

  const filesPendingDeletion = new Set<string>();
  let evidenceItems = 0;
  let evidencePackets = 0;
  let timelineEvents = 0;

  for (const dispute of merchant.disputes) {
    timelineEvents += dispute._count.timelineEvents;
    evidenceItems += dispute.evidenceItems.length;
    evidencePackets += dispute.packets.length;

    for (const item of dispute.evidenceItems) {
      if (item.fileUrl) {
        filesPendingDeletion.add(item.fileUrl);
      }
    }

    for (const packet of dispute.packets) {
      if (packet.pdfUrl) {
        filesPendingDeletion.add(packet.pdfUrl);
      }
    }
  }

  // Every child relation declares `onDelete: Cascade` against Merchant (and
  // Dispute), so one delete removes Dispute, DisputeTimelineEvent, EvidenceItem,
  // EvidencePacket, OrderSnapshot, PreventionRecommendation and SyncRun.
  await db.merchant.delete({ where: { id: merchant.id } });

  return {
    found: true,
    merchantId: merchant.id,
    deleted: {
      disputes: merchant.disputes.length,
      orderSnapshots: merchant._count.orderSnapshots,
      evidenceItems,
      evidencePackets,
      timelineEvents,
      recommendations: merchant._count.recommendations,
      syncRuns: merchant._count.syncRuns
    },
    filesPendingDeletion: [...filesPendingDeletion]
  };
}

/* ------------------------------------------------------------------ *
 * customers/redact
 * ------------------------------------------------------------------ */

export type CustomerRedactionResult = {
  found: boolean;
  matchedOrderIds: string[];
  orderSnapshotsRedacted: number;
  disputesScrubbed: number;
  evidenceItemsScrubbed: number;
  matchedBy: "orders_to_redact" | "customer_email" | "none";
};

export async function redactCustomer(args: {
  shopDomain: string;
  ordersToRedact: Array<number | string> | null | undefined;
  customerEmail: string | null | undefined;
}): Promise<CustomerRedactionResult> {
  const empty: CustomerRedactionResult = {
    found: false,
    matchedOrderIds: [],
    orderSnapshotsRedacted: 0,
    disputesScrubbed: 0,
    evidenceItemsScrubbed: 0,
    matchedBy: "none"
  };

  const merchant = await db.merchant.findUnique({
    where: { shopDomain: args.shopDomain },
    select: { id: true }
  });

  if (!merchant) {
    return empty;
  }

  const candidates = orderIdCandidates(args.ordersToRedact);
  let matchedBy: CustomerRedactionResult["matchedBy"] = "none";

  let snapshots = candidates.length
    ? await db.orderSnapshot.findMany({
        where: { merchantId: merchant.id, shopifyOrderId: { in: candidates } },
        select: { id: true, shopifyOrderId: true, orderJson: true }
      })
    : [];

  if (snapshots.length > 0) {
    matchedBy = "orders_to_redact";
  }

  // Shopify may send an empty `orders_to_redact` (customer with no orders in the
  // 6-month window). Fall back to the email so we still erase what we hold.
  if (snapshots.length === 0 && args.customerEmail) {
    snapshots = await db.orderSnapshot.findMany({
      where: {
        merchantId: merchant.id,
        customerEmail: { equals: args.customerEmail, mode: "insensitive" }
      },
      select: { id: true, shopifyOrderId: true, orderJson: true }
    });

    if (snapshots.length > 0) {
      matchedBy = "customer_email";
    }
  }

  if (snapshots.length === 0) {
    return { ...empty, found: true };
  }

  const matchedOrderIds = snapshots.map((snapshot) => snapshot.shopifyOrderId);

  // Null the denormalised columns AND rewrite the raw blob. Columns alone are not
  // enough: lib/disputes/repository.ts explicitly falls back to reading the
  // customer name/email back out of orderJson when the columns are empty.
  for (const snapshot of snapshots) {
    await db.orderSnapshot.update({
      where: { id: snapshot.id },
      data: {
        customerEmail: null,
        customerName: null,
        orderJson: scrubJsonString(snapshot.orderJson) ?? "{}"
      }
    });
  }

  const disputes = await db.dispute.findMany({
    where: { merchantId: merchant.id, shopifyOrderId: { in: matchedOrderIds } },
    select: { id: true, sourceSnapshotJson: true }
  });

  for (const dispute of disputes) {
    if (!dispute.sourceSnapshotJson) {
      continue;
    }

    await db.dispute.update({
      where: { id: dispute.id },
      data: { sourceSnapshotJson: scrubJsonString(dispute.sourceSnapshotJson) }
    });
  }

  // Evidence rows derived from those orders embed the same customer fields in
  // structuredValueJson. The scrubber only nulls customer-identifying keys, so
  // shipping/tracking evidence survives intact.
  let evidenceItemsScrubbed = 0;

  if (disputes.length > 0) {
    const evidenceItems = await db.evidenceItem.findMany({
      where: {
        disputeId: { in: disputes.map((dispute) => dispute.id) },
        NOT: { structuredValueJson: null }
      },
      select: { id: true, structuredValueJson: true }
    });

    for (const item of evidenceItems) {
      await db.evidenceItem.update({
        where: { id: item.id },
        data: { structuredValueJson: scrubJsonString(item.structuredValueJson) }
      });
      evidenceItemsScrubbed += 1;
    }
  }

  return {
    found: true,
    matchedOrderIds,
    orderSnapshotsRedacted: snapshots.length,
    disputesScrubbed: disputes.filter((dispute) => dispute.sourceSnapshotJson).length,
    evidenceItemsScrubbed,
    matchedBy
  };
}

/* ------------------------------------------------------------------ *
 * customers/data_request
 * ------------------------------------------------------------------ */

export type AssembledCustomerData = {
  shopDomain: string;
  customerId: string | null;
  requestedOrderIds: string[];
  matchedOrderIds: string[];
  orders: unknown[];
  disputes: unknown[];
  note: string;
};

export async function assembleCustomerData(args: {
  shopDomain: string;
  customerId: string | null;
  ordersRequested: Array<number | string> | null | undefined;
  customerEmail: string | null | undefined;
}): Promise<AssembledCustomerData> {
  const candidates = orderIdCandidates(args.ordersRequested);

  const base: AssembledCustomerData = {
    shopDomain: args.shopDomain,
    customerId: args.customerId,
    requestedOrderIds: candidates,
    matchedOrderIds: [],
    orders: [],
    disputes: [],
    note:
      "Disputes Co-Pilot stores order snapshots and chargeback evidence only for orders that have an associated payment dispute."
  };

  const merchant = await db.merchant.findUnique({
    where: { shopDomain: args.shopDomain },
    select: { id: true }
  });

  if (!merchant) {
    return base;
  }

  const where = candidates.length
    ? { merchantId: merchant.id, shopifyOrderId: { in: candidates } }
    : args.customerEmail
      ? {
          merchantId: merchant.id,
          customerEmail: { equals: args.customerEmail, mode: "insensitive" as const }
        }
      : null;

  if (!where) {
    return base;
  }

  const snapshots = await db.orderSnapshot.findMany({ where });

  if (snapshots.length === 0) {
    return base;
  }

  const matchedOrderIds = snapshots.map((snapshot) => snapshot.shopifyOrderId);

  const disputes = await db.dispute.findMany({
    where: { merchantId: merchant.id, shopifyOrderId: { in: matchedOrderIds } },
    include: {
      evidenceItems: true,
      packets: true,
      timelineEvents: true
    }
  });

  return {
    ...base,
    matchedOrderIds,
    orders: snapshots.map((snapshot) => ({
      shopifyOrderId: snapshot.shopifyOrderId,
      orderName: snapshot.orderName,
      customerEmail: snapshot.customerEmail,
      customerName: snapshot.customerName,
      orderTotal: snapshot.orderTotal?.toString() ?? null,
      currencyCode: snapshot.currencyCode,
      fulfillmentStatus: snapshot.fulfillmentStatus,
      riskLevel: snapshot.riskLevel,
      orderJson: snapshot.orderJson,
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt
    })),
    disputes: disputes.map((dispute) => ({
      shopifyDisputeId: dispute.shopifyDisputeId,
      shopifyOrderId: dispute.shopifyOrderId,
      status: dispute.status,
      disputeType: dispute.disputeType,
      reason: dispute.reason,
      reasonDetails: dispute.reasonDetails,
      amount: dispute.amount?.toString() ?? null,
      currencyCode: dispute.currencyCode,
      evidenceDueBy: dispute.evidenceDueBy,
      evidenceSentOn: dispute.evidenceSentOn,
      initiatedAt: dispute.initiatedAt,
      finalizedOn: dispute.finalizedOn,
      sourceSnapshotJson: dispute.sourceSnapshotJson,
      evidenceItems: dispute.evidenceItems,
      packets: dispute.packets,
      timelineEvents: dispute.timelineEvents
    }))
  };
}
