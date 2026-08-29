"use client";

import { useEffect } from "react";
import { Banner, BlockStack, Card, Page, Text } from "@shopify/polaris";

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
        <BlockStack gap="300">
          <Banner
            tone="critical"
            title="This dispute could not be loaded"
            action={{ content: "Try again", onAction: reset }}
            secondaryAction={{ content: "Back to disputes", url: "/disputes" }}
          >
            <p>
              The dispute failed while loading its data. Retrying usually works. If it keeps failing, run a dispute sync
              from the overview page, or contact support with the reference below.
            </p>
          </Banner>
          {/*
            Same shape as the root boundary in app/error.tsx: the digest, not
            the message. `error.message` here is whatever threw - a Prisma
            query, a Shopify response - and printing it puts internals on a
            merchant's screen while telling them nothing they can act on. The
            digest is the one string support can actually look the failure up by.
          */}
          <Text as="p" variant="bodySm" tone="subdued">
            {error.digest ? `Reference: ${error.digest}` : "No reference was recorded for this failure."}
          </Text>
        </BlockStack>
      </Card>
    </Page>
  );
}
