"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, InlineStack, Text } from "@shopify/polaris";

export function SyncDisputesButton() {
  const router = useRouter();
  const [isSyncing, setIsSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSync() {
    setIsSyncing(true);
    setMessage(null);

    const response = await fetch("/api/sync/disputes", {
      method: "POST"
    });

    const payload = (await response.json().catch(() => null)) as
      | { synced?: number; message?: string }
      | null;

    if (!response.ok) {
      setMessage(payload?.message ?? "Sync failed.");
      setIsSyncing(false);
      return;
    }

    setMessage(`Synced ${payload?.synced ?? 0} disputes.`);
    startTransition(() => {
      router.refresh();
    });
    setIsSyncing(false);
  }

  return (
    <InlineStack align="start" gap="300" blockAlign="center" wrap>
      <Button loading={isSyncing} onClick={handleSync} variant="primary">
        {isSyncing ? "Syncing..." : "Sync recent disputes"}
      </Button>
      {message ? (
        <Text as="p" tone="subdued" variant="bodySm">
          {message}
        </Text>
      ) : null}
    </InlineStack>
  );
}
