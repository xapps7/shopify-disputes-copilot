"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Badge,
  BlockStack,
  Box,
  Card,
  DataTable,
  Divider,
  EmptyState,
  InlineGrid,
  InlineStack,
  Page,
  ProgressBar,
  Tabs,
  Text
} from "@shopify/polaris";
import { useEffect, useMemo, useRef, useState } from "react";

import { DeadlineBadge, useNow } from "@/components/deadline-badge";
import { DisputeResponseDraft } from "@/components/dispute-response-draft";
import { EMPTY_STATE_IMAGE } from "@/components/empty-state-image";
import { EvidenceGapCoach } from "@/components/evidence-gap-coach";
import { EvidenceUploadForm } from "@/components/evidence-upload-form";
import type { EvidenceFileRef } from "@/components/evidence-file-slots";
import { GeneratePacketButton } from "@/components/generate-packet-button";
import { OutcomeReviewForm } from "@/components/outcome-review-form";
import { PacketQualityPanel } from "@/components/packet-quality-panel";
import { ResponseBuilder } from "@/components/response-builder";
import { ShopifySubmissionNotice } from "@/components/shopify-submission-notice";
import { SubmissionCenter } from "@/components/submission-center";
import { useShopDomain } from "@/components/use-shop-domain";
import { getReasonProfile } from "@/lib/disputes/reason-codes";
import { formatDate } from "@/lib/format/date";
import { formatMoney } from "@/lib/format/money";
import { shopifyAdminOrderUrl, shopifyAdminOrdersUrl } from "@/lib/format/shopify-admin";
import {
  buildEvidenceFieldStates,
  draftEvidenceFields,
  type EvidenceFieldState
} from "@/lib/disputes/evidence-fields";
import { assessPacketQuality, buildEvidenceGapInsights } from "@/lib/disputes/workflow";
import type { AIPackageAssessmentView, DisputeDetailView, DisputeResponseDraftView } from "@/lib/types";

/**
 * The dispute page used to be a stack of eight equal-weight cards down the right
 * rail, none of which told the merchant what to do next. It is now one screen
 * with one job - write the response - and everything else (checklist, uploads,
 * timeline, packet, outcome) still reachable, one tab away, competing with
 * nothing.
 */

type DisputePageShellProps = {
  dispute: DisputeDetailView;
  readinessScore: number;
  readyEvidence: number;
  responseDraft: DisputeResponseDraftView;
  packageAssessment: AIPackageAssessmentView;
  /**
   * Server-built field states (saved values merged over generated drafts).
   * Optional so this component keeps rendering while the persistence layer for
   * `/api/disputes/[id]/evidence-fields` lands; the fallback below drafts from
   * the order snapshot the page already has.
   */
  evidenceFields?: EvidenceFieldState[];
};

/**
 * `DisputeDetailView.evidenceItems` does not yet carry mime type or byte size -
 * both are needed to police Shopify's 4 MB total and its PDF/PNG/JPEG-only
 * rule. Reading them optionally means the slot picker starts working the moment
 * the data layer adds them, with no change here.
 */
type EvidenceItemWithFileMeta = DisputeDetailView["evidenceItems"][number] & {
  fileMimeType?: string | null;
  fileSizeBytes?: number | null;
};

function statusTone(status: string) {
  if (status.includes("WARNING") || status === "NEEDS_RESPONSE") return "warning" as const;
  if (status === "WON") return "success" as const;
  if (status === "LOST" || status === "ACCEPTED") return "critical" as const;
  return "info" as const;
}

function categoryLabel(category: string) {
  return category.replaceAll("_", " ").toLowerCase();
}

const TABS = [
  { id: "case-details", content: "Case details", panelID: "case-details-panel" },
  { id: "evidence-files", content: "Evidence files", panelID: "evidence-files-panel" },
  { id: "coaching", content: "Coaching", panelID: "coaching-panel" },
  { id: "packet", content: "Packet and submission", panelID: "packet-panel" },
  { id: "history", content: "Timeline and outcome", panelID: "history-panel" }
];

const SUBMISSION_TAB_INDEX = 3;

