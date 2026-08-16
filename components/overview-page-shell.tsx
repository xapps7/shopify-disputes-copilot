"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  EmptyState,
  InlineGrid,
  InlineStack,
  Text
} from "@shopify/polaris";

import { AdminPageLayout } from "@/components/admin-page-layout";
import { DeadlineBadge, useNow } from "@/components/deadline-badge";
import { EMPTY_STATE_IMAGE } from "@/components/empty-state-image";
import { orderReference } from "@/components/order-label";
import { SyncStatusBanner, useDisputeSync } from "@/components/sync-status";
import { describeConfidence } from "@/lib/economics/win-probability";
import { formatMoney } from "@/lib/format/money";
import { formatDateTime } from "@/lib/format/date";
import type { TodayView } from "@/lib/disputes/today";

/**
 * Today answers three questions the dispute queue structurally cannot:
 * what changed while you were gone, what is the one thing to do now, and how
 * much of the money in play is actually gettable.
 *
 * It contains NO rows from the queue. The previous version rendered the first
 * eight rows of /disputes above a strip of counts, which is why the two screens
 * were indistinguishable - every figure on it could be counted off the table
 * directly beneath it. Stephen Few's test for whether a summary earns its place
 * is whether it CONSOLIDATES; a count of rows sitting above those rows does not.
 *
 * The structure follows the epicenter: the single most consequential decision
 * available right now leads, at full width. Everything else is context for it.
 */

type OverviewPageShellProps = {
  today: TodayView;
};

function relativeTime(iso: string | null, now: number | null): string | null {
  if (!iso || now === null) {
    return null;
  }

  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 0) return "just now";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * A figure that earns its place: a value, and the comparative that makes it
 * mean something. Few's second pitfall is stating a number with no context -
 * "compared to what? Is this good or bad?"
 */
function Measure({
  label,
  value,
  context,
  tone
}: {
  label: string;
  value: string;
  context: string;
  tone?: "critical" | "success" | "subdued";
}) {
  return (
    <BlockStack gap="100">
      <Text as="p" variant="bodySm" tone="subdued">
        {label}
      </Text>
      <Text as="p" variant="headingLg" tone={tone === "subdued" ? "subdued" : tone}>
        {value}
      </Text>
      <Text as="p" variant="bodySm" tone="subdued">
        {context}
      </Text>
    </BlockStack>
  );
}

