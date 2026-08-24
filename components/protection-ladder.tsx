"use client";

import { Badge, BlockStack, Box, Divider, InlineGrid, List, Text } from "@shopify/polaris";

import { ResourceSection } from "@/components/resource-section";
import type {
  ProtectionAdvice,
  ProtectionRecommendation,
  ProtectionTool,
  ProtectionWarning
} from "@/lib/economics/protection";

/**
 * Which anti-chargeback product is worth buying here, and which one is being
 * mis-sold.
 *
 * `recommendProtection` has already made the decision. This file only says it
 * out loud: no arithmetic, and no reordering. The module sorts `recommended`
 * free-first-then-cheapest so it reads in the order a merchant should act, and
 * a second sort on this side would eventually disagree with it silently.
 *
 * The two lists get the same weight on purpose. Every vendor in this category
 * publishes a recommended stack and none of them publishes an avoid list, so
 * "the 29-per-alert product buys you nothing where you stand" is the more
 * valuable of the two answers. As a footnote it would be thrown away.
 *
 * Cost is a word before it is a figure. Reversing an authorisation is free, has
 * no vendor and is the highest-leverage instrument in the table - if it renders
 * looking like a line item on a bill, this page has mis-sold the one thing here
 * that costs nothing.
 *
 * Nothing is conveyed by colour on its own. Every badge tone repeats a word
 * that is already in the badge, so the lists survive being read in greyscale
 * (WCAG 1.4.1).
 */

type ProtectionLadderProps = {
  /** Null whenever no threshold is in play. The section disappears entirely. */
  protection: ProtectionAdvice | null;
};

/** Pinned so the server and client renders of these figures agree. */
const COST_LOCALE = "en-US";

/**
 * The advice carries no currency. `protection.ts` prices against Shopify's USD
 * chargeback fee and USD vendor list prices, so every figure below is
 * USD-shaped whatever the shop sells in. That is stated under the heading
 * rather than dressed up as the merchant's own currency.
 */
const COST_CURRENCY = "USD";

const COST_FORMAT = new Intl.NumberFormat(COST_LOCALE, {
  style: "currency",
  currency: COST_CURRENCY,
  // Whole dollars. The inputs are planning assumptions, and cents on an
  // estimate claim a precision the model does not have.
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
});

/**
 * What the instrument does to the count, in words. The four cases are the whole
 * point of the module, and flattening them to "protects your ratio" is the
 * mis-selling it exists to correct - so a recommended tool that does nothing
 * for the ratio says so on its own row.
 */
const RATIO_EFFECT_WORD: Record<ProtectionTool["removesFromRatio"], string> = {
  REMOVES: "Removed from the count",
  REMOVES_IF_PRE_FILING: "Removed only before filing",
  REMOVES_NON_FRAUD_ONLY: "Removed on non-fraud only",
  NONE: "Still counts"
};

const RATIO_EFFECT_TONE: Record<ProtectionTool["removesFromRatio"], "success" | "attention" | undefined> = {
  REMOVES: "success",
  REMOVES_IF_PRE_FILING: "attention",
  REMOVES_NON_FRAUD_ONLY: "attention",
  NONE: undefined
};

/** Whether you still have the money afterwards. "Yes, if won" is not "yes". */
const MONEY_EFFECT_WORD: Record<ProtectionTool["keepsMoney"], string> = {
  KEEPS: "You keep the sale",
  KEEPS_IF_WON: "You keep the money only if you win",
  REFUNDS: "You refund the customer to resolve it"
};

/**
 * Zero is a real answer here, not a missing figure: the free instruments are
 * pushed with `monthlyCost: 0`, so anything that is not positive is free and
 * has to read as free rather than as "$0 a month".
 */
function monthlyCostLabel(monthlyCost: number): string {
  if (!Number.isFinite(monthlyCost) || monthlyCost <= 0) {
    return "Free";
  }
  return `${COST_FORMAT.format(Math.round(monthlyCost))} a month`;
}

/** List price, for the avoid list, where there is no monthly figure to quote. */
function perEventLabel(tool: ProtectionTool): string {
  if (tool.costPerEvent === null) {
    return "No per-event fee";
  }
  if (tool.costPerEvent <= 0) {
    return "Free";
  }
  return `${COST_FORMAT.format(tool.costPerEvent)} per event`;
}

