"use client";

import { Badge, BlockStack, Box, Card, InlineStack, Text } from "@shopify/polaris";

import { SHOPIFY_FILE_RULES } from "@/lib/disputes/evidence-fields";

/**
 * Shopify's own chargeback response page, described so a merchant knows what is
 * already handled and what is genuinely theirs to do.
 *
 * Shopify attaches a set of order facts to every response without being asked.
 * A merchant who does not know that spends an evening screenshotting an IP
 * address Shopify already sent - and worse, an app that presents "add your IP
 * evidence" as an outstanding task is the thing that sent them there.
 *
 * So this panel exists to REMOVE work, which is an unusual thing for a product
 * surface to do and the reason it earns its place.
 *
 * The list below is Shopify's own, from "Resolving a chargeback or inquiry".
 * A previous version of this file listed four items - Customer Activity, AVS
 * match, CVV pass, IP address - which were partly invented. Shopify's published
 * list is longer and does not mention AVS or CVV at all.
 * https://help.shopify.com/en/manual/payments/chargebacks/resolve-chargeback
 */

/** What Shopify attaches on the merchant's behalf, in Shopify's own words. */
const SHOPIFY_SUPPLIED = [
  { label: "Product details", note: "Title, variants and quantity purchased." },
  { label: "Shipping and tracking", note: "The carrier used and the tracking number." },
  { label: "Fulfilment date", note: "The date and time the order was fulfilled." },
  { label: "Shipping and billing address", note: "Both, taken from the order." },
  { label: "Order date", note: "When the order was placed." },
  { label: "Customer IP", note: "The address the order was placed from, and its country." }
] as const;

export function ShopifyFormGuide() {
  return (
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="100">
          <Text as="h2" variant="headingMd">
            What Shopify sends without being asked
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            These are attached to every response automatically. You do not need to gather them, screenshot them, or
            repeat them in your text - and time spent on them is time not spent on the evidence that decides the case.
          </Text>
        </BlockStack>

        <InlineStack gap="200" wrap>
          {SHOPIFY_SUPPLIED.map((item) => (
            <Badge key={item.label} tone="success">
              {item.label}
            </Badge>
          ))}
        </InlineStack>

        <BlockStack gap="100">
          {SHOPIFY_SUPPLIED.map((item) => (
            <Text as="p" variant="bodyXs" tone="subdued" key={item.label}>
              {`${item.label} — ${item.note}`}
            </Text>
          ))}
        </BlockStack>

        <Box borderColor="border" borderBlockStartWidth="025" paddingBlockStart="400">
          <BlockStack gap="200">
            <Text as="h3" variant="headingSm">
              What happens if you do nothing
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Shopify submits that list on its own at the deadline. It is a response, so the case is not forfeited -
              but it contains no policy, no customer communication, and nothing arguing your side. Everything you
              prepare above is what turns it into a case.
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              You can also submit early. Once you do, Shopify locks the evidence and no further edits are possible.
            </Text>
          </BlockStack>
        </Box>

        <Box borderColor="border" borderBlockStartWidth="025" paddingBlockStart="400">
          <BlockStack gap="200">
            <Text as="h3" variant="headingSm">
              Shopify&rsquo;s file rules
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              None of these produce an error until submission, so they are worth knowing before you scan anything.
            </Text>
            <BlockStack gap="050">
              {SHOPIFY_FILE_RULES.map((rule) => (
                <Text as="p" key={rule} tone="subdued" variant="bodyXs">
                  {`· ${rule}`}
                </Text>
              ))}
            </BlockStack>
          </BlockStack>
        </Box>
      </BlockStack>
    </Card>
  );
}
