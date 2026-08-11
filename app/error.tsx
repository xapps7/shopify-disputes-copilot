"use client";

import { useEffect } from "react";
import { Banner, BlockStack, Card, Page, Text } from "@shopify/polaris";

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function AppError({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error("[app] unhandled render error", error);
  }, [error]);

  return (
    <Page title="Something went wrong">
      <Card>
        <BlockStack gap="300">
          <Banner
            tone="critical"
            title="This page could not be loaded"
            action={{ content: "Try again", onAction: reset }}
          >
            <p>
              The page failed while loading its data. Retrying usually works. If it keeps failing, run a dispute sync
              from the overview page, or contact support with the reference below.
            </p>
          </Banner>
          <Text as="p" variant="bodySm" tone="subdued">
            {error.digest ? `Reference: ${error.digest}` : error.message}
          </Text>
        </BlockStack>
      </Card>
    </Page>
  );
}
