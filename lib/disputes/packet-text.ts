/**
 * Which text a download should actually contain.
 *
 * THE BUG THIS FIXES: the download route called `buildPacketSummary` every
 * time, so it regenerated the packet from the database and ignored
 * `EvidencePacket.summaryText` entirely. The packet editor saved the merchant's
 * narrative, the timeline recorded EVIDENCE_PACKET_EDITED, and the file they
 * then downloaded had none of it. Editing appeared to work and silently did
 * nothing.
 *
 * Saved text wins whenever it exists. It is the merchant's own words about
 * their own case, which is better evidence than anything generated from field
 * values - and if they took the trouble to write it, throwing it away is the
 * one behaviour that is definitely wrong.
 *
 * A blank or whitespace-only saved value falls back to the generated summary,
 * so an accidentally-cleared editor does not hand the merchant an empty file.
 */
export function resolvePacketText(
  savedSummaryText: string | null | undefined,
  generated: string
): { text: string; source: "merchant" | "generated" } {
  const saved = savedSummaryText?.trim();

  if (saved) {
    return { text: saved, source: "merchant" };
  }

  return { text: generated, source: "generated" };
}
