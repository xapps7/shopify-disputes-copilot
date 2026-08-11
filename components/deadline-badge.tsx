"use client";

import { useEffect, useState } from "react";
import { Badge, BlockStack, InlineStack, Text } from "@shopify/polaris";

import { describeDeadline, formatDate } from "@/lib/format/date";

/**
 * `Date.now()` differs between the server render and the browser render, so any
 * urgency label derived from it is a hydration mismatch waiting to happen. The
 * clock is therefore only read after mount; until then components render the
 * deadline date, which is fully deterministic.
 */
export function useNow(): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
  }, []);

  return now;
}

type DeadlineBadgeProps = {
  dueBy: string | null;
  /** Pass a shared `useNow()` value when several badges appear in one list. */
  now?: number | null;
  layout?: "stacked" | "inline";
};

/**
 * Renders a deadline as an explicit date plus an explicit urgency word
 * ("Overdue by 2 days" / "Due today" / "Due in 5 days"). Colour alone never
 * carries the urgency, which is what the previous colour-only badges did.
 */
export function DeadlineBadge({ dueBy, now = null, layout = "stacked" }: DeadlineBadgeProps) {
  const deadline = describeDeadline(dueBy, now ?? undefined);
  const dateLabel = formatDate(dueBy, { fallback: "No deadline" });

  if (!dueBy) {
    return (
      <Text as="span" variant="bodySm" tone="subdued">
        No deadline
      </Text>
    );
  }

  const urgency = now === null ? null : <Badge tone={deadline.tone}>{deadline.label}</Badge>;

  if (layout === "inline") {
    return (
      <InlineStack gap="150" blockAlign="center" wrap={false}>
        <Text as="span" variant="bodySm">
          {dateLabel}
        </Text>
        {urgency}
      </InlineStack>
    );
  }

  return (
    <BlockStack gap="100">
      <Text as="span" variant="bodySm">
        {dateLabel}
      </Text>
      {urgency}
    </BlockStack>
  );
}
