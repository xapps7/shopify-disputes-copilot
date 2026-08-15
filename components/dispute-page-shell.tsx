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
import { orderReference, orderReferenceNote } from "@/components/order-label";
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
 * This page used to carry five tabs, then one very long column. Collapsing the
 * tabs fixed a navigation problem and created a scrolling one: the facts a
 * merchant needs *while writing* - who the customer is, where it shipped, what
 * the order was worth, when Shopify submits - ended up hundreds of pixels below
 * the fields they inform, so writing the response meant scrolling up and down
 * for every sentence.
 *
 * So the page is two columns. The left is the work: the strategy, the hand-off
 * notice, the builder, the packet. The right is a sticky reference rail of case
 * facts - dense, no prose, never something you act on. Below both sits "Case
 * and history": the checklist, the timeline, the outcome. That is a record, not
 * reference, and records belong at the bottom.
 *
 * Two of the original tabs stay gone: coaching renders against the slot it is
 * coaching inside the builder, and evidence uploads happen in the slot that
 * needs them rather than on a screen of their own.
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
   * `/api/disputes/[id]/evidence-fields` lands; the fallbacks below prefer the
   * states already on the detail view, then draft from the order snapshot.
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

/**
 * The order snapshot the repository builds internally already contains a
 * flattened shipping address and tracking summaries, but `orderSummary` on the
 * view does not expose them yet. Reading them optionally means the rail shows
 * them the moment the data layer publishes them, and says "Not available" with
 * a reason until then rather than rendering a blank row.
 */
type OrderSummaryWithLogistics = NonNullable<DisputeDetailView["orderSummary"]> & {
  shippingAddress?: string | null;
  trackingNumbers?: string[] | null;
  trackingSummaries?: string[] | null;
};

/** Evidence categories that mean "there is proof of shipment on this case". */
const SHIPPING_EVIDENCE_CATEGORIES = new Set(["SHIPPING_DOCUMENTATION", "DELIVERY_CONFIRMATION"]);

function statusTone(status: string) {
  if (status.includes("WARNING") || status === "NEEDS_RESPONSE") return "warning" as const;
  if (status === "WON") return "success" as const;
  if (status === "LOST" || status === "ACCEPTED") return "critical" as const;
  return "info" as const;
}

function categoryLabel(category: string) {
  return category.replaceAll("_", " ").toLowerCase();
}

/** `PARTIALLY_FULFILLED` -> `Partially fulfilled`. */
function humanise(value: string): string {
  const words = value.replaceAll("_", " ").trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : value;
}

function fieldValue(fields: EvidenceFieldState[], key: EvidenceFieldState["key"]): string | null {
  const value = fields.find((field) => field.key === key)?.value?.trim();
  return value ? value : null;
}

/**
 * One row of the reference rail. A fact is either present or explicitly absent:
 * a blank cell would read as "zero" or "none", which for a customer name or a
 * tracking number is a different and much worse claim than "we do not have it".
 */
type CaseFact = {
  label: string;
  /** `null` renders the unavailable state instead. */
  value: React.ReactNode | null;
  /** One line naming why it is missing. Shown under "Not available". */
  missingReason?: string;
  /** Shown under a present value, e.g. that the order name is masked. */
  note?: string | null;
};

function CaseFactRow({ fact }: { fact: CaseFact }) {
  // An empty string counts as missing: a row reading "Customer:" followed by
  // nothing is the blank stare this panel exists to avoid.
  const isMissing = fact.value === null || fact.value === undefined || fact.value === "";

  return (
    <div>
      <Text as="dt" variant="bodyXs" tone="subdued">
        {fact.label}
      </Text>
      <Text as="dd" variant="bodySm">
        {isMissing ? (
          <Text as="span" variant="bodySm" tone="subdued">
            Not available
          </Text>
        ) : (
          fact.value
        )}
      </Text>
      {isMissing && fact.missingReason ? (
        <Text as="dd" variant="bodyXs" tone="subdued">
          {fact.missingReason}
        </Text>
      ) : null}
      {!isMissing && fact.note ? (
        <Text as="dd" variant="bodyXs" tone="subdued">
          {fact.note}
        </Text>
      ) : null}
    </div>
  );
}

type CaseFactsRailProps = {
  dispute: DisputeDetailView;
  fields: EvidenceFieldState[];
  adminOrderUrl: string | null;
  now: number | null;
};

/**
 * The reference panel: everything a merchant checks while writing, and nothing
 * they act on. Sticky on wide screens, stacked underneath the work on narrow
 * ones - reference below the thing it informs is still useful; reference above
 * it is just a wall between the merchant and the form.
 */
