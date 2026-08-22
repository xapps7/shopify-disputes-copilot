"use client";

import { Badge, BlockStack, Box, Card, InlineStack, Text } from "@shopify/polaris";

/**
 * Shopify's own evidence form, described so a merchant knows what is already
 * handled and what is genuinely theirs to do.
 *
 * Shopify attaches four things to every chargeback response without being
 * asked: customer activity, the AVS result, the CVV result, and the customer's
 * IP address. A merchant who does not know that spends an evening screenshotting
 * an IP address Shopify already sent - and worse, an app that presents "add your
 * IP evidence" as an outstanding task is the thing that sent them there.
 *
 * So this panel exists to REMOVE work, which is an unusual thing for a product
 * surface to do and the reason it earns its place.
 *
 * The four upload slots mirror what Shopify's form actually shows, in its
 * wording rather than the API's, so the merchant is matching labels rather than
 * translating between two vocabularies while a deadline runs.
 */

/** What Shopify attaches on the merchant's behalf, per its own evidence form. */
const SHOPIFY_SUPPLIED = [
  { label: "Customer Activity", note: "Order and browsing history Shopify holds on this customer." },
  { label: "AVS match", note: "Whether the billing address matched at authorisation." },
  { label: "CVV pass", note: "Whether the security code checked out." },
  { label: "Customer IP address", note: "The address the order was placed from." }
] as const;

/**
 * Shopify's four visible upload slots, in its own words.
 *
 * The API has six writable file fields, but the form shows four unless the
 * reason code calls for a policy document. Listing all six would send a merchant
 * hunting for slots that are not on their screen.
 */
const SHOPIFY_SLOTS = [
  { label: "Customer communication", note: "Emails, chat transcripts, order confirmations." },
  { label: "Shipping documentation", note: "Carrier label, manifest, proof of delivery." },
  { label: "Proof of service", note: "For anything delivered rather than shipped." },
  { label: "Any other evidence that supports your case", note: "Everything with no slot of its own." }
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
            These four are attached to every response automatically. You do not need to gather them, screenshot them,
            or mention them - and time spent on them is time not spent on the evidence that decides the case.
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
              The four slots you fill yourself
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Named as Shopify names them, so you are matching labels rather than translating while the clock runs.
              Prepare each one below, then download the file and attach it in the admin.
            </Text>

            <BlockStack gap="150">
              {SHOPIFY_SLOTS.map((slot) => (
                <BlockStack gap="050" key={slot.label}>
                  <Text as="p" variant="bodySm" fontWeight="medium">
                    {slot.label}
                  </Text>
                  <Text as="p" variant="bodyXs" tone="subdued">
                    {slot.note}
                  </Text>
                </BlockStack>
              ))}
            </BlockStack>
          </BlockStack>
        </Box>
      </BlockStack>
    </Card>
  );
}
