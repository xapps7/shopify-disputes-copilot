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
import { DeadlineBadge, describeAutoSubmit, useNow } from "@/components/deadline-badge";
import { EMPTY_STATE_IMAGE } from "@/components/empty-state-image";
import { orderReference } from "@/components/order-label";
import { SyncStatusBanner, useDisputeSync } from "@/components/sync-status";
import { getReasonProfile } from "@/lib/disputes/reason-codes";
import { formatCurrencyTotals, formatMoney, sumByCurrency } from "@/lib/format/money";
import { formatDate } from "@/lib/format/date";
import type { DashboardDispute, OverviewMetricsView, PreventionRecommendationView } from "@/lib/types";

/**
 * "What needs you today", not a dashboard.
 *
 * A merchant opening this app has exactly one question: what needs me? A table
 * answers that at a glance; a stack of cards makes them read three headlines
 * before they can see a single case. So the queue leads, full width, directly
 * under the title, with the disputes Shopify is about to answer for banded to
 * the top of it.
 *
 * The counts that used to occupy two large cards are one thin strip. They are
 * context for the table, not a destination - nobody has ever done anything
 * differently because a number was rendered at 32px instead of 16px.
 */

type OverviewDispute = DashboardDispute & { orderName?: string | null };

type OverviewPageShellProps = {
  metrics: OverviewMetricsView;
  recentDisputes: OverviewDispute[];
  recommendations: PreventionRecommendationView[];
};

const CLOSED_STATUSES = new Set(["WON", "LOST", "ACCEPTED", "CLOSED", "CHARGE_REFUNDED"]);

/** The queue here is a preview; the full list lives on Disputes. */
const MAX_ROWS = 8;

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

