import type { DashboardDispute, DisputeDetailView } from "@/lib/types";

function fraudChecklist() {
  return [
    {
      label: "Delivery confirmation",
      category: "DELIVERY_CONFIRMATION",
      state: "ready" as const,
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
      state: "missing" as const,
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
      state: "ready" as const,
      whyItMatters:
        "Customer messages can show purchase recognition, delivery follow-up, or prior engagement after the order.",
      howToGet:
        "Collect support tickets, order emails, chat transcripts, or delivery follow-up messages connected to the same customer.",
      bestSource: "Helpdesk thread, order confirmation email, or chat transcript",
      appSupport: "The app can summarize the thread and place the strongest excerpts into the packet narrative."
    }
  ];
}

function productNotReceivedChecklist() {
  return [
    {
      label: "Delivery confirmation",
      category: "DELIVERY_CONFIRMATION",
      state: "ready" as const,
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
      state: "ready" as const,
      whyItMatters:
        "Shipment records establish when the parcel moved through the carrier network and where it was addressed.",
      howToGet:
        "Gather the label, tracking history, and any carrier exception or final-mile notes for the shipment.",
      bestSource: "Carrier tracking history and shipping label",
      appSupport: "The app can combine the tracking sequence with the merchant narrative."
    }
  ];
}

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

export const sampleDisputeDetails: DisputeDetailView[] = [
  {
    id: "local-1",
    shopifyDisputeId: "gid://shopify/ShopifyPaymentsDispute/1001",
    status: "NEEDS_RESPONSE",
    reason: "FRAUD",
    reasonDetails: "Customer claims cardholder did not authorize the order.",
    amount: "149.00",
    currencyCode: "USD",
    evidenceDueBy: "2026-03-30T00:00:00.000Z",
    evidenceSentOn: null,
    orderSummary: {
      orderName: "#1001",
      customerName: "Alex Carter",
      customerEmail: "alex@example.com",
      fulfillmentStatus: "FULFILLED"
    },
    evidenceChecklist: fraudChecklist(),
    latestPacket: {
      version: 1,
      status: "READY",
      generatedAt: "2026-03-25T08:40:00.000Z",
      pdfUrl: "/packets/local-1/sample-packet.txt",
      submittedAt: null,
      summaryText: [
        "Shop: xappsdev.myshopify.com",
        "Dispute: gid://shopify/ShopifyPaymentsDispute/1001",
        "Status: NEEDS_RESPONSE",
        "Reason: FRAUD",
        "Reason details: Customer claims cardholder did not authorize the order.",
        "",
        "Evidence items:",
        "1. Delivered via UPS",
        "   Category: DELIVERY_CONFIRMATION",
        "   Source: shopify_fulfillment",
        "2. Customer support exchange",
        "   Category: CUSTOMER_COMMUNICATION",
        "   Source: merchant_upload"
      ].join("\n")
    },
    evidenceItems: [
      {
        id: "e1",
        category: "DELIVERY_CONFIRMATION",
        title: "Delivered via UPS",
        description: "Tracking confirmed delivered at front door with timestamp.",
        sourceType: "shopify_fulfillment",
        fileUrl: "/uploads/local-1/delivery-proof.txt"
      },
      {
        id: "e2",
        category: "CUSTOMER_COMMUNICATION",
        title: "Customer support exchange",
        description: "Customer confirmed delayed shipment inquiry before dispute.",
        sourceType: "merchant_upload",
        fileUrl: "/uploads/local-1/customer-thread.txt"
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
    ],
    recommendations: [
      {
        id: "r1",
        category: "FULFILLMENT",
        recommendationText: "Capture carrier delivery proof and post-delivery confirmation for similar orders.",
        priority: 1,
        state: "OPEN"
      }
    ]
  },
  {
    id: "local-2",
    shopifyDisputeId: "gid://shopify/ShopifyPaymentsDispute/1002",
    status: "UNDER_REVIEW",
    reason: "PRODUCT_NOT_RECEIVED",
    reasonDetails: "Customer claims the parcel never arrived at the delivery address.",
    amount: "89.00",
    currencyCode: "USD",
    evidenceDueBy: "2026-03-27T00:00:00.000Z",
    evidenceSentOn: "2026-03-26T09:15:00.000Z",
    orderSummary: {
      orderName: "#1002",
      customerName: "Priya Mehta",
      customerEmail: "priya@example.com",
      fulfillmentStatus: "FULFILLED"
    },
    evidenceChecklist: productNotReceivedChecklist(),
    latestPacket: {
      version: 2,
      status: "SUBMITTED",
      generatedAt: "2026-03-26T08:15:00.000Z",
      pdfUrl: "/packets/local-2/sample-packet.txt",
      submittedAt: "2026-03-26T09:20:00.000Z",
      summaryText: [
        "Shop: xappsdev.myshopify.com",
        "Dispute: gid://shopify/ShopifyPaymentsDispute/1002",
        "Status: UNDER_REVIEW",
        "Reason: PRODUCT_NOT_RECEIVED",
        "Reason details: Customer claims the parcel never arrived at the delivery address.",
        "",
        "Evidence items:",
        "1. FedEx proof of delivery",
        "   Category: DELIVERY_CONFIRMATION",
        "   Source: shopify_fulfillment",
        "2. Shipping label and tracking history",
        "   Category: SHIPPING_DOCUMENTATION",
        "   Source: merchant_upload"
      ].join("\n")
    },
    evidenceItems: [
      {
        id: "e3",
        category: "DELIVERY_CONFIRMATION",
        title: "FedEx proof of delivery",
        description: "Carrier scan marked delivered with timestamp and destination city.",
        sourceType: "shopify_fulfillment",
        fileUrl: "/uploads/local-2/delivery-proof.txt"
      },
      {
        id: "e4",
        category: "SHIPPING_DOCUMENTATION",
        title: "Shipping label and tracking history",
        description: "Label, service type, and final-mile tracking history for the shipment.",
        sourceType: "merchant_upload",
        fileUrl: "/uploads/local-2/shipping-record.txt"
      }
    ],
    timeline: [
      {
        id: "t3",
        eventType: "DISPUTE_CREATED",
        eventTimestamp: "2026-03-23T11:30:00.000Z",
        source: "shopify_webhook"
      },
      {
        id: "t4",
        eventType: "EVIDENCE_SUBMITTED",
        eventTimestamp: "2026-03-26T09:20:00.000Z",
        source: "merchant_manual_submission"
      }
    ],
    recommendations: [
      {
        id: "r2",
        category: "FULFILLMENT",
        recommendationText: "Include proof-of-delivery links in the shipment notification and post-delivery support macros.",
        priority: 1,
        state: "OPEN"
      }
    ]
  }
];

export const sampleDisputeDetail = sampleDisputeDetails[0];

export function getSampleDisputeDetail(id?: string) {
  return sampleDisputeDetails.find((item) => item.id === id) ?? sampleDisputeDetails[0];
}
