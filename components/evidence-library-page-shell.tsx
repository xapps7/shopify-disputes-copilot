"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
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
import { EvidenceItemEditor } from "@/components/evidence-item-editor";
import { ResourceSection } from "@/components/resource-section";
import { filterEvidenceItems } from "@/lib/disputes/workflow";
import type { DisputeOptionView, EvidenceLibraryItemView } from "@/lib/types";

type EvidenceLibraryPageShellProps = {
  items: EvidenceLibraryItemView[];
  disputeOptions: DisputeOptionView[];
};

export function EvidenceLibraryPageShell({ items, disputeOptions }: EvidenceLibraryPageShellProps) {
  const { mode, setMode } = useSetIndexFiltersMode();
  const [selectedTab, setSelectedTab] = useState(0);
  const [queryValue, setQueryValue] = useState("");
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const filteredItems = useMemo(() => filterEvidenceItems(items, selectedTab, queryValue), [items, queryValue, selectedTab]);
  const editingItem = items.find((item) => item.id === editingItemId) ?? null;

  return (
    <AdminPageLayout
      title="Evidence library"
      subtitle="Search and organize uploaded files across disputes."
      primaryAction={{ content: "View disputes", url: "/disputes" }}
      gap="300"
    >
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
                      <Button onClick={() => setEditingItemId(item.id)} size="micro" variant="plain">
                        Edit details
                      </Button>
                      {item.fileUrl ? (
                        <Button url={item.fileUrl} target="_blank" size="micro" variant="plain">
                          Open file
                        </Button>
                      ) : null}
                    </InlineStack>
                  </BlockStack>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge>{item.category.replaceAll("_", " ")}</Badge>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Link className="table-link" href={`/disputes/${item.disputeId}` as never}>
                    {item.disputeReference}
                  </Link>
                </IndexTable.Cell>
                <IndexTable.Cell>{item.sourceType}</IndexTable.Cell>
                <IndexTable.Cell>{new Date(item.createdAt).toLocaleDateString()}</IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        ) : (
          <Box padding="400">
            <BlockStack gap="200">
              <EmptyState heading="No evidence files match this view" image="">
                <p>Adjust the category filter or search query to broaden the evidence shelf.</p>
              </EmptyState>
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
