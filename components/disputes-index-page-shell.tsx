"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Badge,
  BlockStack,
  Box,
  Card,
  ChoiceList,
  Divider,
  EmptyState,
  IndexFilters,
  IndexTable,
  InlineStack,
  Text,
  useSetIndexFiltersMode,
  type IndexFiltersProps
} from "@shopify/polaris";

import { AdminPageLayout } from "@/components/admin-page-layout";
import { DeadlineBadge, describeAutoSubmit, useNow, type AutoSubmitDescription } from "@/components/deadline-badge";
import { EMPTY_STATE_IMAGE } from "@/components/empty-state-image";
import { orderReference } from "@/components/order-label";
import { SyncStatusBanner, useDisputeSync } from "@/components/sync-status";
import {
  STAGE_META,
  STAGE_ORDER,
  resolveStage,
  type DisputeStage
} from "@/lib/disputes/lifecycle";
import { getReasonProfile } from "@/lib/disputes/reason-codes";
import { formatCurrencyTotals, formatMoney, sumByCurrency } from "@/lib/format/money";
import type { DashboardDispute } from "@/lib/types";

/**
 * The dispute queue Shopify does not have.
 *
 * A merchant on Shopify Admin alone finds chargebacks by filtering the Orders
 * list by hand, gets no deadline notification, and often discovers the dispute
 * only after Shopify has already auto-submitted a near-empty response. So this
 * is not "a list of disputes" - it is a work queue ordered by when Shopify
 * speaks for them, banded so the ones about to go out cannot be scrolled past,
 * with the money on the line totalled at the top.
 */

/**
 * `DashboardDispute` carries `shopifyOrderId` but not always the order's human
 * name ("#1024"). Reading `orderName` optionally means the queue shows the real
 * name the moment the data layer has it, and shows a masked reference - never a
 * raw 13-digit id - until then. See `components/order-label`.
 */
type QueueDispute = DashboardDispute & { orderName?: string | null };

type DisputesIndexPageShellProps = {
  disputes: QueueDispute[];
};

type BandKey = "urgent" | "week" | "later" | "closed";

const BANDS: Array<{ key: BandKey; title: string; description: string }> = [
  {
    key: "urgent",
    title: "Auto-submits within 48 hours",
    description: "Shopify responds for you on these first."
  },
  {
    key: "week",
    title: "This week",
    description: "Shopify submits inside the next seven days."
  },
  {
    key: "later",
    title: "Later",
    description: "Time to build a real response."
  },
  {
    key: "closed",
    title: "Closed",
    description: "Decided or accepted. No deadline left to miss."
  }
];

const CLOSED_STATUSES = new Set(["WON", "LOST", "ACCEPTED", "CLOSED", "CHARGE_REFUNDED"]);

type ReadinessBucket = "ready" | "partial" | "thin";

const READINESS_LABEL: Record<ReadinessBucket, string> = {
  ready: "Ready",
  partial: "Half built",
  thin: "Thin"
};

const READINESS_TONE: Record<ReadinessBucket, "success" | "warning" | "critical"> = {
  ready: "success",
  partial: "warning",
  thin: "critical"
};

const READINESS_FILTER_OPTIONS = [
  { label: READINESS_LABEL.ready, value: "ready" },
  { label: READINESS_LABEL.partial, value: "partial" },
  { label: READINESS_LABEL.thin, value: "thin" }
];

/**
 * Stage answers "what is owed on this", which the deadline bands do not.
 * A dispute due tomorrow whose response is already built needs nothing; one due
 * in three weeks with nothing attached needs work today. Without this column
 * those two rows look identical.
 */
const STAGE_FILTER_OPTIONS = STAGE_ORDER.map((stage) => ({
  label: STAGE_META[stage].label,
  value: stage
}));

const STAGE_TONE: Record<DisputeStage, "critical" | "warning" | "success" | "info" | undefined> = {
  NEW: "critical",
  BUILDING: "warning",
  READY: "success",
  SUBMITTED: "info",
  DECIDED: undefined
};

