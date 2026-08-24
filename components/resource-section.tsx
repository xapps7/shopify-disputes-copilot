"use client";

import { BlockStack, Box, Card, Divider, InlineStack, Text } from "@shopify/polaris";

type ResourceSectionProps = {
  title: string;
  /** One line on why this section exists. Sits under the heading, never beside it. */
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  flush?: boolean;
};

export function ResourceSection({ title, description, action, children, flush = false }: ResourceSectionProps) {
  return (
    <Card padding={flush ? "0" : undefined}>
      <Box padding="400">
        <InlineStack align="space-between" blockAlign="start" gap="300">
          <BlockStack gap="100">
            <Text as="h2" variant="headingMd">
              {title}
            </Text>
            {description ? (
              <Text as="p" variant="bodySm" tone="subdued">
                {description}
              </Text>
            ) : null}
          </BlockStack>
          {action}
        </InlineStack>
      </Box>
      <Divider />
      {children}
    </Card>
  );
}
