"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import {
  Badge,
  BlockStack,
  Box,
  Card,
  Divider,
  EmptyState,
  IndexTable,
  InlineStack,
  Text
} from "@shopify/polaris";

import { AdminPageLayout } from "@/components/admin-page-layout";
import { AutoSubmitCountdown, DeadlineBadge, describeAutoSubmit, useNow } from "@/components/deadline-badge";
import { EMPTY_STATE_IMAGE } from "@/components/empty-state-image";
import { ResourceSection } from "@/components/resource-section";
import { SyncStatusBanner, useDisputeSync } from "@/components/sync-status";
import { getReasonProfile } from "@/lib/disputes/reason-codes";
import { formatCurrencyTotals, formatMoney, sumByCurrency } from "@/lib/format/money";
import { formatDate } from "@/lib/format/date";
import type { DashboardDispute, OverviewMetricsView, PreventionRecommendationView } from "@/lib/types";

/**
 * "What needs you today", not a dashboard.
 *
 * Shopify never tells a merchant a dispute exists, and submits a response for
 * them at the deadline regardless. So the only thing worth the top of this
 * screen is: is Shopify about to speak for you, and on how much money. Counts
 * that do not change what anyone does today have been removed rather than
 * shrunk.
 */

type OverviewDispute = DashboardDispute & { orderName?: string | null };

type OverviewPageShellProps = {
  metrics: OverviewMetricsView;
  recentDisputes: OverviewDispute[];
  recommendations: PreventionRecommendationView[];
};

const CLOSED_STATUSES = new Set(["WON", "LOST", "ACCEPTED", "CLOSED", "CHARGE_REFUNDED"]);

/** How many countdowns the lead card shows before deferring to the queue. */
const MAX_LEAD_COUNTDOWNS = 4;

function orderLabel(dispute: OverviewDispute): string {
  if (dispute.orderName?.trim()) {
    return dispute.orderName.trim();
  }

  const orderNumber = dispute.shopifyOrderId?.split("/").pop();
  return orderNumber ? `Order ${orderNumber}` : "Order unavailable";
}

