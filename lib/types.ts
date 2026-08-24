import type { EvidenceFieldState } from "@/lib/disputes/evidence-fields";
import type { LibraryDocument } from "@/lib/documents/library";
import type { StrategyRecommendation } from "@/lib/economics/strategy";

import type { Ce30Result } from "@/lib/disputes/ce30";
import type { ProtectSignal } from "@/lib/disputes/shopify-protect";

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
  /** Set once Shopify has a submission on record; the dispute is frozen after this. */
  evidenceSentOn: string | null;
  /** Any evidence at all - an uploaded file or a written field. */
  hasEvidence: boolean;
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
  /**
   * Shop-level documents offered against this dispute's file slots. They are
   * not EvidenceItems and are never copied into one - the same file serves
   * every dispute, and duplicating it per case is the problem this replaces.
   */
  standingDocuments: LibraryDocument[];
  /** Fight, accept, or prevent - with the money and the reasoning behind it. */
  strategy: StrategyRecommendation;
  /** Shopify Protect signal, or null when there is nothing worth saying. */
  protect: ProtectSignal | null;
  /**
   * Visa Compelling Evidence 3.0 - the one remedy that takes the dispute off the
   * fraud ratio as well as returning the money.
   *
   * Null when the dispute is not a Visa 10.4 fraud claim, and the card renders
   * nothing at all in that case. A "not eligible" verdict on a duplicate-charge
   * dispute is noise about a rule that was never in play.
   */
  ce30: Ce30Result | null;
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
