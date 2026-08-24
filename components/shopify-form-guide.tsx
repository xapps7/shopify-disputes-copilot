"use client";

import { Badge, BlockStack, Box, Card, InlineStack, Text } from "@shopify/polaris";

import { EVIDENCE_FILE_SLOTS, SHOPIFY_FILE_RULES } from "@/lib/disputes/evidence-fields";

/**
 * Shopify's own Chargeback response page, described so a merchant knows what is
 * already handled and what is genuinely theirs to do.
 *
 * Shopify attaches things to every response without being asked. A merchant who
 * does not know that spends an evening screenshotting an IP address Shopify
 * already sent - and worse, an app that lists "add your IP evidence" as an
 * outstanding task is what sent them there. So this panel exists to REMOVE
 * work, which is an unusual thing for a product surface to do and the reason it
 * earns its place.
 *
 * A CORRECTION WORTH KEEPING: this file once listed exactly the four badges
 * below, transcribed from a real Chargeback response page. It was then
 * "corrected" to Shopify's help-centre list - product details, carrier and
 * tracking, fulfilment date, both addresses, order date, IP and IP country - on
 * the grounds that the badges were invented. They were not. Both lists are
 * true and they answer different questions: the help centre describes what
 * Shopify TRANSMITS to the bank, the badges are what the merchant SEES on the
 * form. This is a hand-off screen, so what they see is what belongs here, and
 * the transmitted list is the footnote.
 */

/** The four badges under "Shopify provided evidence", verbatim. */
const SHOPIFY_SUPPLIED = [
  { label: "Customer Activity", note: "Order and browsing history Shopify holds on this customer." },
  { label: "AVS match", note: "Whether the billing address matched at authorisation." },
  { label: "CVV pass", note: "Whether the security code checked out." },
  { label: "Customer IP address", note: "The address the order was placed from." }
] as const;

/**
 * What Shopify actually sends to the bank, which is more than the badges show.
 * From "Resolving a chargeback or inquiry". Kept because it is the real reason
 * a merchant does not need to gather these facts - the badges are only the
 * summary of it on screen.
 */
const ALSO_TRANSMITTED = [
  "Product details - title, variants and quantity",
  "Carrier and tracking number",
  "The date and time the order was fulfilled",
  "Shipping and billing address",
  "The date the order was placed",
  "The customer's IP address and its country"
] as const;

export function ShopifyFormGuide() {
  const onForm = EVIDENCE_FILE_SLOTS.filter((slot) => slot.onFormByDefault);
  const conditional = EVIDENCE_FILE_SLOTS.filter((slot) => !slot.onFormByDefault);

  return (
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="100">
          <Text as="h2" variant="headingMd">
            What Shopify sends without being asked
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            These four appear on the Chargeback response page under &ldquo;Shopify provided evidence&rdquo;. You do not
            need to gather them, screenshot them, or repeat them in your text.
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
              And these go to the bank too, without a badge
            </Text>
            <BlockStack gap="050">
              {ALSO_TRANSMITTED.map((item) => (
                <Text as="p" key={item} tone="subdued" variant="bodyXs">
                  {`· ${item}`}
                </Text>
              ))}
            </BlockStack>
          </BlockStack>
        </Box>

        <Box borderColor="border" borderBlockStartWidth="025" paddingBlockStart="400">
          <BlockStack gap="200">
            <Text as="h3" variant="headingSm">
              The four slots you fill yourself
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              In Shopify&rsquo;s order, with Shopify&rsquo;s words, so you are matching labels rather than translating
              while the clock runs. Prepare each one above, download it, and attach it in the admin under
              &ldquo;Supporting evidence provided by you&rdquo;.
            </Text>

            <BlockStack gap="150">
              {onForm.map((slot, index) => (
                <Text as="p" variant="bodySm" key={slot.key}>
                  {`${index + 1}. ${slot.label}`}
                </Text>
              ))}
            </BlockStack>
          </BlockStack>
        </Box>

        <Box borderColor="border" borderBlockStartWidth="025" paddingBlockStart="400">
          <BlockStack gap="200">
            <Text as="h3" variant="headingSm">
              Two more the form may not show you yet
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {`Shopify's API accepts ${conditional
                .map((slot) => slot.label.toLowerCase())
                .join(" and ")}, but the page opens with four upload rows and not six. They appear to depend on which reason you pick, so prepare them here and check the form after choosing a reason.`}
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
