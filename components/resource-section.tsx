"use client";

import { Box, Card, Divider, InlineStack, Text } from "@shopify/polaris";

type ResourceSectionProps = {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  flush?: boolean;
};

export function ResourceSection({ title, action, children, flush = false }: ResourceSectionProps) {
  return (
    <Card padding={flush ? "0" : undefined}>
      <Box padding="400">
        <InlineStack align="space-between" blockAlign="center" gap="300">
          <Text as="h2" variant="headingMd">
            {title}
          </Text>
          {action}
        </InlineStack>
      </Box>
      <Divider />
      {children}
    </Card>
  );
}
