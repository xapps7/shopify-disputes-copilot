"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  Collapsible,
  Divider,
  InlineGrid,
  InlineStack,
  Page,
  Text
} from "@shopify/polaris";
import { useEffect, useMemo, useRef, useState } from "react";

import { Ce30Card } from "@/components/ce30-card";
import { DeadlineBadge, useNow } from "@/components/deadline-badge";
import { DisputeResponseDraft } from "@/components/dispute-response-draft";
import { DisputeStrategyCard } from "@/components/dispute-strategy-card";
import { COVERAGE_CRITERIA } from "@/lib/disputes/shopify-protect";
import type { EvidenceFileRef } from "@/components/evidence-file-slots";
import { GeneratePacketButton } from "@/components/generate-packet-button";
import { orderReference, orderReferenceNote } from "@/components/order-label";
import { OutcomeReviewForm } from "@/components/outcome-review-form";
import { ResponseBuilder } from "@/components/response-builder";
import { ShopifyFormGuide } from "@/components/shopify-form-guide";
import { ShopifySubmissionNotice } from "@/components/shopify-submission-notice";
import { SubmissionCenter } from "@/components/submission-center";
import { useShopDomain } from "@/components/use-shop-domain";
import { getReasonProfile } from "@/lib/disputes/reason-codes";
import { formatDate } from "@/lib/format/date";
import { formatMoney } from "@/lib/format/money";
import { shopifyAdminOrderUrl, shopifyAdminOrdersUrl } from "@/lib/format/shopify-admin";
// Only the type. The drafting functions are deliberately NOT imported here any
// more - see the note where the client-side fallback used to be.
import type { EvidenceFieldState } from "@/lib/disputes/evidence-fields";
import { buildEvidenceGapInsights } from "@/lib/disputes/workflow";
import type { AIPackageAssessmentView, DisputeDetailView, DisputeResponseDraftView } from "@/lib/types";

/**
 * One screen, one job: write the response before Shopify answers for you.
 *
 * The page carried four separate readiness scores - key fields ready, evidence
 * category coverage, packet quality, and an AI package score - with different
 * denominators, and a line of copy explaining why two of them disagreed. A
 * merchant cannot act on that, and cannot tell which one Shopify reads. Three
 * are gone; the one that survives counts the fields Shopify's form actually has.
 *
 * Also gone: an evidence checklist whose every item said "add this in the
 * response above", pointing a thousand pixels back up the page at the slot that
 * already takes the upload; a four-row table derivable from the list beneath it;
 * and a Tabs control with one tab.
 *
 * The research says consolidate rather than split. A merchant working a
 * chargeback queue is a repeat professional, not someone filling one form once,
 * and for that user a single grouped page beats a wizard (JMIR 2021: SUS 76 vs
 * 67, and the shortest completion time). GOV.UK writes the same exception into
 * its own one-thing-per-page rule.
 *
 * So: decide, write, send - three sections in the order the work happens, with
 * a sticky rail of case facts beside them. The record is collapsed, because it
 * is the only section holding no required field and nothing needed to finish.
 */

