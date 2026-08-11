"use client";

import { Card, EmptyState, Page } from "@shopify/polaris";

import { EMPTY_STATE_IMAGE } from "@/components/empty-state-image";

export default function DisputeNotFound() {
  return (
    <Page title="Dispute not found" backAction={{ content: "Disputes", url: "/disputes" }}>
      <Card>
        <EmptyState
          heading="We could not find that dispute"
          image={EMPTY_STATE_IMAGE}
          action={{ content: "Back to disputes", url: "/disputes" }}
        >
          <p>
            The dispute may belong to another store, or it may not have been synced yet. Run a dispute sync from the
            disputes page and try again.
          </p>
        </EmptyState>
      </Card>
    </Page>
  );
}
