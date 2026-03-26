"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";

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
    <div className="stack">
      <button className="pill-link button-reset" disabled={isGenerating} onClick={handleGenerate} type="button">
        {isGenerating ? "Generating..." : "Generate packet draft"}
      </button>
      {message ? <p className="sync-message">{message}</p> : null}
    </div>
  );
}