function toTimestamp(value: string | null): number {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

function readinessLabel(score: number): { label: string; tone: "success" | "warning" | "critical" } {
  if (score >= 75) return { label: `Ready · ${score}%`, tone: "success" };
  if (score >= 50) return { label: `Half built · ${score}%`, tone: "warning" };
  return { label: `Thin · ${score}%`, tone: "critical" };
}

export function OverviewPageShell({ metrics, recentDisputes, recommendations }: OverviewPageShellProps) {
  const searchParams = useSearchParams();
  const now = useNow();
  const { isSyncing, result: syncResult, runSync } = useDisputeSync();
  const embeddedQuery = searchParams.toString();
  const disputesUrl = `/disputes${embeddedQuery ? `?${embeddedQuery}` : ""}`;
  const evidenceUrl = `/evidence${embeddedQuery ? `?${embeddedQuery}` : ""}`;
  const disputeUrl = (id: string) => `/disputes/${id}${embeddedQuery ? `?${embeddedQuery}` : ""}`;

  /** Soonest auto-submit first — the only order that matters here. */
  const openDisputes = useMemo(
    () =>
      recentDisputes
        .filter((dispute) => !CLOSED_STATUSES.has(dispute.status))
        .sort((a, b) => toTimestamp(a.evidenceDueBy) - toTimestamp(b.evidenceDueBy)),
    [recentDisputes]
  );

  const urgent = useMemo(
    () =>
      now === null
        ? []
        : openDisputes.filter((dispute) => describeAutoSubmit(dispute.evidenceDueBy, now).isUrgent),
    [now, openDisputes]
  );

  const urgentIds = useMemo(() => new Set(urgent.map((dispute) => dispute.id)), [urgent]);
  const rest = useMemo(() => openDisputes.filter((dispute) => !urgentIds.has(dispute.id)), [openDisputes, urgentIds]);

  // Mixed currencies are never added together: "$1,240.00 + €310.00" is the
  // only honest way to state a total across them.
  const totalAtRisk = useMemo(() => formatCurrencyTotals(sumByCurrency(openDisputes)), [openDisputes]);
  const urgentAtRisk = useMemo(() => formatCurrencyTotals(sumByCurrency(urgent)), [urgent]);

  const nextDeadline = openDisputes.find((dispute) => dispute.evidenceDueBy) ?? null;

  // Pre-mount the clock is unreadable, so the lead shows the soonest deadlines
  // as plain dates and upgrades to urgency language once `useNow()` resolves.
  const leadDisputes = now === null ? openDisputes.slice(0, MAX_LEAD_COUNTDOWNS) : urgent.slice(0, MAX_LEAD_COUNTDOWNS);
  const isAllClear = now !== null && urgent.length === 0;

  return (
    <AdminPageLayout
      title="Disputes Co-Pilot"
      subtitle="What Shopify is about to send on your behalf, and how long you have to change it."
      primaryAction={{ content: "Open the dispute queue", url: disputesUrl }}
      secondaryActions={[
        { content: "Open evidence library", url: evidenceUrl },
        { content: isSyncing ? "Syncing disputes..." : "Sync disputes", onAction: runSync, disabled: isSyncing }
      ]}
      gap="400"
    >
      <BlockStack gap="400">
        <SyncStatusBanner result={syncResult} />

        {openDisputes.length === 0 ? (
          <Card>
            <Box padding="400">
              <EmptyState
                heading="No open disputes"
                image={EMPTY_STATE_IMAGE}
                action={{ content: "Sync disputes", onAction: runSync, loading: isSyncing }}
              >
                <p>
                  Nothing is waiting on you. Shopify does not notify you when a chargeback opens, so sync
                  regularly — the deadline clock starts without warning.
                </p>
              </EmptyState>
            </Box>
          </Card>
        ) : isAllClear ? (
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingLg">
                Nothing auto-submits in the next 48 hours
              </Text>
              <Text as="p" variant="bodyMd">
                {nextDeadline
                  ? `The soonest is ${orderLabel(nextDeadline)} on ${formatDate(nextDeadline.evidenceDueBy, {
                      fallback: "an unpublished date"
                    })}. You have time to write a real response instead of letting Shopify send tracking data and nothing else.`
                  : "None of your open disputes has a published deadline yet. They will appear here the moment Shopify sets one."}
              </Text>
              <InlineStack>
                <Link className="table-link" href={disputesUrl as never}>
                  Open the dispute queue
                </Link>
              </InlineStack>
            </BlockStack>
          </Card>
        ) : (
          <Card>
            <BlockStack gap="300">
              <BlockStack gap="100">
                <Text as="h2" variant="headingLg">
                  {now === null
                    ? "Your soonest auto-submit deadlines"
                    : urgent.length === 1
                      ? "1 dispute needs you today"
                      : `${urgent.length} disputes need you today`}
                </Text>
                <Text as="p" variant="bodyMd">
                  {now === null
                    ? "Shopify submits a response on each of these dates using whatever it holds."
                    : `${urgentAtRisk} at risk. Shopify submits on these within 48 hours whether or not you have written anything.`}
                </Text>
              </BlockStack>

              <BlockStack gap="300">
                {leadDisputes.map((dispute) => (
                  <AutoSubmitCountdown
                    dueBy={dispute.evidenceDueBy}
                    key={dispute.id}
                    now={now}
                    action={
                      <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
                        <Link className="table-link" href={disputeUrl(dispute.id) as never}>
                          {`Work on ${orderLabel(dispute)} — ${formatMoney(dispute.amount, dispute.currencyCode)}`}
                        </Link>
                        <Text as="span" variant="bodySm" tone="subdued">
                          {getReasonProfile(dispute.reason).label}
                        </Text>
                      </InlineStack>
                    }
                  />
                ))}
              </BlockStack>

              {leadDisputes.length < urgent.length ? (
                <Link className="table-link" href={disputesUrl as never}>
                  {`See all ${urgent.length} in the queue`}
                </Link>
              ) : null}
            </BlockStack>
          </Card>
        )}

        <Card>
          <InlineStack align="space-between" blockAlign="start" gap="400" wrap>
            <BlockStack gap="050">
              <Text as="p" variant="headingLg">
                {totalAtRisk}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Total at risk across open disputes
              </Text>
            </BlockStack>
            <BlockStack gap="050">
              <Text as="p" variant="headingLg">
                {String(metrics.openDisputes)}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Open disputes
              </Text>
            </BlockStack>
            <BlockStack gap="050" inlineAlign="end">
              <Link className="table-link" href={disputesUrl as never}>
                Open the dispute queue
              </Link>
              <Text as="p" variant="bodySm" tone="subdued">
                Sorted by soonest auto-submit
              </Text>
            </BlockStack>
          </InlineStack>
        </Card>

        {rest.length > 0 ? (
          <ResourceSection
            title="Coming up"
            action={
              <Link className="table-link" href={disputesUrl as never}>
                View all disputes
              </Link>
            }
            flush
          >
            <IndexTable
              headings={[
                { title: "Order" },
                { title: "Shopify sends" },
                { title: "Reason" },
                { title: "Amount at risk", alignment: "end" },
                { title: "Your response" }
              ]}
              itemCount={Math.min(rest.length, 5)}
              selectable={false}
            >
              {rest.slice(0, 5).map((dispute, index) => {
                const readiness = readinessLabel(dispute.completenessScore);

                return (
                  <IndexTable.Row id={dispute.id} key={dispute.id} position={index}>
                    <IndexTable.Cell>
                      <Link className="table-link" href={disputeUrl(dispute.id) as never}>
                        {orderLabel(dispute)}
                      </Link>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <DeadlineBadge dueBy={dispute.evidenceDueBy} now={now} />
                    </IndexTable.Cell>
                    <IndexTable.Cell>{getReasonProfile(dispute.reason).label}</IndexTable.Cell>
                    <IndexTable.Cell>{formatMoney(dispute.amount, dispute.currencyCode)}</IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge tone={readiness.tone}>{readiness.label}</Badge>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                );
              })}
            </IndexTable>
          </ResourceSection>
        ) : null}

        {recommendations.length > 0 ? (
          <Card>
            <BlockStack gap="150">
              <Text as="h2" variant="headingSm">
                Prevention insights
              </Text>
              {recommendations.slice(0, 2).map((item, index) => (
                <Box key={item.id}>
                  <BlockStack gap="050">
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      {item.category.replaceAll("_", " ")}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {item.recommendationText}
                    </Text>
                  </BlockStack>
                  {index < Math.min(recommendations.length, 2) - 1 ? <Divider /> : null}
                </Box>
              ))}
            </BlockStack>
          </Card>
        ) : null}
      </BlockStack>
    </AdminPageLayout>
  );
}
