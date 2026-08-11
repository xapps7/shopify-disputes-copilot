"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import {
  Banner,
  Badge,
  BlockStack,
  Box,
  Card,
  Divider,
  EmptyState,
  IndexTable,
  InlineStack,
  List,
  Text
} from "@shopify/polaris";

import { AdminPageLayout } from "@/components/admin-page-layout";
import { DeadlineBadge, useNow } from "@/components/deadline-badge";
import { EMPTY_STATE_IMAGE } from "@/components/empty-state-image";
import { ResourceSection } from "@/components/resource-section";
import { SyncStatusBanner, useDisputeSync } from "@/components/sync-status";
import { formatCurrencyTotals, formatMoney, sumByCurrency } from "@/lib/format/money";
import type { DashboardDispute, OverviewMetricsView, PreventionRecommendationView } from "@/lib/types";

type OverviewPageShellProps = {
  metrics: OverviewMetricsView;
  recentDisputes: DashboardDispute[];
  recommendations: PreventionRecommendationView[];
};

function toneForStatus(status: string) {
  if (status.includes("WARNING") || status === "NEEDS_RESPONSE") return "warning" as const;
  if (status === "UNDER_REVIEW") return "info" as const;
  if (status === "WON") return "success" as const;
  if (status === "LOST" || status === "ACCEPTED") return "critical" as const;
  return undefined;
}

