"use client";

import { useEffect } from "react";
import { Banner, Card, Page } from "@shopify/polaris";

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function DisputeDetailError({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error("[disputes/:id] failed to load dispute", error);
  }, [error]);

  return (
    <Page title="Dispute" backAction={{ content: "Disputes", url: "/disputes" }}>
      <Card>
        <Banner
          tone="critical"
          title="This dispute could not be loaded"
          action={{ content: "Try again", onAction: reset }}
          secondaryAction={{ content: "Back to disputes", url: "/disputes" }}
        >
          <p>{error.message || "Loading this dispute failed."}</p>
        </Banner>
      </Card>
    </Page>
  );
}
