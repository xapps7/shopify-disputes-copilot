import type { DashboardDispute, DisputeDetailView } from "@/lib/types";

export const sampleDashboardDisputes: DashboardDispute[] = [
  {
    id: "local-1",
    shopifyDisputeId: "gid://shopify/ShopifyPaymentsDispute/1001",
    shopifyOrderId: "gid://shopify/Order/501",
    status: "NEEDS_RESPONSE",
    reason: "FRAUD",
    amount: "149.00",
    currencyCode: "USD",
    evidenceDueBy: "2026-03-30T00:00:00.000Z",
    completenessScore: 66
  },
  {
    id: "local-2",
    shopifyDisputeId: "gid://shopify/ShopifyPaymentsDispute/1002",
    shopifyOrderId: "gid://shopify/Order/502",
    status: "UNDER_REVIEW",
    reason: "PRODUCT_NOT_RECEIVED",
    amount: "89.00",
    currencyCode: "USD",
    evidenceDueBy: "2026-03-27T00:00:00.000Z",
    completenessScore: 91
  }
];

export const sampleDisputeDetail: DisputeDetailView = {
  id: "local-1",
  shopifyDisputeId: "gid://shopify/ShopifyPaymentsDispute/1001",
  status: "NEEDS_RESPONSE",
  reason: "FRAUD",
  reasonDetails: "Customer claims cardholder did not authorize the order.",
  amount: "149.00",
  currencyCode: "USD",
  evidenceDueBy: "2026-03-30T00:00:00.000Z",
  orderSummary: {
    orderName: "#1001",
    customerName: "Alex Carter",
    customerEmail: "alex@example.com",
    fulfillmentStatus: "FULFILLED"
  },
  evidenceChecklist: [
    { label: "Delivery confirmation", state: "ready" },
    { label: "Shipping documentation", state: "ready" },
    { label: "Customer communication", state: "ready" }
  ],
  latestPacket: {
    version: 1,
    status: "READY",
    generatedAt: "2026-03-25T08:40:00.000Z",
    pdfUrl: "/packets/local-1/sample-packet.txt"
  },
  evidenceItems: [
    {
      id: "e1",
      category: "DELIVERY_CONFIRMATION",
      title: "Delivered via UPS",
      description: "Tracking confirmed delivered at front door with timestamp.",
      sourceType: "shopify_fulfillment",
      fileUrl: null
    },
    {
      id: "e2",
      category: "CUSTOMER_COMMUNICATION",
      title: "Customer support exchange",
      description: "Customer confirmed delayed shipment inquiry before dispute.",
      sourceType: "merchant_upload",
      fileUrl: "/uploads/local-1/customer-thread.pdf"
    }
  ],
  timeline: [
    {
      id: "t1",
      eventType: "DISPUTE_CREATED",
      eventTimestamp: "2026-03-24T10:00:00.000Z",
      source: "shopify_webhook"
    },
    {
      id: "t2",
      eventType: "EVIDENCE_PACKET_DRAFTED",
      eventTimestamp: "2026-03-25T08:30:00.000Z",
      source: "system"
    }
  ]
};