export function DisputePageShell({
  dispute,
  readinessScore,
  readyEvidence,
  responseDraft,
  packageAssessment,
  evidenceFields
}: DisputePageShellProps) {
  const searchParams = useSearchParams();
  const shopDomain = useShopDomain();
  const now = useNow();
  const submissionSectionRef = useRef<HTMLDivElement | null>(null);
  const [selectedTab, setSelectedTab] = useState(0);
  const [pendingSubmissionFocus, setPendingSubmissionFocus] = useState(false);

  const embeddedQuery = searchParams.toString();
  const disputesUrl = `/disputes${embeddedQuery ? `?${embeddedQuery}` : ""}`;
  const evidenceUrl = `/evidence${embeddedQuery ? `?${embeddedQuery}` : ""}`;
  const packetUrl = `/packets/${dispute.id}${embeddedQuery ? `?${embeddedQuery}` : ""}`;
  const adminDisputeUrl =
    shopifyAdminOrderUrl(shopDomain, dispute.shopifyOrderId) ?? shopifyAdminOrdersUrl(shopDomain);
  const recordedSubmissionAt = dispute.latestPacket?.submittedAt ?? dispute.evidenceSentOn ?? null;
  const disputeAmount = formatMoney(dispute.amount, dispute.currencyCode);
  const gapInsights = buildEvidenceGapInsights(dispute);
  const packetReview = assessPacketQuality(dispute);

  // The tab has to be mounted before its content can be focused, so the focus
  // request is deferred to an effect rather than run inside the click handler.
  useEffect(() => {
    if (!pendingSubmissionFocus) {
      return;
    }

    setPendingSubmissionFocus(false);
    const node = submissionSectionRef.current;
    if (!node) {
      return;
    }

    node.scrollIntoView({ behavior: "smooth", block: "center" });
    node.focus({ preventScroll: true });
  }, [pendingSubmissionFocus]);

  function goToRecordSubmission() {
    setSelectedTab(SUBMISSION_TAB_INDEX);
    setPendingSubmissionFocus(true);
  }

  const fallbackFields = useMemo(
    () =>
      buildEvidenceFieldStates(
        getReasonProfile(dispute.reason).priorityFields,
        {},
        draftEvidenceFields({
          reasonLabel: getReasonProfile(dispute.reason).label,
          reasonQuestion: getReasonProfile(dispute.reason).theQuestion,
          orderName: dispute.orderSummary?.orderName ?? null,
          orderTotal: dispute.orderSummary?.orderTotal ?? null,
          currencyCode: dispute.orderSummary?.currencyCode ?? dispute.currencyCode,
          customerName: dispute.orderSummary?.customerName ?? null,
          customerEmail: dispute.orderSummary?.customerEmail ?? null,
          shippingAddress: null,
          fulfillmentStatus: dispute.orderSummary?.fulfillmentStatus ?? null,
          trackingSummaries: [],
          lineItemSummaries: [],
          refundPolicyUrl: "",
          returnPolicyUrl: "",
          supportEmail: "",
          statementDescriptor: "",
          orderPlacedAt: null
        })
      ),
    [dispute.reason, dispute.currencyCode, dispute.orderSummary]
  );

  const fields = evidenceFields ?? fallbackFields;

  const evidenceFileRefs: EvidenceFileRef[] = useMemo(
    () =>
      dispute.evidenceItems.map((raw) => {
        const item = raw as EvidenceItemWithFileMeta;
        return {
          id: item.id,
          category: item.category,
          title: item.title,
          fileUrl: item.fileUrl,
          fileMimeType: item.fileMimeType ?? null,
          fileSizeBytes: item.fileSizeBytes ?? null
        };
      }),
    [dispute.evidenceItems]
  );

  const evidenceByCategory = dispute.evidenceItems.reduce<Record<string, DisputeDetailView["evidenceItems"]>>(
    (acc, item) => {
      acc[item.category] = [...(acc[item.category] ?? []), item];
      return acc;
    },
    {}
  );

  return (
    <Page
      fullWidth
      title={`Dispute ${dispute.shopifyDisputeId.split("/").pop()}`}
      subtitle={`${(dispute.reason ?? "Unknown").replaceAll("_", " ")} · ${disputeAmount}`}
      backAction={{ content: "Disputes", url: disputesUrl }}
      primaryAction={
        adminDisputeUrl
          ? {
              content: "Open in Shopify Admin",
              url: adminDisputeUrl,
              external: true
            }
          : {
              content: "Record submission",
              onAction: goToRecordSubmission
            }
      }
      secondaryActions={[
        ...(dispute.latestPacket
          ? [
              {
                content: "Download packet",
                url: `/api/disputes/${dispute.id}/packet/download`,
                external: true
              }
            ]
          : []),
        ...(adminDisputeUrl
          ? [
              {
                content: "Record submission",
                onAction: goToRecordSubmission
              }
            ]
          : [])
      ]}
    >
      <BlockStack gap="400">
        <ShopifySubmissionNotice
          shopDomain={shopDomain}
          shopifyDisputeId={dispute.shopifyDisputeId}
          shopifyOrderId={dispute.shopifyOrderId}
          recordedAt={recordedSubmissionAt}
        />

        <ResponseBuilder
          amount={dispute.amount}
          currencyCode={dispute.currencyCode}
          disputeId={dispute.id}
          evidenceDueBy={dispute.evidenceDueBy}
          evidenceFields={fields}
          evidenceItems={evidenceFileRefs}
          reason={dispute.reason}
          shopDomain={shopDomain}
          shopifyOrderId={dispute.shopifyOrderId}
        />

        <Card padding="0">
          <Tabs onSelect={setSelectedTab} selected={selectedTab} tabs={TABS}>
            <Box padding="400">
              {selectedTab === 0 ? (
                <BlockStack gap="400">
                  <BlockStack gap="200">
                    <InlineStack gap="200" blockAlign="center" wrap>
                      <Badge tone={statusTone(dispute.status)}>{dispute.status.replaceAll("_", " ")}</Badge>
                      <Badge>{`Due ${formatDate(dispute.evidenceDueBy, { fallback: "No deadline" })}`}</Badge>
                      <DeadlineBadge dueBy={dispute.evidenceDueBy} now={now} layout="inline" />
                    </InlineStack>
                    <Text as="h2" variant="headingMd">
                      Case details
                    </Text>
                    <Text as="p" variant="bodyMd" tone="subdued">
                      {dispute.reasonDetails ?? "No additional issuer context is available yet."}
                    </Text>
                  </BlockStack>

                  <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm">
                        Order
                      </Text>
                      <DataTable
                        columnContentTypes={["text", "text"]}
                        headings={["Field", "Value"]}
                        rows={[
                          ["Order", dispute.orderSummary?.orderName ?? "Unavailable"],
                          [
                            "Order amount",
                            dispute.orderSummary?.orderTotal
                              ? formatMoney(
                                  dispute.orderSummary.orderTotal,
                                  dispute.orderSummary.currencyCode ?? dispute.currencyCode
                                )
                              : "Unavailable"
                          ],
                          ["Customer", dispute.orderSummary?.customerName ?? "Unavailable"],
                          ["Email", dispute.orderSummary?.customerEmail ?? "Unavailable"],
                          ["Fulfillment status", dispute.orderSummary?.fulfillmentStatus ?? "Unavailable"]
                        ]}
                      />
                    </BlockStack>

                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm">
                        Payment and refunds
                      </Text>
                      <DataTable
                        columnContentTypes={["text", "text"]}
                        headings={["Field", "Value"]}
                        rows={[
                          ["Disputed amount", disputeAmount],
                          [
                            "Refund proof",
                            dispute.evidenceItems.some((item) => item.category === "REFUND_PROOF")
                              ? "Present"
                              : "Not linked"
                          ],
                          [
                            "Delivery evidence",
                            readyEvidence > 0 ? "Present in evidence record" : "Not yet linked"
                          ],
                          ["Packet status", dispute.latestPacket?.status ?? "Not generated"],
                          [
                            "Missing evidence categories",
                            String(dispute.evidenceChecklist.length - readyEvidence)
                          ]
                        ]}
                      />
                    </BlockStack>
                  </InlineGrid>

                  <BlockStack gap="150">
                    <Text as="h3" variant="headingSm">
                      Evidence category coverage
                    </Text>
                    <ProgressBar
                      progress={readinessScore}
                      tone={readinessScore < 60 ? "critical" : readinessScore === 100 ? "success" : "primary"}
                    />
                    <Text as="p" variant="bodySm" tone="subdued">
                      {`${readyEvidence} of ${dispute.evidenceChecklist.length} required categories are ready. This counts uploaded files by category; the readiness meter above the response counts the fields Shopify actually asks for.`}
                    </Text>
                  </BlockStack>
                </BlockStack>
              ) : null}

              {selectedTab === 1 ? (
                <BlockStack gap="400">
                  <InlineGrid columns={{ xs: 1, lg: 2 }} gap="400">
                    <BlockStack gap="300">
                      <BlockStack gap="100">
                        <Text as="h2" variant="headingMd">
                          Add evidence
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          Pick the category that matches the Shopify file slot you are filling. Shopify accepts PDF,
                          PNG and JPEG only, one file per slot, and 4 MB across all of them.
                        </Text>
                      </BlockStack>
                      <EvidenceUploadForm disputeId={dispute.id} />
                    </BlockStack>

                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="center" gap="200" wrap>
                        <Text as="h2" variant="headingMd">
                          Files on this dispute
                        </Text>
                        <Link className="table-link" href={evidenceUrl as never}>
                          Open evidence library
                        </Link>
                      </InlineStack>

                      {dispute.evidenceItems.length > 0 ? (
                        <DataTable
                          columnContentTypes={["text", "text", "text"]}
                          headings={["File", "Category", "Source"]}
                          rows={dispute.evidenceItems.map((item) => [
                            item.fileUrl ? (
                              <a
                                className="table-link"
                                href={item.fileUrl}
                                key={`${item.id}-link`}
                                rel="noreferrer"
                                target="_blank"
                              >
                                {item.title}
                              </a>
                            ) : (
                              item.title
                            ),
                            item.category.replaceAll("_", " "),
                            item.sourceType
                          ])}
                        />
                      ) : (
                        <EmptyState heading="No evidence files yet" image={EMPTY_STATE_IMAGE}>
                          <p>
                            Upload the files the response needs, or link an existing file from the evidence library.
                            They appear in the Shopify file slots above as soon as they are here.
                          </p>
                        </EmptyState>
                      )}
                    </BlockStack>
                  </InlineGrid>

                  <Divider />

                  <BlockStack gap="300">
                    <BlockStack gap="100">
                      <Text as="h2" variant="headingMd">
                        Evidence checklist
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Where each kind of proof comes from, if you still have to go and find it.
                      </Text>
                    </BlockStack>

                    <BlockStack gap="200">
                      {dispute.evidenceChecklist.map((item, index) => (
                        <BlockStack gap="200" key={item.label}>
                          <InlineStack align="space-between" blockAlign="start" gap="300" wrap>
                            <BlockStack gap="050">
                              <Text as="p" variant="bodyMd" fontWeight="medium">
                                {item.label}
                              </Text>
                              <Text as="p" variant="bodySm">
                                {item.whyItMatters}
                              </Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                <strong>How to get it:</strong> {item.howToGet}
                              </Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                <strong>Best source:</strong> {item.bestSource}
                              </Text>
                              {item.state === "ready" ? (
                                (evidenceByCategory[item.category] ?? []).length > 0 ? (
                                  <InlineStack gap="200" wrap>
                                    {(evidenceByCategory[item.category] ?? []).map((evidence) =>
                                      evidence.fileUrl ? (
                                        <a
                                          className="table-link"
                                          href={evidence.fileUrl}
                                          key={evidence.id}
                                          rel="noreferrer"
                                          target="_blank"
                                        >
                                          {evidence.title}
                                        </a>
                                      ) : (
                                        <Text as="span" key={evidence.id} variant="bodySm">
                                          {evidence.title}
                                        </Text>
                                      )
                                    )}
                                  </InlineStack>
                                ) : (
                                  <Text as="p" variant="bodySm" tone="subdued">
                                    Marked ready from the case record, but no standalone file is linked yet.
                                  </Text>
                                )
                              ) : (
                                <Text as="p" variant="bodySm">
                                  <strong>Next step:</strong> upload this as{" "}
                                  <strong>{categoryLabel(item.category)}</strong> in the Add evidence panel above.
                                </Text>
                              )}
                            </BlockStack>
                            <Badge tone={item.state === "ready" ? "success" : "attention"}>
                              {item.state === "ready" ? "Ready" : "Missing"}
                            </Badge>
                          </InlineStack>
                          {index < dispute.evidenceChecklist.length - 1 ? <Divider /> : null}
                        </BlockStack>
                      ))}
                    </BlockStack>
                  </BlockStack>
                </BlockStack>
              ) : null}

              {selectedTab === 2 ? (
                <BlockStack gap="400">
                  <BlockStack gap="200">
                    <InlineStack align="space-between" blockAlign="center" gap="200" wrap>
                      <Text as="h2" variant="headingMd">
                        Evidence collection playbook
                      </Text>
                      <Badge tone={gapInsights.length > 0 ? "attention" : "success"}>
                        {gapInsights.length > 0 ? `${gapInsights.length} gaps` : "Covered"}
                      </Badge>
                    </InlineStack>
                    <EvidenceGapCoach gaps={gapInsights} />
                  </BlockStack>

                  <Divider />

                  <DisputeResponseDraft
                    disputeId={dispute.id}
                    initialAssessment={packageAssessment}
                    initialDraft={responseDraft}
                  />
                </BlockStack>
              ) : null}

              {selectedTab === 3 ? (
                <BlockStack gap="400">
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingMd">
                      Packet
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      The packet is an internal record and a download for your files. The response above is what
                      Shopify&rsquo;s form actually asks for.
                    </Text>
                    <InlineStack gap="300" wrap>
                      <Link className="table-link" href={packetUrl as never}>
                        Open packet preview
                      </Link>
                      {dispute.latestPacket ? (
                        <a
                          className="table-link"
                          href={`/api/disputes/${dispute.id}/packet/download`}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Download current packet
                        </a>
                      ) : null}
                    </InlineStack>
                    <InlineStack>
                      <GeneratePacketButton disputeId={dispute.id} />
                    </InlineStack>
                    <PacketQualityPanel review={packetReview} />
                  </BlockStack>

                  <Divider />

                  <div id="record-submission" ref={submissionSectionRef} tabIndex={-1}>
                    <BlockStack gap="200">
                      <Text as="h2" variant="headingMd">
                        Record submission
                      </Text>
                      <SubmissionCenter
                        disputeId={dispute.id}
                        evidenceSentOn={dispute.evidenceSentOn}
                        packetReady={packetReview.status !== "blocked" && Boolean(dispute.latestPacket)}
                        packetStatus={dispute.latestPacket?.status ?? null}
                        shopDomain={shopDomain}
                        shopifyDisputeId={dispute.shopifyDisputeId}
                        shopifyOrderId={dispute.shopifyOrderId}
                        submittedAt={dispute.latestPacket?.submittedAt ?? null}
                      />
                    </BlockStack>
                  </div>
                </BlockStack>
              ) : null}

              {selectedTab === 4 ? (
                <BlockStack gap="400">
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingMd">
                      Timeline
                    </Text>
                    {dispute.timeline.length > 0 ? (
                      <BlockStack gap="200">
                        {dispute.timeline.map((event, index) => (
                          <BlockStack gap="100" key={event.id}>
                            <InlineStack align="space-between" gap="200" wrap>
                              <Text as="p" variant="bodyMd" fontWeight="medium">
                                {event.eventType.replaceAll("_", " ")}
                              </Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                {formatDate(event.eventTimestamp)}
                              </Text>
                            </InlineStack>
                            <Text as="p" variant="bodySm" tone="subdued">
                              {event.source}
                            </Text>
                            {index < dispute.timeline.length - 1 ? <Divider /> : null}
                          </BlockStack>
                        ))}
                      </BlockStack>
                    ) : (
                      <Text as="p" variant="bodySm" tone="subdued">
                        Uploads, packet generation, sync updates, and recorded submissions appear here as they
                        happen.
                      </Text>
                    )}
                  </BlockStack>

                  <Divider />

                  <BlockStack gap="200">
                    <Text as="h2" variant="headingMd">
                      Recommendations
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {dispute.recommendations.length > 0
                        ? dispute.recommendations[0].recommendationText
                        : "Recommendations appear after outcome review and tagging."}
                    </Text>
                  </BlockStack>

                  <Divider />

                  <OutcomeReviewForm
                    currentStatus={dispute.status}
                    disputeId={dispute.id}
                    recommendations={dispute.recommendations}
                  />
                </BlockStack>
              ) : null}
            </Box>
          </Tabs>
        </Card>
      </BlockStack>
    </Page>
  );
}
