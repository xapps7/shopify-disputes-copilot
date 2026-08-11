"use client";

import { startTransition, useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Banner, BlockStack, List, Text } from "@shopify/polaris";

import { formatDateTime } from "@/lib/format/date";
import { authenticatedFetch } from "@/components/authenticated-fetch";

export type DisputeSyncResult = {
  ok: boolean;
  synced: number;
  warnings: string[];
  sources: Record<string, number>;
  message: string | null;
  completedAt: string;
};

type SyncResponsePayload = {
  ok?: boolean;
  synced?: number;
  warnings?: string[];
  sources?: Record<string, number>;
  message?: string;
};

/**
 * `/api/sync/disputes` returns `warnings` and `sources`. Both call sites used to
 * throw them away and print "Synced N disputes." as subdued grey text, so a sync
 * that reached Shopify but returned nothing looked identical to a healthy sync.
 */
export function useDisputeSync() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isSyncing, setIsSyncing] = useState(false);
  const [result, setResult] = useState<DisputeSyncResult | null>(null);

  const runSync = useCallback(async () => {
    setIsSyncing(true);
    setResult(null);

    const params = new URLSearchParams();
    const shop = searchParams.get("shop");
    if (shop) {
      params.set("shop", shop);
    }

    try {
      const response = await authenticatedFetch(
        `/api/sync/disputes${params.toString() ? `?${params.toString()}` : ""}`,
        { method: "POST" }
      );
      const payload = (await response.json().catch(() => null)) as SyncResponsePayload | null;

      setResult({
        ok: response.ok,
        synced: payload?.synced ?? 0,
        warnings: payload?.warnings ?? [],
        sources: payload?.sources ?? {},
        message: payload?.message ?? (response.ok ? null : "Dispute sync failed."),
        completedAt: new Date().toISOString()
      });

      if (response.ok) {
        startTransition(() => {
          router.refresh();
        });
      }
    } catch (error) {
      setResult({
        ok: false,
        synced: 0,
        warnings: [],
        sources: {},
        message: error instanceof Error ? error.message : "Dispute sync failed.",
        completedAt: new Date().toISOString()
      });
    } finally {
      setIsSyncing(false);
    }
  }, [router, searchParams]);

  return { isSyncing, result, runSync };
}

function formatSources(sources: Record<string, number>) {
  const entries = Object.entries(sources);

  if (entries.length === 0) {
    return null;
  }

  return entries
    .map(([key, value]) => `${key.replace(/([A-Z])/g, " $1").toLowerCase().trim()}: ${value}`)
    .join(" · ");
}

type SyncStatusBannerProps = {
  result: DisputeSyncResult | null;
  onDismiss?: () => void;
};

export function SyncStatusBanner({ result, onDismiss }: SyncStatusBannerProps) {
  if (!result) {
    return null;
  }

  const lastSynced = `Last synced ${formatDateTime(result.completedAt)}`;
  const sources = formatSources(result.sources);

  if (!result.ok) {
    return (
      <Banner tone="critical" title="Dispute sync failed" onDismiss={onDismiss}>
        <BlockStack gap="100">
          <p>{result.message ?? "Dispute sync failed."}</p>
          <Text as="p" variant="bodySm" tone="subdued">
            {lastSynced}
          </Text>
        </BlockStack>
      </Banner>
    );
  }

  const hasWarnings = result.warnings.length > 0;

  return (
    <Banner
      tone={hasWarnings ? "warning" : "success"}
      title={
        hasWarnings
          ? `Synced ${result.synced} disputes with ${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"}`
          : `Synced ${result.synced} disputes`
      }
      onDismiss={onDismiss}
    >
      <BlockStack gap="100">
        {hasWarnings ? (
          <>
            <p>Some dispute sources did not return data. The queue below may be incomplete.</p>
            <List type="bullet">
              {result.warnings.map((warning) => (
                <List.Item key={warning}>{warning}</List.Item>
              ))}
            </List>
          </>
        ) : null}
        {sources ? (
          <Text as="p" variant="bodySm" tone="subdued">
            {`Sources — ${sources}`}
          </Text>
        ) : null}
        <Text as="p" variant="bodySm" tone="subdued">
          {lastSynced}
        </Text>
      </BlockStack>
    </Banner>
  );
}
