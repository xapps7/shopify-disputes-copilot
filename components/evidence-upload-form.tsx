"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";

type EvidenceUploadFormProps = {
  disputeId: string;
};

export function EvidenceUploadForm({ disputeId }: EvidenceUploadFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(formData: FormData) {
    setIsSubmitting(true);
    setMessage(null);

    const response = await fetch(`/api/disputes/${disputeId}/evidence`, {
      method: "POST",
      body: formData
    });

    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    setMessage(payload?.message ?? (response.ok ? "Evidence uploaded." : "Upload failed."));

    if (response.ok) {
      startTransition(() => {
        router.refresh();
      });
    }

    setIsSubmitting(false);
  }

  return (
    <form
      action={handleSubmit}
      className="stack"
    >
      <input name="title" placeholder="Evidence title" required />
      <select name="category" defaultValue="CUSTOMER_COMMUNICATION">
        <option value="CUSTOMER_COMMUNICATION">Customer communication</option>
        <option value="REFUND_PROOF">Refund proof</option>
        <option value="SERVICE_DOCUMENTATION">Service documentation</option>
        <option value="POLICY_DISCLOSURE">Policy disclosure</option>
        <option value="OTHER">Other</option>
      </select>
      <textarea name="description" placeholder="Describe why this evidence matters." rows={4} />
      <input name="file" required type="file" />
      <button className="pill-link button-reset" disabled={isSubmitting} type="submit">
        {isSubmitting ? "Uploading..." : "Upload evidence"}
      </button>
      {message ? <p className="sync-message">{message}</p> : null}
    </form>
  );
}
