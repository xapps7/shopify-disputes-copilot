"use client";

import { Card, EmptyState, Page } from "@shopify/polaris";

import { EMPTY_STATE_IMAGE } from "@/components/empty-state-image";

export default function NotFound() {
  return (
    <Page title="Page not found">
      <Card>
        <EmptyState
          heading="We could not find that page"
          image={EMPTY_STATE_IMAGE}
          action={{ content: "Go to overview", url: "/" }}
          secondaryAction={{ content: "View disputes", url: "/disputes" }}
        >
          <p>The link may be out of date, or the record it pointed at was removed.</p>
        </EmptyState>
      </Card>
    </Page>
  );
}
