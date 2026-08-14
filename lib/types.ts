import type { EvidenceFieldState } from "@/lib/disputes/evidence-fields";
import type { StrategyRecommendation } from "@/lib/economics/strategy";

export type DashboardDispute = {
  id: string;
  shopifyDisputeId: string;
  shopifyOrderId: string | null;
  /** e.g. "#1005" - so the queue shows the order, not a raw id. */
  orderName: string | null;
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
  /** Needed to link into Shopify Admin: chargebacks live on the order page. */
  shopifyOrderId: string | null;
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
    orderTotal: string | null;
    currencyCode: string | null;
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
    fileMimeType: string | null;
    fileSizeBytes: number | null;
  }>;
  /** Shopify's evidence form, pre-filled: saved merchant edits merged over generated drafts. */
  evidenceFields: EvidenceFieldState[];
  /** Fight, accept, or prevent - with the money and the reasoning behind it. */
  strategy: StrategyRecommendation;
  /** Set once nothing can reach Shopify any more; the record becomes read-only. */
  lock: { locked: boolean; reason: string | null; cause: "decided" | "submitted" | "auto-submitted" | null };
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
