"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Card,
  DataTable,
  Divider,
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
import { DisputeStrategyCard } from "@/components/dispute-strategy-card";
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
 * One screen, one job: write the response before Shopify answers for you.
 *
 * This page used to carry five tabs - Case details, Evidence files, Coaching,
 * Packet and submission, Timeline and outcome - which put the work in one place
 * and the instructions for it in another. Two of them are gone entirely:
 *
 *  - Coaching now renders against the slot it is coaching, inside the builder.
 *    Guidance a tab away from the box it explains is guidance nobody reads.
 *  - Evidence files is gone because each Shopify slot in the builder takes its
 *    own upload, so there is nothing left to do on a separate uploads screen,
 *    and asking the merchant to guess a category was how slots stayed empty.
 *
 * What remains is the builder, the hand-off it ends in, and a single "Case and
 * history" tab holding the record: the details, the checklist as it stands, the
 * timeline, and the outcome.
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

/**
 * One tab, because there is one thing here that is not the response: the record
 * of the case. It stays a tab rather than becoming another card so the builder
 * keeps the top of the page to itself.
 */
const TABS = [{ id: "case-and-history", content: "Case and history", panelID: "case-and-history-panel" }];

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
  const isLocked = dispute.lock.locked;

  // Record submission is a section on this page now, not a tab: the focus
  // request still waits for an effect so the node is mounted and scrolled
  // before it takes focus.
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
        {isLocked ? (
          <Banner tone="info" title="This dispute is closed to changes">
            <p>{dispute.lock.reason}</p>
            <p>
              Everything below is the record of what was argued. You can still copy it, and it is what teaches the
              app which evidence actually wins.
            </p>
          </Banner>
        ) : null}

        <DisputeStrategyCard strategy={dispute.strategy} />

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
          gaps={gapInsights}
          locked={isLocked}
          reason={dispute.reason}
          shopDomain={shopDomain}
          shopifyOrderId={dispute.shopifyOrderId}
        />

        <DisputeResponseDraft
          disputeId={dispute.id}
          initialAssessment={packageAssessment}
          initialDraft={responseDraft}
        />

        <Card>
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">
                Packet and submission
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                The packet is an internal record and a download for your files. The response above is what
                Shopify&rsquo;s form actually asks for.
              </Text>
            </BlockStack>

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

            {isLocked ? null : (
              <InlineStack>
                <GeneratePacketButton disputeId={dispute.id} />
              </InlineStack>
            )}

            <PacketQualityPanel review={packetReview} />

            <Divider />

            <div id="record-submission" ref={submissionSectionRef} tabIndex={-1}>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  Record submission
                </Text>
                {isLocked ? (
                  <Text as="p" variant="bodySm" tone="subdued">
                    {recordedSubmissionAt
                      ? `Recorded as sent on ${formatDate(recordedSubmissionAt)}. This case is closed, so there is nothing left to record.`
                      : "This case is closed, so there is nothing left to record."}
                  </Text>
                ) : (
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
                )}
              </BlockStack>
            </div>
          </BlockStack>
        </Card>

        <Card padding="0">
          <Tabs onSelect={setSelectedTab} selected={selectedTab} tabs={TABS}>
            <Box padding="400">
              <BlockStack gap="400">
                <BlockStack gap="200">
                  <InlineStack gap="200" blockAlign="center" wrap>
                    <Badge tone={statusTone(dispute.status)}>{dispute.status.replaceAll("_", " ")}</Badge>
                    <Badge>
                      {dispute.evidenceDueBy
                        ? `Shopify sends ${formatDate(dispute.evidenceDueBy)}`
                        : "No auto-submit date"}
                    </Badge>
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
                        ["Delivery evidence", readyEvidence > 0 ? "Present in evidence record" : "Not yet linked"],
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

                <Divider />

                <BlockStack gap="300">
                  <BlockStack gap="100">
                    <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
                      <Text as="h3" variant="headingSm">
                        Evidence checklist
                      </Text>
                      <Link className="table-link" href={evidenceUrl as never}>
                        Open evidence library
                      </Link>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Where this case stands on proof. Anything still missing is also flagged against the Shopify
                      slot that would carry it, up in the response, with how to get it.
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
                            ) : isLocked ? (
                              <Text as="p" variant="bodySm" tone="subdued">
                                {`Went to the bank without this. Best source next time: ${item.bestSource}`}
                              </Text>
                            ) : (
                              <Text as="p" variant="bodySm">
                                <strong>Next step:</strong> add this in the response above, under the slot for{" "}
                                <strong>{categoryLabel(item.category)}</strong>.
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

                <Divider />

                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">
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
                      Uploads, packet generation, sync updates, and recorded submissions appear here as they happen.
                    </Text>
                  )}
                </BlockStack>

                <Divider />

                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">
                    What this case changes for next time
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {dispute.recommendations.length > 0
                      ? dispute.recommendations[0].recommendationText
                      : "Record the outcome below and the pattern behind it turns into a prevention action under Account health."}
                  </Text>
                </BlockStack>

                <Divider />

                <OutcomeReviewForm
                  currentStatus={dispute.status}
                  disputeId={dispute.id}
                  recommendations={dispute.recommendations}
                />
              </BlockStack>
            </Box>
          </Tabs>
        </Card>
      </BlockStack>
    </Page>
  );
}
