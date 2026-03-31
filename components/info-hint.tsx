"use client";

import { Text, Tooltip } from "@shopify/polaris";

type InfoHintProps = {
  content: string;
};

export function InfoHint({ content }: InfoHintProps) {
  return (
    <Tooltip content={content}>
      <span className="info-hint" aria-label={content} role="img">
        <Text as="span" variant="bodySm" tone="subdued">
          i
        </Text>
      </span>
    </Tooltip>
  );
}
