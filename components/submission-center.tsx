"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  InlineStack,
  Link as PolarisLink,
  Select,
  Text,
  TextField
} from "@shopify/polaris";

import { formatDateTime } from "@/lib/format/date";
import { shopifyAdminOrderUrl, shopifyAdminOrdersUrl } from "@/lib/format/shopify-admin";
import { authenticatedFetch } from "@/components/authenticated-fetch";

type SubmissionCenterProps = {
  disputeId: string;
  packetReady: boolean;
  packetStatus: string | null;
  submittedAt: string | null;
  evidenceSentOn: string | null;
  shopDomain?: string | null;
  shopifyDisputeId?: string | null;
  shopifyOrderId?: string | null;
};

export function SubmissionCenter({
  disputeId,
  packetReady,
  packetStatus,
  submittedAt,
  evidenceSentOn,
  shopDomain = null,
  shopifyDisputeId = null,
  shopifyOrderId = null
}: SubmissionCenterProps) {
  const router = useRouter();
  const [method, setMethod] = useState("SHOPIFY_ADMIN");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const adminUrl = shopifyAdminOrderUrl(shopDomain, shopifyOrderId) ?? shopifyAdminOrdersUrl(shopDomain);
  const recordedAt = submittedAt ?? evidenceSentOn ?? null;

  async function handleSubmit() {
    setIsSubmitting(true);
    setMessage(null);

    const response = await authenticatedFetch(`/api/disputes/${disputeId}/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ method, notes })
    });

    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    setMessage(
      response.ok
        ? "Saved to this app only. Nothing was sent to Shopify."
        : (payload?.message ?? "Could not save this note.")
    );

    if (response.ok) {
      startTransition(() => {
        router.refresh();
      });
    }

    setIsSubmitting(false);
  }

  return (
    <BlockStack gap="300">
      <Banner tone="warning">
        <p>
          This only writes a note in Disputes Co-Pilot. It does not submit evidence to Shopify or the card issuer.
          Submit the packet in Shopify Admin first, then record it here so your team knows it is done.
        </p>
      </Banner>

      <BlockStack gap="150">
        <InlineStack align="space-between">
          <Text as="p" variant="bodySm" tone="subdued">
            Packet status
          </Text>
          <Badge tone={packetReady ? "success" : "warning"}>{packetStatus ?? "Not generated"}</Badge>
        </InlineStack>
        <InlineStack align="space-between">
          <Text as="p" variant="bodySm" tone="subdued">
            Recorded in this app
          </Text>
          <Text as="p" variant="bodySm">
            {recordedAt ? formatDateTime(recordedAt) : "Not recorded"}
          </Text>
        </InlineStack>
      </BlockStack>

      {adminUrl ? (
        <PolarisLink url={adminUrl} target="_blank">
          Open this dispute in Shopify Admin
        </PolarisLink>
      ) : null}

      <Select
        label="Where did you submit it?"
        options={[
          { label: "Shopify Admin", value: "SHOPIFY_ADMIN" },
          { label: "Bank / processor portal", value: "PROCESSOR_PORTAL" },
          { label: "Email / support handoff", value: "EMAIL_HANDOFF" }
        ]}
        value={method}
        onChange={setMethod}
      />

      <TextField
        autoComplete="off"
        label="Submission notes"
        multiline={3}
        value={notes}
        onChange={setNotes}
        placeholder="Add a short note about how and where you submitted the packet."
      />

      <Button disabled={!packetReady} loading={isSubmitting} onClick={handleSubmit} variant="primary">
        Record submission in this app
      </Button>

      {!packetReady ? (
        <Text as="p" variant="bodySm" tone="subdued">
          Generate a packet draft before recording submission.
        </Text>
      ) : null}

      {message ? (
        <Text as="p" variant="bodySm" tone="subdued">
          {message}
        </Text>
      ) : null}
    </BlockStack>
  );
}
