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

export type OverviewMetricsView = {
  openDisputes: number;
  dueSoon: number;
  totalAmount: number;
  evidenceReady: number;
};

export type DashboardInsightView = {
  title: string;
  tone: "warning" | "info" | "success";
  summary: string;
  detail: string;
  actions: string[];
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
  evidenceSentOn: string | null;
  orderSummary: {
    orderName: string | null;
    customerName: string | null;
    customerEmail: string | null;
    fulfillmentStatus: string | null;
  } | null;
  evidenceChecklist: Array<{
    label: string;
    category: string;
    state: "ready" | "missing";
    whyItMatters: string;
    howToGet: string;
    bestSource: string;
    appSupport: string;
  }>;
  latestPacket: {
    version: number;
    status: string;
    generatedAt: string | null;
    pdfUrl: string | null;
    summaryText: string | null;
    submittedAt: string | null;
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
  recommendations: PreventionRecommendationView[];
};

export type DisputeResponseDraftView = {
  generatedAt: string;
  headline: string;
  executiveSummary: string;
  merchantReply: string;
  internalGuidance: string[];
  strengths: string[];
  missingEvidence: string[];
  nextActions: string[];
};

export type AIPackageAssessmentView = {
  generatedAt: string;
  score: number;
  verdict: "weak" | "improving" | "strong";
  summary: string;
  confidenceNote: string;
  strengths: string[];
  risks: string[];
  improvements: string[];
};

export type PreventionRecommendationView = {
  id: string;
  category: string;
  recommendationText: string;
  priority: number;
  state: string;
};

export type EvidenceLibraryItemView = {
  id: string;
  disputeId: string;
  disputeReference: string;
  title: string;
  category: string;
  sourceType: string;
  description: string | null;
  fileUrl: string | null;
  createdAt: string;
};

export type DisputeOptionView = {
  id: string;
  label: string;
};

export type AnalyticsSnapshotView = {
  openCount: number;
  wonCount: number;
  lostCount: number;
  acceptedCount: number;
  dueSoonCount: number;
  fraudCount: number;
  productNotReceivedCount: number;
  avgReadiness: number;
};