export function OverviewPageShell({ today }: OverviewPageShellProps) {
  const searchParams = useSearchParams();
  const now = useNow();
  const { isSyncing, result: syncResult, runSync } = useDisputeSync();

  const embeddedQuery = searchParams.toString();
  const withQuery = (path: string) => `${path}${embeddedQuery ? `?${embeddedQuery}` : ""}`;
  const stageUrl = (stage: string) =>
    `/disputes${embeddedQuery ? `?${embeddedQuery}&stage=${stage}` : `?stage=${stage}`}`;

  const syncedLabel = relativeTime(today.lastSyncedAt, now);

  const primaryTotals = today.portfolio[0] ?? null;
  const atRisk = useMemo(
    () =>
      today.portfolio.length === 0
        ? null
        : today.portfolio
            .map((entry) => formatMoney(entry.atRisk, entry.currencyCode))
            .join(" + "),
    [today.portfolio]
  );
  const recoverable = useMemo(
    () =>
      today.portfolio.length === 0
        ? null
        : today.portfolio
            .map((entry) => formatMoney(entry.recoverable, entry.currencyCode))
            .join(" + "),
    [today.portfolio]
  );

  const worthFighting = today.portfolio.reduce((sum, entry) => sum + entry.worthFighting, 0);
  const openCount = today.portfolio.reduce((sum, entry) => sum + entry.count, 0);

  const next = today.nextAction;

  return (
    <AdminPageLayout
      title="Today"
      subtitle="What Shopify is about to send on your behalf, and how long you have to change it."
      primaryAction={{
        content: isSyncing ? "Syncing…" : "Sync disputes",
        onAction: runSync,
        loading: isSyncing
      }}
      secondaryActions={[{ content: "Open the queue", url: "/disputes" }]}
      gap="400"
    >
      <BlockStack gap="400">
        {/*
          Built for Shopify 4.2.3: "Your homepage should clearly indicate if the
          app is set up and working." One line, not a card - this is a reassurance,
          not a destination.
        */}
        <Text as="p" variant="bodySm" tone="subdued">
          {[
            syncedLabel ? `Synced ${syncedLabel}` : "Not synced yet",
            `${today.totalTracked} dispute${today.totalTracked === 1 ? "" : "s"} tracked`,
            today.awaitingYou > 0
              ? `${today.awaitingYou} waiting on you`
              : "nothing waiting on you"
          ].join(" · ")}
        </Text>

        {/* One banner maximum, per BFS 4.3.4. Sync failure outranks everything. */}
        {today.lastSyncError && !syncResult ? (
          <Banner tone="warning" title="The last sync did not complete cleanly">
            <p>{today.lastSyncError}</p>
          </Banner>
        ) : (
          <SyncStatusBanner result={syncResult} />
        )}

        {/* ---------- The epicenter ---------- */}
        {next ? (
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="start" gap="400" wrap>
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">
                    Do this next
                  </Text>
                  <Text as="h2" variant="headingLg">
                    {orderReference(next.orderName, next.shopifyOrderId)} ·{" "}
                    {formatMoney(next.amount, next.currencyCode)}
                  </Text>
                  <InlineStack gap="200" blockAlign="center" wrap>
                    <Badge>{next.reasonLabel}</Badge>
                    <DeadlineBadge dueBy={next.evidenceDueBy} now={now} />
                  </InlineStack>
                </BlockStack>
                <Button variant="primary" url={withQuery(`/disputes/${next.id}`)}>
                  Build the response
                </Button>
              </InlineStack>

              <Text as="p" variant="bodyMd">
                {next.theQuestion}
              </Text>

              <Divider />

              <InlineGrid columns={{ xs: 1, md: "1fr 1fr" }} gap="400">
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">
                    {next.strategy.headline}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {`Estimated ${Math.round(next.strategy.win.probability * 100)}% chance of winning (${Math.round(
                      next.strategy.win.low * 100
                    )}–${Math.round(next.strategy.win.high * 100)}%). ${describeConfidence(next.strategy.win)}`}
                  </Text>
                  {next.strategy.reasons.slice(0, 2).map((reason) => (
                    <Text as="p" variant="bodySm" key={reason}>
                      {reason}
                    </Text>
                  ))}
                </BlockStack>

                <BlockStack gap="200">
                  {/*
                    Named gaps, not a percentage. Stripe's recommended_evidence
                    does this and it is the best pattern in the category: "add a
                    tracking number" is actionable in a way "40% complete" is not.
                  */}
                  <Text as="h3" variant="headingSm">
                    {next.missingEvidence.length === 0
                      ? "Nothing missing"
                      : `Still missing (${next.missingEvidence.length})`}
                  </Text>
                  {next.missingEvidence.length === 0 ? (
                    <Text as="p" variant="bodySm" tone="subdued">
                      Every item this reason code needs is attached.
                    </Text>
                  ) : (
                    <BlockStack gap="100">
                      {next.missingEvidence.map((item) => (
                        <Text as="p" variant="bodySm" key={item}>
                          {`· ${item}`}
                        </Text>
                      ))}
                    </BlockStack>
                  )}
                </BlockStack>
              </InlineGrid>
            </BlockStack>
          </Card>
        ) : today.totalTracked === 0 ? (
          <Card>
            <Box padding="400">
              {/*
                First-run, not no-results. GitLab separates these deliberately:
                telling a merchant with 400 records to "create your first record"
                is the classic bug from merging them.
              */}
              <EmptyState
                heading="No disputes yet"
                image={EMPTY_STATE_IMAGE}
                action={{ content: "Sync disputes", onAction: runSync, loading: isSyncing }}
              >
                <p>
                  Shopify does not notify you when a chargeback opens, and it answers on your behalf when the
                  deadline passes. Syncing is what puts that deadline somewhere you can see it.
                </p>
              </EmptyState>
            </Box>
          </Card>
        ) : (
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Nothing is waiting on you
              </Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                {today.nextDeadline
                  ? `Every open dispute has had its response built. The next one Shopify sends is ${today.nextDeadline.orderLabel}, on ${formatDateTime(today.nextDeadline.evidenceDueBy, { fallback: "an unpublished date" })}.`
                  : "Every open dispute has had its response built, and none of them has a published deadline yet."}
              </Text>
            </BlockStack>
          </Card>
        )}

        {/* ---------- Money and pipeline ---------- */}
        {openCount > 0 || today.netRecovery.decidedCount > 0 ? (
          <InlineGrid columns={{ xs: 1, md: "2fr 1fr" }} gap="400">
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  The money
                </Text>

                <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
                  <Measure
                    label="At risk right now"
                    value={atRisk ?? "—"}
                    context={`Across ${openCount} open dispute${openCount === 1 ? "" : "s"}.`}
                  />
                  <Measure
                    label="Realistically recoverable"
                    value={recoverable ?? "—"}
                    context={
                      worthFighting === 0
                        ? "None of these are worth the fee and the effort."
                        : `${worthFighting} of ${openCount} worth fighting, after fees and the odds.`
                    }
                    tone="success"
                  />
                </InlineGrid>

                <Divider />

                {/*
                  Net recovery rate: money returned over money EVER disputed,
                  including the cases nobody contested. The industry quotes win
                  rate, which counts only the cases you chose to fight - 44.6%
                  first-cycle against a net recovery of about 10.7%. Nobody in
                  the category shows the honest one.
                */}
                <BlockStack gap="100">
                  <Text as="h3" variant="headingSm">
                    Net recovery rate
                  </Text>
                  {today.netRecovery.rate === null ? (
                    <Text as="p" variant="bodySm" tone="subdued">
                      {`${today.netRecovery.decidedCount} dispute${today.netRecovery.decidedCount === 1 ? "" : "s"} decided so far. This needs at least 10 before the number means anything, so it is withheld rather than shown as a confident figure built on nothing.`}
                    </Text>
                  ) : (
                    <BlockStack gap="100">
                      <Text as="p" variant="headingLg">
                        {`${Math.round(today.netRecovery.rate * 100)}%`}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {`Of every ${formatMoney(100, today.netRecovery.disputedTotals[0]?.currencyCode ?? null)} disputed, you have kept ${formatMoney(
                          Math.round(today.netRecovery.rate * 100),
                          today.netRecovery.disputedTotals[0]?.currencyCode ?? null
                        )}. This counts disputes nobody contested, so it runs well below a win rate — the published industry average is about 10%.`}
                      </Text>
                    </BlockStack>
                  )}
                </BlockStack>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Where the work is
                </Text>

                {/*
                  Stage counts as doorways, not decoration. A tile that is not
                  obviously a link into a filtered view emits no information
                  scent and gets ignored.
                */}
                <BlockStack gap="0">
                  {today.stages.map((stage, index) => (
                    <Box key={stage.stage}>
                      {index > 0 ? <Divider /> : null}
                      <Box paddingBlock="200">
                        <InlineStack align="space-between" blockAlign="center" gap="200">
                          {stage.count > 0 ? (
                            <Link className="table-link" href={stageUrl(stage.stage) as never}>
                              {stage.label}
                            </Link>
                          ) : (
                            <Text as="span" variant="bodyMd" tone="subdued">
                              {stage.label}
                            </Text>
                          )}
                          <Text
                            as="span"
                            variant="bodyMd"
                            fontWeight={stage.actor === "merchant" && stage.count > 0 ? "semibold" : "regular"}
                            tone={stage.count === 0 ? "subdued" : undefined}
                          >
                            {stage.count}
                          </Text>
                        </InlineStack>
                      </Box>
                    </Box>
                  ))}
                </BlockStack>

                <Divider />

                <BlockStack gap="100">
                  <Text as="h3" variant="headingSm">
                    Account health
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {`${today.disputesThisMonth} dispute${today.disputesThisMonth === 1 ? "" : "s"} opened this month. Winning a dispute recovers the money and does nothing to this ratio.`}
                  </Text>
                  <Link className="table-link" href={withQuery("/account-health") as never}>
                    See the VAMP and ECM ratios
                  </Link>
                </BlockStack>
              </BlockStack>
            </Card>
          </InlineGrid>
        ) : null}

        {/* ---------- Resumption ---------- */}
        {today.changes.length > 0 ? (
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingSm">
                {`Since you were last here`}
              </Text>
              {today.changes.map((change) => (
                <Text as="p" variant="bodySm" key={`${change.kind}-${change.id}`}>
                  <Link className="table-link" href={withQuery(`/disputes/${change.id}`) as never}>
                    {change.label}
                  </Link>
                  {` ${change.detail}.`}
                </Text>
              ))}
            </BlockStack>
          </Card>
        ) : null}
      </BlockStack>
    </AdminPageLayout>
  );
}
