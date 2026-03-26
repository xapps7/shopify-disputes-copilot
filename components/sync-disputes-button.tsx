"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";

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
    <div className="sync-action">
      <button className="pill-link button-reset" disabled={isSyncing} onClick={handleSync} type="button">
        {isSyncing ? "Syncing..." : "Sync recent disputes"}
      </button>
      {message ? <p className="sync-message">{message}</p> : null}
    </div>
  );
}