function readinessBucket(score: number): ReadinessBucket {
  if (score >= 75) return "ready";
  if (score >= 50) return "partial";
  return "thin";
}

function isClosed(status: string): boolean {
  return CLOSED_STATUSES.has(status);
}

function toTimestamp(value: string | null): number {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

function toAmount(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

type QueueRow = {
  dispute: QueueDispute;
  band: BandKey;
  autoSubmit: AutoSubmitDescription | null;
  dueAt: number;
  amountValue: number;
  reasonLabel: string;
  order: string;
  readiness: ReadinessBucket;
  stage: DisputeStage;
  disputeNumber: string;
};

/** Column indexes the table can be sorted by. */
const DEADLINE_COLUMN = 1;
const AMOUNT_COLUMN = 4;

/** Polaris does not re-export `IndexTableSortDirection`, so mirror it here. */
type SortDirection = "ascending" | "descending";

export function DisputesIndexPageShell({ disputes }: DisputesIndexPageShellProps) {
  const { mode, setMode } = useSetIndexFiltersMode();
  const searchParams = useSearchParams();
  const now = useNow();
  const { isSyncing, result: syncResult, runSync } = useDisputeSync();

  const [selectedTab, setSelectedTab] = useState(0);
  const [queryValue, setQueryValue] = useState("");
  const [reasonFilter, setReasonFilter] = useState<string[]>([]);
  const [readinessFilter, setReadinessFilter] = useState<string[]>([]);
  // Today links here with ?stage=NEW. Seeding state from the URL is what makes
  // those counts doorways rather than decoration.
  const [stageFilter, setStageFilter] = useState<string[]>(() => {
    const requested = searchParams.get("stage");
    return requested && (STAGE_ORDER as string[]).includes(requested) ? [requested] : [];
  });
  const [sortColumnIndex, setSortColumnIndex] = useState(DEADLINE_COLUMN);
  const [sortDirection, setSortDirection] = useState<SortDirection>("ascending");

  const embeddedQuery = searchParams.toString();
  const disputeUrl = useCallback(
    (id: string) => `/disputes/${id}${embeddedQuery ? `?${embeddedQuery}` : ""}`,
    [embeddedQuery]
  );

  /**
   * Everything a row needs, computed once. Banding needs the clock, so before
   * mount every open dispute sits in "Later" and the table is a plain
   * soonest-first list - deterministic during SSR, and it re-bands as soon as
   * `useNow()` resolves rather than guessing.
   */
  const rows = useMemo<QueueRow[]>(
    () =>
      disputes.map((dispute) => {
        const autoSubmit = now === null ? null : describeAutoSubmit(dispute.evidenceDueBy, now);

        let band: BandKey = "later";
        if (isClosed(dispute.status)) {
          band = "closed";
        } else if (autoSubmit && autoSubmit.daysRemaining !== null) {
          if (autoSubmit.isUrgent) {
            band = "urgent";
          } else if (autoSubmit.daysRemaining <= 7) {
            band = "week";
          }
        }

        return {
          dispute,
          band,
          autoSubmit,
          dueAt: toTimestamp(dispute.evidenceDueBy),
          amountValue: toAmount(dispute.amount),
          reasonLabel: getReasonProfile(dispute.reason).label,
          order: orderReference(dispute.orderName, dispute.shopifyOrderId),
          readiness: readinessBucket(dispute.completenessScore),
          stage: resolveStage({
            status: dispute.status,
            evidenceSentOn: dispute.evidenceSentOn,
            completenessScore: dispute.completenessScore,
            hasEvidence: dispute.hasEvidence
          }),
          disputeNumber: dispute.shopifyDisputeId.split("/").pop() ?? dispute.id
        };
      }),
    [disputes, now]
  );

  const openRows = useMemo(() => rows.filter((row) => row.band !== "closed"), [rows]);
  const urgentRows = useMemo(() => rows.filter((row) => row.band === "urgent"), [rows]);

  const totalAtRisk = useMemo(
    () => formatCurrencyTotals(sumByCurrency(openRows.map((row) => row.dispute))),
    [openRows]
  );
  const urgentAtRisk = useMemo(
    () => formatCurrencyTotals(sumByCurrency(urgentRows.map((row) => row.dispute))),
    [urgentRows]
  );

  const reasonOptions = useMemo(
    () =>
      [...new Set(rows.map((row) => row.reasonLabel))]
        .sort((a, b) => a.localeCompare(b))
        .map((label) => ({ label, value: label })),
    [rows]
  );

  const visibleRows = useMemo(() => {
    const needle = queryValue.trim().toLowerCase();

    const filtered = rows.filter((row) => {
      const tabMatch = (() => {
        switch (selectedTab) {
          case 1:
            return row.band === "urgent";
          case 2:
            return ["NEEDS_RESPONSE", "WARNING_NEEDS_RESPONSE"].includes(row.dispute.status);
          case 3:
            return row.dispute.status === "UNDER_REVIEW";
          case 4:
            return row.band === "closed";
          default:
            return true;
        }
      })();

      if (!tabMatch) {
        return false;
      }

      if (needle) {
        const haystack = [
          row.order,
          row.disputeNumber,
          row.reasonLabel,
          row.dispute.status.replaceAll("_", " "),
          row.autoSubmit?.dateLabel ?? ""
        ]
          .join(" ")
          .toLowerCase();

        if (!haystack.includes(needle)) {
          return false;
        }
      }

      if (reasonFilter.length > 0 && !reasonFilter.includes(row.reasonLabel)) {
        return false;
      }

      if (stageFilter.length > 0 && !stageFilter.includes(row.stage)) {
        return false;
      }

      return readinessFilter.length === 0 || readinessFilter.includes(row.readiness);
    });

    const direction = sortDirection === "ascending" ? 1 : -1;

    return [...filtered].sort((a, b) => {
      if (sortColumnIndex === AMOUNT_COLUMN) {
        if (a.amountValue !== b.amountValue) {
          return (a.amountValue - b.amountValue) * direction;
        }
        return a.dueAt - b.dueAt;
      }

      if (a.dueAt !== b.dueAt) {
        return (a.dueAt - b.dueAt) * direction;
      }
      return b.amountValue - a.amountValue;
    });
  }, [queryValue, readinessFilter, reasonFilter, rows, selectedTab, sortColumnIndex, sortDirection, stageFilter]);

  const groups = useMemo(
    () =>
      BANDS.map((band) => ({
        ...band,
        // Pre-mount there is no clock, so every open dispute sits in one
        // bucket. Calling that bucket "Later" would be a false statement about
        // a dispute due tomorrow, so it is named neutrally until the clock
        // resolves and the real bands appear.
        ...(now === null && band.key === "later"
          ? { title: "Open disputes", description: "Soonest auto-submit first." }
          : {}),
        rows: visibleRows.filter((row) => row.band === band.key)
      })).filter((band) => band.rows.length > 0),
    [now, visibleRows]
  );

  const appliedFilters: IndexFiltersProps["appliedFilters"] = [];
  if (reasonFilter.length > 0) {
    appliedFilters.push({
      key: "reason",
      label: `Reason: ${reasonFilter.join(", ")}`,
      onRemove: () => setReasonFilter([])
    });
  }
  if (stageFilter.length > 0) {
    appliedFilters.push({
      key: "stage",
      label: `Stage: ${stageFilter.map((value) => STAGE_META[value as DisputeStage]?.label ?? value).join(", ")}`,
      onRemove: () => setStageFilter([])
    });
  }
  if (readinessFilter.length > 0) {
    appliedFilters.push({
      key: "readiness",
      label: `Response: ${readinessFilter
        .map((value) => READINESS_LABEL[value as ReadinessBucket] ?? value)
        .join(", ")}`,
      onRemove: () => setReadinessFilter([])
    });
  }

  const filters: IndexFiltersProps["filters"] = [
    {
      key: "stage",
      label: "Stage",
      filter: (
        <ChoiceList
          allowMultiple
          choices={STAGE_FILTER_OPTIONS}
          onChange={setStageFilter}
          selected={stageFilter}
          title="Stage"
          titleHidden
        />
      ),
      shortcut: true
    },
    {
      key: "reason",
      label: "Reason",
      filter: (
        <ChoiceList
          allowMultiple
          choices={reasonOptions}
          onChange={setReasonFilter}
          selected={reasonFilter}
          title="Reason"
          titleHidden
        />
      ),
      shortcut: true
    },
    {
      key: "readiness",
      label: "Response readiness",
      filter: (
        <ChoiceList
          allowMultiple
          choices={READINESS_FILTER_OPTIONS}
          onChange={setReadinessFilter}
          selected={readinessFilter}
          title="Response readiness"
          titleHidden
        />
      ),
      shortcut: true
    }
  ];

  function clearAll() {
    setQueryValue("");
    setReasonFilter([]);
    setReadinessFilter([]);
    setStageFilter([]);
  }

  const isNarrowed =
    queryValue.trim().length > 0 ||
    reasonFilter.length > 0 ||
    readinessFilter.length > 0 ||
    stageFilter.length > 0 ||
    selectedTab !== 0;

  /**
   * Subheaders and data rows share one `position` sequence: Polaris uses it for
   * focus order and range selection, so a gap or a repeat breaks keyboard
   * navigation through the table.
   */
  const tableRows: React.ReactNode[] = [];
  let position = 0;

  for (const band of groups) {
    tableRows.push(
      <IndexTable.Row id={`band-${band.key}`} key={`band-${band.key}`} position={position} rowType="subheader">
        <IndexTable.Cell as="th" colSpan={6} id={`band-heading-${band.key}`} scope="colgroup">
          <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
            <Text as="span" variant="headingSm">
              {`${band.title} (${band.rows.length})`}
            </Text>
            <Text as="span" variant="bodySm" tone="subdued">
              {band.key === "closed"
                ? band.description
                : `${formatCurrencyTotals(sumByCurrency(band.rows.map((row) => row.dispute)))} at risk · ${band.description}`}
            </Text>
          </InlineStack>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
    position += 1;

    for (const row of band.rows) {
      tableRows.push(
        <IndexTable.Row id={row.dispute.id} key={row.dispute.id} position={position}>
          <IndexTable.Cell>
            <BlockStack gap="050">
              <Link className="table-link" href={disputeUrl(row.dispute.id) as never}>
                {row.order}
              </Link>
              <Text as="span" variant="bodySm" tone="subdued">
                {`Dispute ${row.disputeNumber}`}
              </Text>
            </BlockStack>
          </IndexTable.Cell>
          <IndexTable.Cell>
            <DeadlineBadge dueBy={row.dispute.evidenceDueBy} now={now} />
          </IndexTable.Cell>
          <IndexTable.Cell>
            {/*
              Word plus tone, never tone alone: WCAG 1.4.1 is Level A and its
              F81 failure covers exactly the "colour means overdue" case.
            */}
            <Badge tone={STAGE_TONE[row.stage]}>{STAGE_META[row.stage].label}</Badge>
          </IndexTable.Cell>
          <IndexTable.Cell>{row.reasonLabel}</IndexTable.Cell>
          <IndexTable.Cell>
            <Text as="span" variant="bodyMd" fontWeight="medium">
              {formatMoney(row.dispute.amount, row.dispute.currencyCode)}
            </Text>
          </IndexTable.Cell>
          <IndexTable.Cell>
            <Badge tone={READINESS_TONE[row.readiness]}>
              {`${READINESS_LABEL[row.readiness]} · ${row.dispute.completenessScore}%`}
            </Badge>
          </IndexTable.Cell>
        </IndexTable.Row>
      );
      position += 1;
    }
  }

  return (
    <AdminPageLayout
      title="Disputes"
      subtitle="Ordered by when Shopify submits a response for you."
      primaryAction={{ content: "Sync disputes", onAction: runSync, loading: isSyncing }}
      secondaryActions={[{ content: "Open evidence library", url: "/evidence" }]}
      gap="300"
      banner={
        urgentRows.length > 0 ? (
          <Box
            background="bg-surface-critical"
            borderColor="border-critical"
            borderRadius="300"
            borderWidth="025"
            padding="400"
          >
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">
                {urgentRows.length === 1
                  ? "Shopify sends a response on 1 dispute within 48 hours"
                  : `Shopify sends a response on ${urgentRows.length} disputes within 48 hours`}
              </Text>
              <Text as="p" variant="bodyMd">
                {`${urgentAtRisk} of the total below. Shopify submits whatever it holds on the deadline, whether or not you have written anything.`}
              </Text>
            </BlockStack>
          </Box>
        ) : undefined
      }
    >
      <BlockStack gap="300">
        <SyncStatusBanner result={syncResult} />

        <Card padding="0">
          {/*
            One line, not a header block. "Dispute queue" restated the page
            title, and the total at risk does not need to be set at headingLg to
            be read - it is context for the table under it, not a headline.
          */}
          <Box padding="300" paddingInlineStart="400">
            <InlineStack align="space-between" blockAlign="center" gap="400" wrap>
              <Text as="h2" variant="headingSm">
                {openRows.length === 1
                  ? "1 open dispute, soonest auto-submit first"
                  : `${openRows.length} open disputes, soonest auto-submit first`}
              </Text>
              <Text as="p" variant="bodySm" fontWeight="medium">
                {`${totalAtRisk} at risk`}
              </Text>
            </InlineStack>
          </Box>
          <Divider />

          <IndexFilters
            tabs={[
              { id: "all", content: "All" },
              { id: "urgent", content: "Auto-submits within 48 hours" },
              { id: "needs-response", content: "Needs response" },
              { id: "under-review", content: "Under review" },
              { id: "closed", content: "Closed" }
            ]}
            selected={selectedTab}
            onSelect={setSelectedTab}
            canCreateNewView={false}
            cancelAction={{ onAction: clearAll, disabled: false, loading: false }}
            filters={filters}
            appliedFilters={appliedFilters}
            onClearAll={clearAll}
            mode={mode}
            setMode={setMode}
            queryValue={queryValue}
            queryPlaceholder="Search by order, dispute number, or reason"
            onQueryChange={setQueryValue}
            onQueryClear={() => setQueryValue("")}
          />

          {visibleRows.length > 0 ? (
            <IndexTable
              headings={[
                { title: "Order" },
                { title: "Shopify sends" },
                { title: "Stage" },
                { title: "Reason" },
                { title: "Amount at risk", alignment: "end" },
                { title: "Your response" }
              ]}
              itemCount={visibleRows.length}
              selectable={false}
              sortable={[false, true, false, false, true, false]}
              sortColumnIndex={sortColumnIndex}
              sortDirection={sortDirection}
              defaultSortDirection="ascending"
              onSort={(index, direction) => {
                setSortColumnIndex(index);
                setSortDirection(direction);
              }}
              sortToggleLabels={{
                [DEADLINE_COLUMN]: {
                  ascending: "Soonest auto-submit first",
                  descending: "Latest auto-submit first"
                },
                [AMOUNT_COLUMN]: { ascending: "Smallest amount first", descending: "Largest amount first" }
              }}
            >
              {tableRows}
            </IndexTable>
          ) : (
            <Box padding="400">
              {disputes.length === 0 ? (
                <EmptyState
                  heading="No disputes yet"
                  image={EMPTY_STATE_IMAGE}
                  action={{ content: "Sync disputes", onAction: runSync, loading: isSyncing }}
                >
                  <p>
                    Sync to pull your Shopify Payments disputes in. Shopify does not notify you when one opens, so
                    this queue is the only place the deadline shows up.
                  </p>
                </EmptyState>
              ) : (
                <EmptyState
                  heading="No disputes match this view"
                  image={EMPTY_STATE_IMAGE}
                  action={isNarrowed ? { content: "Clear search and filters", onAction: clearAll } : undefined}
                >
                  <p>{`${disputes.length} disputes are in the queue. Clear the search and filters to see them.`}</p>
                </EmptyState>
              )}
            </Box>
          )}
        </Card>

      </BlockStack>
    </AdminPageLayout>
  );
}
