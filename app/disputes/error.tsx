"use client";

import { useEffect } from "react";
import { Banner, Card, Page } from "@shopify/polaris";

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function DisputesError({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error("[disputes] failed to load queue", error);
  }, [error]);

  return (
    <Page title="Disputes">
      <Card>
        <Banner
          tone="critical"
          title="The dispute queue could not be loaded"
          action={{ content: "Try again", onAction: reset }}
          secondaryAction={{ content: "Go to overview", url: "/" }}
        >
          <p>{error.message || "Loading the dispute queue failed."}</p>
        </Banner>
      </Card>
    </Page>
  );
}
