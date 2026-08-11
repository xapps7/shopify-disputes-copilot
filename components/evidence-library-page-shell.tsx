"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  InlineStack,
  EmptyState,
  IndexFilters,
  IndexTable,
  Text,
  useSetIndexFiltersMode
} from "@shopify/polaris";

import { AdminPageLayout } from "@/components/admin-page-layout";
import { EMPTY_STATE_IMAGE } from "@/components/empty-state-image";
import { EvidenceItemEditor } from "@/components/evidence-item-editor";
import { ResourceSection } from "@/components/resource-section";
import { filterEvidenceItems } from "@/lib/disputes/workflow";
import { formatDate } from "@/lib/format/date";
import type { DisputeOptionView, EvidenceLibraryItemView } from "@/lib/types";

type EvidenceLibraryPageShellProps = {
  items: EvidenceLibraryItemView[];
  disputeOptions: DisputeOptionView[];
};

export function EvidenceLibraryPageShell({ items, disputeOptions }: EvidenceLibraryPageShellProps) {
  const { mode, setMode } = useSetIndexFiltersMode();
  const searchParams = useSearchParams();
  const [selectedTab, setSelectedTab] = useState(0);
  const [queryValue, setQueryValue] = useState("");
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const filteredItems = useMemo(() => filterEvidenceItems(items, selectedTab, queryValue), [items, queryValue, selectedTab]);
  const editingItem = items.find((item) => item.id === editingItemId) ?? null;
  const embeddedQuery = searchParams.toString();
  const disputesUrl = `/disputes${embeddedQuery ? `?${embeddedQuery}` : ""}`;

  return (
    <AdminPageLayout
      title="Evidence library"
      subtitle="Search and organize uploaded files across disputes."
      primaryAction={{ content: "View disputes", url: "/disputes" }}
      gap="300"
    >
      <Text as="p" variant="bodySm" tone="subdued">
        Use this library when the same carrier proof, support thread, policy capture, or refund record may need to support more than one dispute. For work on a single case, start in <strong>Disputes</strong>.
      </Text>
      <ResourceSection title="Evidence files" flush>
        <IndexFilters
          tabs={[
            { id: "all", content: "All files" },
            { id: "communication", content: "Communication" },
            { id: "refunds", content: "Refund proof" },
            { id: "fulfillment", content: "Fulfillment" }
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
          queryValue={queryValue}
          queryPlaceholder="Search files"
          onQueryChange={setQueryValue}
          onQueryClear={() => setQueryValue("")}
        />
        {filteredItems.length > 0 ? (
          <IndexTable
            headings={[
              { title: "File" },
              { title: "Category" },
              { title: "Dispute" },
              { title: "Source" },
              { title: "Added" }
            ]}
            itemCount={filteredItems.length}
            selectable={false}
          >
            {filteredItems.map((item, index) => (
              <IndexTable.Row id={item.id} key={item.id} position={index}>
                <IndexTable.Cell>
                  <BlockStack gap="100">
                    <Text as="p" variant="bodyMd" fontWeight="medium">
                      {item.title}
                    </Text>
                    <InlineStack gap="200" wrap>
                      {item.fileUrl ? (
                        <Button url={item.fileUrl} target="_blank" size="micro" variant="plain">
                          Open file
                        </Button>
                      ) : null}
                      <Button onClick={() => setEditingItemId(item.id)} size="micro" variant="plain">
                        Edit details
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge>{item.category.replaceAll("_", " ")}</Badge>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Link
                    className="table-link"
                    href={`/disputes/${item.disputeId}${embeddedQuery ? `?${embeddedQuery}` : ""}` as never}
                  >
                    {item.disputeReference}
                  </Link>
                </IndexTable.Cell>
                <IndexTable.Cell>{item.sourceType}</IndexTable.Cell>
                <IndexTable.Cell>{formatDate(item.createdAt)}</IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        ) : (
          <Box padding="400">
            <BlockStack gap="200">
              {items.length === 0 ? (
                <EmptyState
                  heading="No evidence files yet"
                  image={EMPTY_STATE_IMAGE}
                  action={{ content: "View disputes", url: disputesUrl }}
                >
                  <p>
                    Files you upload on a dispute appear here, ready to reuse on any other dispute that needs the same
                    proof.
                  </p>
                </EmptyState>
              ) : (
                <EmptyState
                  heading="No evidence files match this view"
                  image={EMPTY_STATE_IMAGE}
                  action={
                    queryValue
                      ? { content: "Clear search", onAction: () => setQueryValue("") }
                      : { content: "Show all files", onAction: () => setSelectedTab(0) }
                  }
                >
                  <p>
                    {`${items.length} file${items.length === 1 ? " is" : "s are"} stored, but none match the current category or search.`}
                  </p>
                </EmptyState>
              )}
              <Text as="p" variant="bodySm" tone="subdued">
                Evidence items are organized by category, source, and linked dispute.
              </Text>
            </BlockStack>
          </Box>
        )}
      </ResourceSection>
      <EvidenceItemEditor
        item={editingItem}
        disputeOptions={disputeOptions}
        open={Boolean(editingItem)}
        onClose={() => setEditingItemId(null)}
      />
    </AdminPageLayout>
  );
}