/** One row of either list. The effect words are the same on both sides. */
function ToolRow({
  tool,
  body,
  badges
}: {
  tool: ProtectionTool;
  body: string;
  badges: React.ReactNode;
}) {
  return (
    <InlineGrid columns={{ xs: "1fr", md: "minmax(0,1fr) auto" }} gap="300">
      <BlockStack gap="150">
        <Text as="h3" variant="headingSm">
          {tool.name}
        </Text>
        <Text as="p" variant="bodyMd">
          {body}
        </Text>
        <Text as="p" variant="bodySm" tone="subdued">
          {`${MONEY_EFFECT_WORD[tool.keepsMoney]}. ${tool.costNote}`}
        </Text>
        {/* The thing the vendor page does not lead with, kept verbatim. */}
        <Text as="p" variant="bodySm" tone="subdued">
          {tool.caveat}
        </Text>
      </BlockStack>
      <Box>
        <BlockStack gap="100" inlineAlign="start">
          {badges}
        </BlockStack>
      </Box>
    </InlineGrid>
  );
}

function RecommendedRow({ item }: { item: ProtectionRecommendation }) {
  const free = !Number.isFinite(item.monthlyCost) || item.monthlyCost <= 0;

  return (
    <ToolRow
      tool={item.tool}
      body={item.rationale}
      badges={
        <>
          <Badge tone={free ? "success" : "attention"}>{monthlyCostLabel(item.monthlyCost)}</Badge>
          <Badge tone={RATIO_EFFECT_TONE[item.tool.removesFromRatio]}>
            {RATIO_EFFECT_WORD[item.tool.removesFromRatio]}
          </Badge>
        </>
      }
    />
  );
}

function AvoidRow({ item }: { item: ProtectionWarning }) {
  return (
    <ToolRow
      tool={item.tool}
      body={item.reason}
      badges={
        <>
          <Badge tone="critical">Not worth buying</Badge>
          <Badge>{perEventLabel(item.tool)}</Badge>
          <Badge tone={RATIO_EFFECT_TONE[item.tool.removesFromRatio]}>
            {RATIO_EFFECT_WORD[item.tool.removesFromRatio]}
          </Badge>
        </>
      }
    />
  );
}

/**
 * Rows share one divider rule, so both lists sit on the same rhythm. Keys come
 * from the tool rather than the array index: the lists are rebuilt from a new
 * position on every load, and a tool can move between them.
 */
function RowList({ rows }: { rows: Array<{ key: string; row: React.ReactNode }> }) {
  return (
    <BlockStack gap="0">
      {rows.map((entry, index) => (
        <Box key={entry.key} padding="400">
          {entry.row}
          {index < rows.length - 1 ? <Divider /> : null}
        </Box>
      ))}
    </BlockStack>
  );
}

export function ProtectionLadder({ protection }: ProtectionLadderProps) {
  // No threshold in play means there is no position to price a product against.
  // An empty card would still be a claim; nothing is the honest render.
  if (!protection) {
    return null;
  }

  return (
    <BlockStack gap="400">
      <ResourceSection
        title="Worth buying at your position"
        description="Free instruments first, then cheapest, which is the order to act in. Figures are monthly and USD-shaped - the model prices against Shopify's USD chargeback fee and USD vendor list prices."
        flush
      >
        {protection.recommended.length > 0 ? (
          <RowList
            rows={protection.recommended.map((item) => ({
              key: item.tool.key,
              row: <RecommendedRow item={item} />
            }))}
          />
        ) : (
          <Box padding="400">
            <Text as="p" variant="bodyMd">
              Buy nothing. At your position every instrument on this list costs more than the ratio slot it buys, and
              that is the answer rather than a gap in it.
            </Text>
          </Box>
        )}
      </ResourceSection>

      {/*
        Equal billing with the list above, and directly under it. A merchant
        arrives at this page having been sold to already, so the useful thing
        this app can do is name the product that will not help and say why.
      */}
      <ResourceSection
        title="Not worth buying at your position"
        description="Each of these is sold as ratio protection. At your ratio, your fraud mix and your average order value, each one buys less than it costs."
        flush
      >
        {protection.avoid.length > 0 ? (
          <RowList
            rows={protection.avoid.map((item) => ({
              key: item.tool.key,
              row: <AvoidRow item={item} />
            }))}
          />
        ) : (
          <Box padding="400">
            <Text as="p" variant="bodyMd">
              Nothing to rule out at your position. Everything priced that could reach your disputes is on the list
              above.
            </Text>
          </Box>
        )}
      </ResourceSection>

      <ResourceSection
        title="Why these are the answers"
        description="The reasoning behind both lists, so you can check it instead of trusting it."
        flush
      >
        <Box padding="400">
          <List>
            {protection.reasoning.map((line) => (
              <List.Item key={line}>{line}</List.Item>
            ))}
          </List>
        </Box>
      </ResourceSection>
    </BlockStack>
  );
}
