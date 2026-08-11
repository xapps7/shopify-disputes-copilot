"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Badge,
  BlockStack,
  Box,
  EmptyState,
  IndexFilters,
  IndexTable,
  useSetIndexFiltersMode
} from "@shopify/polaris";

import { AdminPageLayout } from "@/components/admin-page-layout";
import { DeadlineBadge, useNow } from "@/components/deadline-badge";
import { EMPTY_STATE_IMAGE } from "@/components/empty-state-image";
import { ResourceSection } from "@/components/resource-section";
import { SyncStatusBanner, useDisputeSync } from "@/components/sync-status";
import { isDueSoon } from "@/lib/format/date";
import { formatMoney } from "@/lib/format/money";
import type { DashboardDispute } from "@/lib/types";

type DisputesIndexPageShellProps = {
  disputes: DashboardDispute[];
};

function toneForStatus(status: string) {
  if (status.includes("WARNING") || status === "NEEDS_RESPONSE") return "warning" as const;
  if (status === "UNDER_REVIEW") return "info" as const;
  if (status === "WON") return "success" as const;
  if (status === "LOST" || status === "ACCEPTED") return "critical" as const;
  return undefined;
}

export function DisputesIndexPageShell({ disputes }: DisputesIndexPageShellProps) {
  const { mode, setMode } = useSetIndexFiltersMode();
  const searchParams = useSearchParams();
  const now = useNow();
  const [selectedTab, setSelectedTab] = useState(0);
  const { isSyncing, result: syncResult, runSync } = useDisputeSync();

  const filteredDisputes = useMemo(() => {
    switch (selectedTab) {
      case 1:
        // A dispute with no deadline is never "due soon".
        return disputes.filter((dispute) => isDueSoon(dispute.evidenceDueBy, now ?? undefined));
      case 2:
        return disputes.filter((dispute) =>
          ["NEEDS_RESPONSE", "WARNING_NEEDS_RESPONSE"].includes(dispute.status)
        );
      case 3:
        return disputes.filter((dispute) => dispute.status === "UNDER_REVIEW");
      default:
        return disputes;
    }
  }, [disputes, now, selectedTab]);

  return (
    <AdminPageLayout
      title="Disputes"
      subtitle="Review active disputes, deadlines, and evidence readiness."
      primaryAction={{ content: "Sync disputes", onAction: runSync, loading: isSyncing }}
      secondaryActions={[{ content: "Open evidence library", url: "/evidence" }]}
      gap="300"
    >
      <BlockStack gap="300">
        <SyncStatusBanner result={syncResult} />
        <ResourceSection title="Dispute queue" flush>
          <IndexFilters
            tabs={[
              { id: "all", content: "All" },
              { id: "due-soon", content: "Due soon" },
              { id: "needs-response", content: "Needs response" },
              { id: "under-review", content: "Under review" }
            ]}
            selected={selectedTab}
            onSelect={setSelectedTab}
            canCreateNewView={false}
            cancelAction={{ onAction: () => {}, disabled: true, loading: false }}
            filters={[]}
            appliedFilters={[]}
            onClearAll={() => {}}
            mode={mode}
            setMode={setMode}
            queryValue=""
            queryPlaceholder="Search disputes"
            onQueryChange={() => {}}
            onQueryClear={() => {}}
          />
          {filteredDisputes.length > 0 ? (
            <IndexTable
              headings={[
                { title: "Dispute" },
                { title: "Order" },
                { title: "Reason" },
                { title: "Status" },
                { title: "Due" },
                { title: "Amount" },
                { title: "Readiness" }
              ]}
              itemCount={filteredDisputes.length}
              selectable={false}
            >
              {filteredDisputes.map((dispute, index) => (
                <IndexTable.Row id={dispute.id} key={dispute.id} position={index}>
                  <IndexTable.Cell>
                    <Link
                      className="table-link"
                      href={`${`/disputes/${dispute.id}`}${searchParams.toString() ? `?${searchParams.toString()}` : ""}` as never}
                    >
                      {dispute.shopifyDisputeId.split("/").pop()}
                    </Link>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {dispute.shopifyOrderId?.split("/").pop() ?? "Unavailable"}
                  </IndexTable.Cell>
                  <IndexTable.Cell>{(dispute.reason ?? "Unknown").replaceAll("_", " ")}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <Badge tone={toneForStatus(dispute.status)}>{dispute.status.replaceAll("_", " ")}</Badge>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <DeadlineBadge dueBy={dispute.evidenceDueBy} now={now} />
                  </IndexTable.Cell>
                  <IndexTable.Cell>{formatMoney(dispute.amount, dispute.currencyCode)}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <Badge tone={dispute.completenessScore >= 75 ? "success" : dispute.completenessScore >= 50 ? "warning" : "critical"}>
                      {`${dispute.completenessScore}%`}
                    </Badge>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          ) : (
            <Box padding="400">
              {disputes.length === 0 ? (
                <EmptyState
                  heading="No disputes yet"
                  image={EMPTY_STATE_IMAGE}
                  action={{ content: "Sync disputes", onAction: runSync, loading: isSyncing }}
                >
                  <p>Sync disputes to populate the operating queue.</p>
                </EmptyState>
              ) : (
                <EmptyState heading="No disputes match this view" image={EMPTY_STATE_IMAGE}>
                  <p>Switch back to the All tab to see the other disputes in the queue.</p>
                </EmptyState>
              )}
            </Box>
          )}
        </ResourceSection>
      </BlockStack>
    </AdminPageLayout>
  );
}