type DisputePageShellProps = {
  dispute: DisputeDetailView;
  responseDraft: DisputeResponseDraftView;
  packageAssessment: AIPackageAssessmentView;
  /**
   * Server-built field states (saved values merged over generated drafts).
   * Optional so this component keeps rendering while the persistence layer for
   * `/api/disputes/[id]/evidence-fields` lands; the fallbacks below prefer the
   * states already on the detail view, then draft from the order snapshot.
   */
  evidenceFields?: EvidenceFieldState[];
  /**
   * Whether the app writes the evidence text for this shop - the AUTO_DRAFT
   * capability in lib/billing/plans.ts, which the free plan does not include.
   *
   * OPTIONAL, AND DEFAULTED TO TRUE. The flag is being added to the dispute
   * detail object in a parallel change and is not on the view type yet; reading
   * it optionally means this file typechecks and renders correctly either way.
   * True is the safe default because the note it controls explains empty boxes:
   * showing it to a merchant whose boxes are full would be wrong, while not
   * showing it yet costs nothing.
   */
  canAutoDraft?: boolean;
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

export function DisputePageShell({
  dispute,
  responseDraft,
  packageAssessment,
  evidenceFields,
  canAutoDraft = true
}: DisputePageShellProps) {
  const searchParams = useSearchParams();
  const shopDomain = useShopDomain();
  const now = useNow();
  const submissionSectionRef = useRef<HTMLDivElement | null>(null);
  const [pendingSubmissionFocus, setPendingSubmissionFocus] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);

  const embeddedQuery = searchParams.toString();
  const disputesUrl = `/disputes${embeddedQuery ? `?${embeddedQuery}` : ""}`;
  const packetUrl = `/packets/${dispute.id}${embeddedQuery ? `?${embeddedQuery}` : ""}`;
  const settingsUrl = `/settings${embeddedQuery ? `?${embeddedQuery}` : ""}`;
  const adminOrderUrl = shopifyAdminOrderUrl(shopDomain, dispute.shopifyOrderId);
  const adminDisputeUrl = adminOrderUrl ?? shopifyAdminOrdersUrl(shopDomain);
  const recordedSubmissionAt = dispute.latestPacket?.submittedAt ?? dispute.evidenceSentOn ?? null;
  const disputeAmount = formatMoney(dispute.amount, dispute.currencyCode);
  const gapInsights = buildEvidenceGapInsights(dispute);
  const isLocked = dispute.lock.locked;

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

  /**
   * There is no client-side fallback any more, and that is the point.
   *
   * This used to rebuild the drafts in the browser whenever
   * `dispute.evidenceFields` looked empty - a second copy of the drafting logic,
   * shipped to every visitor, with no plan check on it. It never actually fired,
   * because the server always sends all ten fields. But drafting is a paid
   * feature now, and a paywall that depends on an array never being empty is one
   * truthiness change away from being decorative.
   *
   * The server decides what these fields contain, including whether the merchant
   * is entitled to a draft at all. The browser renders what it is given.
   */
  const fields = evidenceFields ?? dispute.evidenceFields ?? [];

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

  const orderTitle = orderReference(dispute.orderSummary?.orderName ?? null, dispute.shopifyOrderId);

  return (
    <Page
      title={`${orderTitle} · ${disputeAmount}`}
      subtitle={`${getReasonProfile(dispute.reason).label} · dispute ${dispute.shopifyDisputeId.split("/").pop()}`}
      backAction={{ content: "Disputes", url: disputesUrl }}
      primaryAction={
        isLocked
          ? undefined
          : {
              content: "Record submission",
              onAction: goToRecordSubmission
            }
      }
      secondaryActions={[
        ...(adminDisputeUrl
          ? [{ content: "Open order in Shopify Admin", url: adminDisputeUrl, external: true }]
          : []),
        ...(dispute.latestPacket
          ? [
              {
                content: "Download packet",
                url: `/api/disputes/${dispute.id}/packet/download`,
                external: true
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

        <InlineGrid alignItems="start" columns={{ xs: 1, md: ["twoThirds", "oneThird"] }} gap="400">
          <BlockStack gap="400">
            {/* Decide -> write -> send. Three sections, in the order the work happens. */}
            <DisputeStrategyCard strategy={dispute.strategy} />

            {/*
              Directly under the strategy card, because it qualifies it: the
              strategy card weighs the money, and this is the one case where a
              win is worth more than the money - CE 3.0 also takes the dispute
              off the fraud ratio. Null for anything that is not a Visa 10.4
              claim, so a duplicate-charge dispute never sees a Visa verdict.
            */}
            {dispute.ce30 ? <Ce30Card ce30={dispute.ce30} /> : null}

            {/*
              Shopify Protect, only when it says something. Silent for every
              merchant outside the US, where Protect never applies and a
              permanent "not covered" badge would imply a loss that was never
              possible.
            */}
            {dispute.protect ? (
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
                    <Text as="h2" variant="headingSm">
                      {dispute.protect.headline}
                    </Text>
                    <Badge
                      tone={
                        dispute.protect.tone === "success"
                          ? "success"
                          : dispute.protect.tone === "warning"
                            ? "warning"
                            : "info"
                      }
                    >
                      Shopify Protect
                    </Badge>
                  </InlineStack>

                  <Text as="p" variant="bodyMd">
                    {dispute.protect.detail}
                  </Text>

                  {dispute.protect.showCriteria ? (
                    <BlockStack gap="150">
                      <Text as="h3" variant="headingSm">
                        What coverage requires
                      </Text>
                      {/*
                        Shopify returns a status and NOT a reason - there is no
                        field saying which requirement was missed. So this is a
                        checklist to compare against the order, never a diagnosis.
                      */}
                      <BlockStack gap="050">
                        {COVERAGE_CRITERIA.map((criterion) => (
                          <Text as="p" variant="bodySm" key={criterion} tone="subdued">
                            {`\u00b7 ${criterion}`}
                          </Text>
                        ))}
                      </BlockStack>
                    </BlockStack>
                  ) : null}
                </BlockStack>
              </Card>
            ) : null}

            {/*
              Why the evidence boxes below are empty, said once, next to them.

              A merchant on the free plan opens this page, sees blank fields
              where the app clearly intends to put text, and concludes the app
              is broken - which is a support ticket and a one-star review, not a
              sale. So this is stated calmly and factually, and it is a card
              rather than a Banner: banners on this page are for things that
              have gone wrong, and a plan is not an incident. It also says what
              is NOT affected, because nothing here is withheld except the
              typing.
            */}
            {canAutoDraft ? null : (
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingSm">
                    These boxes start empty on the free plan
                  </Text>
                  <Text as="p" variant="bodyMd">
                    Pro writes a first draft of these for you from your order data. On the free plan you write
                    them yourself; everything else here is unchanged - the deadline, the eligibility check, the
                    files you upload, and the money on this case.
                  </Text>
                  <Text as="p" variant="bodyMd">
                    <Link className="table-link" href={settingsUrl as never}>
                      See plans in Settings
                    </Link>
                  </Text>
                </BlockStack>
              </Card>
            )}

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
              standingDocuments={dispute.standingDocuments ?? []}
            />

            {/*
              Placed after the builder rather than before it: a merchant who has
              just prepared four slots is exactly the person who benefits from
              being told which four Shopify fills in for them, and putting it
              first would read as more work rather than less.
            */}
            <ShopifyFormGuide />

            <DisputeResponseDraft
              disputeId={dispute.id}
              initialAssessment={packageAssessment}
              initialDraft={responseDraft}
            />

            {/*
              One hand-off surface, not two. The warning that this app cannot
              press Submit for you lives HERE, beside the action it qualifies,
              rather than as a permanent wall above the form. A warning that is
              always on screen stops being read - the same reason NN/g rations
              confirmation dialogs.
            */}
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Send it, then record it
                </Text>

                <ShopifySubmissionNotice
                  shopDomain={shopDomain}
                  shopifyDisputeId={dispute.shopifyDisputeId}
                  shopifyOrderId={dispute.shopifyOrderId}
                  recordedAt={recordedSubmissionAt}
                />

                <div id="record-submission" ref={submissionSectionRef} tabIndex={-1}>
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
                      packetReady={Boolean(dispute.latestPacket)}
                      packetStatus={dispute.latestPacket?.status ?? null}
                      shopDomain={shopDomain}
                      shopifyDisputeId={dispute.shopifyDisputeId}
                      shopifyOrderId={dispute.shopifyOrderId}
                      submittedAt={dispute.latestPacket?.submittedAt ?? null}
                    />
                  )}
                </div>

                <Divider />

                {/*
                  The packet is an archive, not the deliverable - Shopify's form
                  is. It gets a link, not a section of its own.
                */}
                <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
                  <Text as="p" variant="bodySm" tone="subdued">
                    A PDF copy for your own records, and one you can attach to your Shopify response.
                  </Text>
                  <InlineStack gap="300" wrap>
                    <Link className="table-link" href={packetUrl as never}>
                      Preview packet
                    </Link>
                    {isLocked ? null : <GeneratePacketButton disputeId={dispute.id} />}
                  </InlineStack>
                </InlineStack>
              </BlockStack>
            </Card>

            {/*
              The record, collapsed. The only section on this page safe to hide:
              it holds no required field and nothing here is needed to finish the
              response. Baymard's testing is blunt about the risk otherwise -
              participants "repeatedly overlook core page content" behind tabs,
              including while actively looking for it.
            */}
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
                  <Text as="h2" variant="headingMd">
                    Case record
                  </Text>
                  <Button
                    ariaExpanded={recordOpen}
                    ariaControls="case-record-panel"
                    disclosure={recordOpen ? "up" : "down"}
                    onClick={() => setRecordOpen((open) => !open)}
                    variant="tertiary"
                  >
                    {recordOpen ? "Hide" : "Show"}
                  </Button>
                </InlineStack>

                <Collapsible id="case-record-panel" open={recordOpen}>
                  <BlockStack gap="400">
                    <BlockStack gap="100">
                      <Text as="h3" variant="headingSm">
                        Why the issuer says the charge is disputed
                      </Text>
                      <Text as="p" variant="bodyMd" tone="subdued">
                        {dispute.reasonDetails ?? "No additional issuer context is available yet."}
                      </Text>
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
                          Uploads, packet generation, sync updates, and recorded submissions appear here as they
                          happen.
                        </Text>
                      )}
                    </BlockStack>

                    <Divider />

                    <OutcomeReviewForm
                      currentStatus={dispute.status}
                      disputeId={dispute.id}
                      recommendations={dispute.recommendations}
                    />
                  </BlockStack>
                </Collapsible>
              </BlockStack>
            </Card>
          </BlockStack>

          <aside aria-labelledby="case-facts-heading" className="case-rail" tabIndex={0}>
            <CaseFactsRail adminOrderUrl={adminOrderUrl} dispute={dispute} fields={fields} now={now} />
          </aside>
        </InlineGrid>
      </BlockStack>
    </Page>
  );
}
