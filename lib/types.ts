export type DashboardDispute = {
  id: string;
  shopifyDisputeId: string;
  shopifyOrderId: string | null;
  status: string;
  reason: string | null;
  amount: string;
  currencyCode: string | null;
  evidenceDueBy: string | null;
  completenessScore: number;
};

export type DisputeDetailView = {
  id: string;
  shopifyDisputeId: string;
  status: string;
  reason: string | null;
  reasonDetails: string | null;
  amount: string;
  currencyCode: string | null;
  evidenceDueBy: string | null;
  orderSummary: {
    orderName: string | null;
    customerName: string | null;
    customerEmail: string | null;
    fulfillmentStatus: string | null;
  } | null;
  evidenceChecklist: Array<{
    label: string;
    state: "ready" | "missing";
  }>;
  latestPacket: {
    version: number;
    status: string;
    generatedAt: string | null;
    pdfUrl: string | null;
  } | null;
  evidenceItems: Array<{
    id: string;
    category: string;
    title: string;
    description: string | null;
    sourceType: string;
    fileUrl: string | null;
  }>;
  timeline: Array<{
    id: string;
    eventType: string;
    eventTimestamp: string;
    source: string;
  }>;
};