export function OverviewPageShell({ metrics, recentDisputes, recommendations }: OverviewPageShellProps) {
  const searchParams = useSearchParams();
  const now = useNow();
  const { isSyncing, result: syncResult, runSync } = useDisputeSync();
  const embeddedQuery = searchParams.toString();
  const disputesUrl = `/disputes${embeddedQuery ? `?${embeddedQuery}` : ""}`;
  const evidenceUrl = `/evidence${embeddedQuery ? `?${embeddedQuery}` : ""}`;

  // `metrics.totalAmount` adds every dispute amount together regardless of
  // currency, which is not a number that means anything. Total per currency
  // instead, from the same dispute rows the metric was derived from.
  const disputedTotals = useMemo(() => sumByCurrency(recentDisputes), [recentDisputes]);
  const isMixedCurrency = disputedTotals.length > 1;

  return (
    <AdminPageLayout
      title="Disputes Co-Pilot"
      subtitle="Workflow entry point for active Shopify Payments disputes."
      primaryAction={{ content: "View disputes", url: disputesUrl }}
      secondaryActions={[
        { content: "Open evidence library", url: evidenceUrl },
        { content: isSyncing ? "Syncing disputes..." : "Sync disputes", onAction: runSync, disabled: isSyncing }
      ]}
      gap="400"
      banner={
        metrics.dueSoon > 0 ? (
          <Banner tone="critical">
            <p>
              {metrics.dueSoon === 1
                ? "1 dispute is overdue or due within 48 hours."
                : `${metrics.dueSoon} disputes are overdue or due within 48 hours.`}
            </p>
          </Banner>
        ) : undefined
      }
    >
      <BlockStack gap="400">
        <SyncStatusBanner result={syncResult} />

        <Card>
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd">
              Start with urgent disputes, then complete missing evidence.
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Disputes Co-Pilot exists to save merchants from hunting through email threads, carrier portals, and order notes manually. It keeps the checklist, evidence shelf, packet drafting, and submission tracking in one place.
            </Text>

            <InlineStack gap="600" wrap>
              {[
                ["Open disputes", String(metrics.openDisputes)],
                ["Due soon", String(metrics.dueSoon)],
                ["Evidence ready", String(metrics.evidenceReady)],
                [
                  isMixedCurrency ? "Total disputed (per currency)" : "Total disputed",
                  formatCurrencyTotals(disputedTotals)
                ]
              ].map(([label, value]) => (
                <InlineStack gap="100" key={label}>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {`${label}:`}
                  </Text>
                  <Text as="span" variant="bodyMd" fontWeight="medium">
                    {value}
                  </Text>
                </InlineStack>
              ))}
            </InlineStack>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Why merchants use it
            </Text>
            <List type="bullet">
              <List.Item>See which disputes are urgent before the deadline gets missed.</List.Item>
              <List.Item>Get guided evidence collection steps instead of figuring out the packet manually.</List.Item>
              <List.Item>Store files once, reuse them across disputes, and track what was submitted.</List.Item>
            </List>
            <Text as="p" variant="bodySm" tone="subdued">
              Work a live case in <strong>Disputes</strong>. Use <strong>Evidence library</strong> to organize files that may support more than one case.
            </Text>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="150">
            <Text as="h2" variant="headingMd">
              Attention needed
            </Text>
            <InlineStack align="space-between">
              <Link className="table-link" href={disputesUrl as never}>
                Disputes due within 48 hours
              </Link>
              <Badge tone={metrics.dueSoon > 0 ? "critical" : "success"}>{String(metrics.dueSoon)}</Badge>
            </InlineStack>
            <Divider />
            <InlineStack align="space-between">
              <Link className="table-link" href={disputesUrl as never}>
                Evidence-ready cases
              </Link>
              <Badge tone="info">{String(metrics.evidenceReady)}</Badge>
            </InlineStack>
            <Divider />
            <InlineStack align="space-between">
              <Link className="table-link" href={disputesUrl as never}>
                Missing evidence cases
              </Link>
              <Badge tone={metrics.openDisputes - metrics.evidenceReady > 0 ? "warning" : "success"}>
                {String(Math.max(metrics.openDisputes - metrics.evidenceReady, 0))}
              </Badge>
            </InlineStack>
          </BlockStack>
        </Card>

        <ResourceSection
          title="Recent disputes"
          action={
            <Link className="table-link" href={disputesUrl as never}>
              View all disputes
            </Link>
          }
          flush
        >
          {recentDisputes.length > 0 ? (
            <IndexTable
              headings={[
                { title: "Dispute" },
                { title: "Order" },
                { title: "Reason" },
                { title: "Status" },
                { title: "Due date" },
                { title: "Amount" },
                { title: "Readiness" }
              ]}
              itemCount={recentDisputes.length}
              selectable={false}
            >
              {recentDisputes.slice(0, 6).map((dispute, index) => (
                <IndexTable.Row id={dispute.id} key={dispute.id} position={index}>
                  <IndexTable.Cell>
                    <Link
                      className="table-link"
                      href={`/disputes/${dispute.id}${embeddedQuery ? `?${embeddedQuery}` : ""}` as never}
                    >
                      {dispute.shopifyDisputeId.split("/").pop()}
                    </Link>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{dispute.shopifyOrderId?.split("/").pop() ?? "Unavailable"}</IndexTable.Cell>
                  <IndexTable.Cell>{(dispute.reason ?? "Unknown").replaceAll("_", " ")}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <Badge tone={toneForStatus(dispute.status)}>{dispute.status.replaceAll("_", " ")}</Badge>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <DeadlineBadge dueBy={dispute.evidenceDueBy} now={now} />
                  </IndexTable.Cell>
                  <IndexTable.Cell>{formatMoney(dispute.amount, dispute.currencyCode)}</IndexTable.Cell>
                  <IndexTable.Cell>{`${dispute.completenessScore}%`}</IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          ) : (
            <Box padding="400" width="100%">
              <EmptyState
                heading="No disputes yet"
                action={{ content: "Sync disputes", onAction: runSync, loading: isSyncing }}
                image={EMPTY_STATE_IMAGE}
              >
                <p>Once disputes are synced, the overview will highlight what needs attention first.</p>
              </EmptyState>
            </Box>
          )}
        </ResourceSection>

        <ResourceSection title="Prevention insights">
          <BlockStack gap="150">
            {recommendations.length > 0 ? (
              recommendations.slice(0, 2).map((item, index) => (
                <Box key={item.id}>
                  <BlockStack gap="050">
                    <Text as="p" variant="bodyMd" fontWeight="semibold">
                      {item.category.replaceAll("_", " ")}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {item.recommendationText}
                    </Text>
                  </BlockStack>
                  {index < Math.min(recommendations.length, 2) - 1 ? <Divider /> : null}
                </Box>
              ))
            ) : (
              <Text as="p" variant="bodySm" tone="subdued">
                Recommendations appear after dispute outcomes are recorded.
              </Text>
            )}
          </BlockStack>
        </ResourceSection>
      </BlockStack>
    </AdminPageLayout>
  );
}
