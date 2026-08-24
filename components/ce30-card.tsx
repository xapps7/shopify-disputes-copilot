"use client";

import { Badge, BlockStack, Card, Divider, InlineStack, List, Text } from "@shopify/polaris";

import { CE30_ELEMENT_LABELS, type Ce30Result } from "@/lib/disputes/ce30";
import { formatDate } from "@/lib/format/date";

/**
 * Visa Compelling Evidence 3.0, said out loud.
 *
 * Every other card on this page is about recovering the money. This one is about
 * the count: a won 10.4 dispute is still a chargeback for VAMP purposes, so a
 * merchant can fight perfectly and still be put in a monitoring programme. CE
 * 3.0 is the only response that moves both, which is why it is worth a card of
 * its own next to the strategy recommendation.
 *
 * The card is only rendered for Visa 10.4 disputes - the repository returns null
 * for everything else, so a duplicate-charge dispute never gets a verdict about
 * a rule that was never in play.
 *
 * WHY THE BLOCKERS ARE PRINTED VERBATIM: `assessCe30` writes them as sentences a
 * merchant can act on, naming which criterion failed and by how much. Shortening
 * them to fit a card would turn "2 orders fell outside the window (2 newer than
 * 120 days)" - which says wait and re-check - into "not eligible", which says
 * give up.
 *
 * Colour never carries the verdict on its own (WCAG 1.4.1): the badge says
 * "Qualifies" or "Does not qualify" in words, and the sentence under it repeats
 * it. Nothing here reads the clock, so the render is identical on server and
 * client.
 */
export function Ce30Card({ ce30 }: { ce30: Ce30Result }) {
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center" gap="200" wrap>
          <Text as="h2" variant="headingSm">
            Visa Compelling Evidence 3.0
          </Text>
          <Badge tone={ce30.eligible ? "success" : "info"}>
            {ce30.eligible ? "Qualifies" : "Does not qualify"}
          </Badge>
        </InlineStack>

        {ce30.eligible ? (
          <BlockStack gap="300">
            <Text as="p" variant="headingMd">
              This dispute qualifies for Compelling Evidence 3.0.
            </Text>

            <Text as="p" variant="bodyMd">
              Submit it as a CE 3.0 claim rather than an ordinary fraud response. It is the only argument that
              does both things: Visa reassigns liability for the money, and the transaction comes out of the fraud
              count the card networks monitor you against. Winning a normal fraud response returns the money and
              leaves that count exactly where it was.
            </Text>

            <BlockStack gap="150">
              <Text as="h3" variant="headingSm">
                Cite these two prior orders
              </Text>
              {/*
                Named, because the merchant has to type them into Shopify's form.
                Dates are formatted in UTC through the shared formatter, so the
                order shown here is the order the window was measured against.
              */}
              <List type="bullet">
                {ce30.qualifyingOrders.map((order) => (
                  <List.Item key={order.orderId}>
                    {`${order.orderName} — ordered ${formatDate(order.processedAt)}`}
                  </List.Item>
                ))}
              </List>
            </BlockStack>

            <BlockStack gap="150">
              <Text as="h3" variant="headingSm">
                Matching data elements
              </Text>
              <List type="bullet">
                {ce30.matchedElements.map((element) => (
                  <List.Item key={element}>{CE30_ELEMENT_LABELS[element]}</List.Item>
                ))}
              </List>
              <Text as="p" variant="bodySm" tone="subdued">
                Both prior orders share these with the disputed order. Visa requires two, one of them the IP
                address or the device fingerprint.
              </Text>
            </BlockStack>
          </BlockStack>
        ) : (
          <BlockStack gap="300">
            <Text as="p" variant="headingMd">
              This dispute does not qualify for Compelling Evidence 3.0.
            </Text>

            <Text as="p" variant="bodyMd" tone="subdued">
              CE 3.0 is the only remedy that also removes a dispute from your fraud ratio, so it is worth knowing
              exactly what is missing. Everything else on this page still applies.
            </Text>

            <BlockStack gap="150">
              <Text as="h3" variant="headingSm">
                What is missing
              </Text>
              <List type="bullet">
                {ce30.blockers.map((blocker) => (
                  <List.Item key={blocker}>{blocker}</List.Item>
                ))}
              </List>
            </BlockStack>
          </BlockStack>
        )}

        {/*
          Caveats render either way. They are limits of the data this app can
          see - not reasons to refuse a claim that qualifies, and not comfort
          for one that does not.
        */}
        {ce30.caveats.length > 0 ? (
          <BlockStack gap="150">
            <Divider />
            <Text as="h3" variant="headingSm">
              Limits of this check
            </Text>
            <List type="bullet">
              {ce30.caveats.map((caveat) => (
                <List.Item key={caveat}>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {caveat}
                  </Text>
                </List.Item>
              ))}
            </List>
          </BlockStack>
        ) : null}
      </BlockStack>
    </Card>
  );
}
