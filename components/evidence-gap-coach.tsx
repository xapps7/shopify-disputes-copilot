"use client";

import { useState } from "react";
import { Badge, BlockStack, Box, Button, Collapsible, InlineStack, Text } from "@shopify/polaris";

import type { EvidenceGapInsight } from "@/lib/disputes/workflow";

/**
 * Coaching, moved to where the work happens.
 *
 * This used to be a "Coaching" tab: a list of everything missing, one click
 * away from the boxes it was talking about. Guidance in a different tab from
 * the thing it explains is guidance nobody reads. So the same insight now
 * renders as a hint attached to the slot it refers to - the headline and the
 * reason are always visible, the how-to is one keyboard-reachable disclosure
 * away, so a merchant who already knows how to export a tracking PDF is not
 * made to scroll past the instructions.
 */

/** The gaps that belong to a particular file slot, matched on evidence category. */
export function gapsForCategories(
  gaps: ReadonlyArray<EvidenceGapInsight>,
  categories: ReadonlyArray<string>
): EvidenceGapInsight[] {
  return gaps.filter((gap) => categories.includes(gap.category));
}

/** The gaps no file slot claims, so nothing silently disappears from the page. */
export function gapsOutsideCategories(
  gaps: ReadonlyArray<EvidenceGapInsight>,
  claimedCategories: ReadonlyArray<string>
): EvidenceGapInsight[] {
  return gaps.filter((gap) => !claimedCategories.includes(gap.category));
}

export type EvidenceGapHintProps = {
  gap: EvidenceGapInsight;
  /**
   * Distinguishes two hints for the same category rendered in different places
   * (a slot and the leftovers list), so the disclosure ids stay unique. Must be
   * stable across renders - never a random value, or the server and client
   * markup disagree.
   */
  idPrefix?: string;
};

export function EvidenceGapHint({ gap, idPrefix = "evidence-gap" }: EvidenceGapHintProps) {
  const [open, setOpen] = useState(false);
  const panelId = `${idPrefix}-${gap.category.toLowerCase().replaceAll("_", "-")}`;

  return (
    <Box background="bg-surface-secondary" borderRadius="200" padding="300">
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="start" gap="300" wrap>
          <BlockStack gap="050">
            <Text as="p" variant="bodySm" fontWeight="medium">
              {`Missing: ${gap.label}`}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {gap.whyItMatters}
            </Text>
          </BlockStack>
          {/* The word carries the status; the tone only repeats it. */}
          <Badge tone={gap.severity}>{gap.severity === "critical" ? "Needed now" : "Missing"}</Badge>
        </InlineStack>

        <InlineStack>
          <Button
            ariaControls={panelId}
            ariaExpanded={open}
            disclosure={open ? "up" : "down"}
            onClick={() => setOpen((previous) => !previous)}
            variant="tertiary"
          >
            {open ? "Hide how to get it" : "How to get it"}
          </Button>
        </InlineStack>

        <Collapsible id={panelId} open={open}>
          <BlockStack gap="100">
            <Text as="p" variant="bodySm">
              <strong>How to get it:</strong> {gap.howToGet}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              <strong>Best source:</strong> {gap.bestSource}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              <strong>App help:</strong> {gap.appSupport}
            </Text>
          </BlockStack>
        </Collapsible>
      </BlockStack>
    </Box>
  );
}