/** One figure in the strip. Label under value, both small - this is not a KPI wall. */
function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <BlockStack gap="050">
      <Text as="p" variant="headingMd">
        {value}
      </Text>
      <Text as="p" variant="bodyXs" tone="subdued">
        {label}
      </Text>
    </BlockStack>
  );
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

  /**
   * Two bands, urgent first, so the rows Shopify is about to answer for cannot
   * be scrolled past. Pre-mount there is no clock, so everything sits in one
   * neutral band rather than being labelled with an urgency nobody has measured
   * yet — the same approach the dispute queue takes.
   */
  const bands = useMemo(() => {
    if (now === null) {
      return [
        {
          key: "open",
          title: "Open disputes",
          description: "Soonest auto-submit first.",
          rows: openDisputes.slice(0, MAX_ROWS)
        }
      ];
    }

    const urgentRows = urgent.slice(0, MAX_ROWS);
    const restRows = rest.slice(0, Math.max(0, MAX_ROWS - urgentRows.length));

    return [
      {
        key: "urgent",
        title: "Needs you today · auto-submits within 48 hours",
        description: `${urgentAtRisk} at risk. Shopify submits whatever it holds on these.`,
        rows: urgentRows
      },
      {
        key: "later",
        title: "Coming up",
        description: "Time to build a real response.",
        rows: restRows
      }
    ].filter((band) => band.rows.length > 0);
  }, [now, openDisputes, rest, urgent, urgentAtRisk]);

  const visibleCount = bands.reduce((total, band) => total + band.rows.length, 0);

  /**
   * Subheaders and data rows share one `position` sequence: Polaris uses it for
   * focus order, so a gap or a repeat breaks keyboard navigation through the
   * table.
   */
  const tableRows: React.ReactNode[] = [];
  let position = 0;

  for (const band of bands) {
    tableRows.push(
      <IndexTable.Row id={`band-${band.key}`} key={`band-${band.key}`} position={position} rowType="subheader">
        <IndexTable.Cell as="th" colSpan={5} id={`band-heading-${band.key}`} scope="colgroup">
          <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
            <Text as="span" variant="headingSm">
              {`${band.title} (${band.rows.length})`}
            </Text>
            <Text as="span" variant="bodySm" tone="subdued">
              {band.description}
            </Text>
          </InlineStack>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
    position += 1;

    for (const dispute of band.rows) {
      const readiness = readinessLabel(dispute.completenessScore);
      const isUrgent = band.key === "urgent";

      tableRows.push(
        <IndexTable.Row id={dispute.id} key={dispute.id} position={position}>
          <IndexTable.Cell>
            <BlockStack gap="050">
              <Link className="table-link" href={disputeUrl(dispute.id) as never}>
                {orderReference(dispute.orderName, dispute.shopifyOrderId)}
              </Link>
              {/* The word, not just the tone: "urgent" has to survive greyscale. */}
              {isUrgent ? (
                <Text as="span" variant="bodyXs" tone="critical" fontWeight="medium">
                  Needs you today
                </Text>
              ) : null}
            </BlockStack>
          </IndexTable.Cell>
          <IndexTable.Cell>
            <DeadlineBadge dueBy={dispute.evidenceDueBy} now={now} />
          </IndexTable.Cell>
          <IndexTable.Cell>{getReasonProfile(dispute.reason).label}</IndexTable.Cell>
          <IndexTable.Cell>
            <Text as="span" variant="bodyMd" fontWeight="medium">
              {formatMoney(dispute.amount, dispute.currencyCode)}
            </Text>
          </IndexTable.Cell>
          <IndexTable.Cell>
            <Badge tone={readiness.tone}>{readiness.label}</Badge>
          </IndexTable.Cell>
        </IndexTable.Row>
      );
      position += 1;
    }
  }

  return (
    <AdminPageLayout
      title="Disputes Co-Pilot"
      subtitle="What Shopify is about to send on your behalf, and how long you have to change it."
      primaryAction={{ content: "Open the dispute queue", url: disputesUrl }}
      secondaryActions={[
        { content: "Open evidence library", url: evidenceUrl },
        { content: isSyncing ? "Syncing disputes..." : "Sync disputes", onAction: runSync, disabled: isSyncing }
      ]}
      gap="300"
    >
      <BlockStack gap="300">
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
        ) : (
          <>
            {/*
              The strip. Three figures, one row, above the table because they
              frame it: how much is exposed, how many cases, and how many of
              them Shopify answers for inside two days.
            */}
            <Card padding="300">
              <InlineStack align="start" blockAlign="center" gap="800" wrap>
                <MetricCell label="Total at risk across open disputes" value={totalAtRisk} />
                <MetricCell label="Open disputes" value={String(metrics.openDisputes)} />
                <MetricCell
                  label="Auto-submitting within 48 hours"
                  value={now === null ? "—" : `${urgent.length}${urgent.length > 0 ? ` · ${urgentAtRisk}` : ""}`}
                />
              </InlineStack>
            </Card>

            <Card padding="0">
              <Box padding="300" paddingInlineStart="400">
                <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
                  <Text as="h2" variant="headingMd">
                    {now !== null && urgent.length > 0
                      ? urgent.length === 1
                        ? "1 dispute needs you today"
                        : `${urgent.length} disputes need you today`
                      : "Your queue, soonest auto-submit first"}
                  </Text>
                  <Link className="table-link" href={disputesUrl as never}>
                    {openDisputes.length > visibleCount
                      ? `View all ${openDisputes.length} disputes`
                      : "View all disputes"}
                  </Link>
                </InlineStack>
              </Box>
              <Divider />

              <IndexTable
                headings={[
                  { title: "Order" },
                  { title: "Shopify sends" },
                  { title: "Reason" },
                  { title: "Amount at risk", alignment: "end" },
                  { title: "Your response" }
                ]}
                itemCount={visibleCount}
                selectable={false}
              >
                {tableRows}
              </IndexTable>
            </Card>

            {now !== null && urgent.length === 0 ? (
              <Text as="p" variant="bodySm" tone="subdued">
                {nextDeadline
                  ? `Nothing auto-submits in the next 48 hours. The soonest is ${orderReference(
                      nextDeadline.orderName,
                      nextDeadline.shopifyOrderId
                    )} on ${formatDate(nextDeadline.evidenceDueBy, { fallback: "an unpublished date" })}.`
                  : "Nothing auto-submits in the next 48 hours, and none of your open disputes has a published deadline yet."}
              </Text>
            ) : null}
          </>
        )}

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
