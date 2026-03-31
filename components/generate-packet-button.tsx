"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { BlockStack, Button, Text } from "@shopify/polaris";

type GeneratePacketButtonProps = {
  disputeId: string;
};

export function GeneratePacketButton({ disputeId }: GeneratePacketButtonProps) {
  const router = useRouter();
  const [isGenerating, setIsGenerating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleGenerate() {
    setIsGenerating(true);
    setMessage(null);

    const response = await fetch(`/api/disputes/${disputeId}/packet`, {
      method: "POST"
    });

    const payload = (await response.json().catch(() => null)) as
      | { message?: string; packetUrl?: string }
      | null;

    setMessage(
      payload?.packetUrl
        ? `Packet generated: ${payload.packetUrl}`
        : (payload?.message ?? (response.ok ? "Packet generated." : "Packet generation failed."))
    );

    if (response.ok) {
      startTransition(() => {
        router.refresh();
      });
    }

    setIsGenerating(false);
  }

  return (
    <BlockStack gap="300">
      <Button loading={isGenerating} onClick={handleGenerate} variant="primary">
        {isGenerating ? "Generating..." : "Generate packet draft"}
      </Button>
      {message ? (
        <Text as="p" tone="subdued" variant="bodySm">
          {message}
        </Text>
      ) : null}
    </BlockStack>
  );
}