function CaseFactsRail({ dispute, fields, adminOrderUrl, now }: CaseFactsRailProps) {
  const summary = (dispute.orderSummary ?? null) as OrderSummaryWithLogistics | null;
  const orderCurrency = summary?.currencyCode ?? dispute.currencyCode;

  const orderName = summary?.orderName ?? null;
  const orderText = orderReference(orderName, dispute.shopifyOrderId);
  const hasOrder = Boolean(orderName) || Boolean(dispute.shopifyOrderId);

  // Customer details and the shipping address reach this page through the
  // evidence fields (drafted from the order snapshot) before they reach
  // `orderSummary`, so both sources are read, order-summary first.
  const draftedName = [fieldValue(fields, "customerFirstName"), fieldValue(fields, "customerLastName")]
    .filter(Boolean)
    .join(" ")
    .trim();
  const customerName = summary?.customerName?.trim() || draftedName || null;
  const customerEmail = summary?.customerEmail?.trim() || fieldValue(fields, "customerEmailAddress");
  const shippingAddress = summary?.shippingAddress ?? fieldValue(fields, "shippingAddress");

  const trackingList = (summary?.trackingSummaries ?? summary?.trackingNumbers ?? []).filter(
    (entry): entry is string => Boolean(entry && entry.trim())
  );
  const hasShippingEvidence = dispute.evidenceItems.some((item) =>
    SHIPPING_EVIDENCE_CATEGORIES.has(item.category)
  );

  const protectedDataReason =
    "Shopify has not shared customer details for this order. Protected customer data access is usually the reason.";

  const facts: CaseFact[] = [
    {
      label: "Order",
      value: hasOrder ? (
        adminOrderUrl ? (
          <a className="table-link" href={adminOrderUrl} rel="noreferrer" target="_blank">
            {`${orderText} — open in Shopify Admin`}
          </a>
        ) : (
          orderText
        )
      ) : null,
      note: orderReferenceNote(orderName, dispute.shopifyOrderId),
      missingReason: "No order is linked to this dispute yet, so there is nothing to open in Admin."
    },
    {
      label: "Customer",
      value: customerName,
      missingReason: protectedDataReason
    },
    {
      label: "Email",
      value: customerEmail,
      missingReason: protectedDataReason
    },
    {
      label: "Shipping address",
      value: shippingAddress,
      missingReason: "No shipping address on the order sync. Digital and in-store orders never have one."
    },
    {
      label: "Order total",
      value: summary?.orderTotal ? formatMoney(summary.orderTotal, orderCurrency) : null,
      missingReason: "The order has not synced far enough to carry its total."
    },
    {
      label: "Disputed amount",
      value: formatMoney(dispute.amount, dispute.currencyCode)
    },
    {
      label: "Fulfilment status",
      value: summary?.fulfillmentStatus ? humanise(summary.fulfillmentStatus) : null,
      missingReason: "Shopify has not reported a fulfilment status for this order."
    },
    {
      label: "Tracking",
      value:
        trackingList.length > 0 ? (
          <BlockStack gap="050">
            {trackingList.map((entry) => (
              <Text as="span" key={entry} variant="bodySm">
                {entry}
              </Text>
            ))}
          </BlockStack>
        ) : null,
      missingReason: hasShippingEvidence
        ? "No tracking number came through the order sync, but a shipping document is attached to this case."
        : "No tracking number on the order sync. Add the carrier and number in the response if you have it."
    },
    {
      label: "Reason given",
      value: getReasonProfile(dispute.reason).label
    }
  ];

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center" gap="200" wrap>
          <Text as="h2" id="case-facts-heading" variant="headingSm">
            Case facts
          </Text>
          <Badge tone={statusTone(dispute.status)}>{dispute.status.replaceAll("_", " ")}</Badge>
        </InlineStack>

        <BlockStack gap="100">
          <Text as="p" variant="bodyXs" tone="subdued">
            Shopify submits for you
          </Text>
          <DeadlineBadge dueBy={dispute.evidenceDueBy} now={now} />
        </BlockStack>

        <Divider />

        <dl className="case-facts">
          {facts.map((fact) => (
            <CaseFactRow fact={fact} key={fact.label} />
          ))}
        </dl>
      </BlockStack>
    </Card>
  );
}

/**
 * One tab, because there is one thing here that is not the response: the record
 * of the case. It stays a tab rather than becoming another card so the work and
 * the reference rail keep the top of the page to themselves.
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
  const adminOrderUrl = shopifyAdminOrderUrl(shopDomain, dispute.shopifyOrderId);
  const adminDisputeUrl = adminOrderUrl ?? shopifyAdminOrdersUrl(shopDomain);
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

  /**
   * Prefer the explicit prop, then the states the detail view already carries
   * (drafted server-side from the full order snapshot, so they hold the
   * shipping address the rail wants), and only then the local draft.
   */
  const fields =
    evidenceFields ?? (dispute.evidenceFields?.length ? dispute.evidenceFields : fallbackFields);

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

        {/*
          `alignItems="start"` is what makes the rail stick: a stretched grid
          item is as tall as the row, and a sticky box inside something already
          the height of its scroll container never moves. On xs the grid is one
          column and the rail falls below the work, which is the right order -
          the merchant meets the form before the footnotes.
        */}
        <InlineGrid alignItems="start" columns={{ xs: 1, md: ["twoThirds", "oneThird"] }} gap="400">
          <BlockStack gap="400">
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
          </BlockStack>

          {/*
            `tabIndex={0}` because the rail can become its own scroll container
            on a short window: a scrollable region with no focusable child is
            unreachable by keyboard in browsers that do not focus scrollers
            automatically. It is one extra stop on a labelled landmark, and it
            traps nothing - tab moves straight through into the page.
          */}
          <aside aria-labelledby="case-facts-heading" className="case-rail" tabIndex={0}>
            <CaseFactsRail
              adminOrderUrl={adminOrderUrl}
              dispute={dispute}
              fields={fields}
              now={now}
            />
          </aside>
        </InlineGrid>

        <Card padding="0">
          <Tabs onSelect={setSelectedTab} selected={selectedTab} tabs={TABS}>
            <Box padding="400">
              <BlockStack gap="400">
                {/*
                  The order and payment tables that used to open this panel are
                  gone: every figure in them is in the rail, next to the fields
                  that need it. What is left here is the record - what the
                  issuer said, what proof exists, what happened when.
                */}
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    Why the issuer says the charge is disputed
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    {dispute.reasonDetails ?? "No additional issuer context is available yet."}
                  </Text>
                </BlockStack>

                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">
                    Proof and packet
                  </Text>
                  <DataTable
                    columnContentTypes={["text", "text"]}
                    headings={["Field", "Value"]}
                    rows={[
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
