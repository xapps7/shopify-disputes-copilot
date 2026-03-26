"use client";

import { useState } from "react";

import type { MerchantSettings } from "@/lib/settings";

type SettingsFormProps = {
  initialSettings: MerchantSettings;
};

export function SettingsForm({ initialSettings }: SettingsFormProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(formData: FormData) {
    setIsSaving(true);
    setMessage(null);

    const response = await fetch("/api/settings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        returnPolicyUrl: String(formData.get("returnPolicyUrl") ?? ""),
        refundPolicyUrl: String(formData.get("refundPolicyUrl") ?? ""),
        supportEmail: String(formData.get("supportEmail") ?? ""),
        supportPhone: String(formData.get("supportPhone") ?? ""),
        statementDescriptor: String(formData.get("statementDescriptor") ?? ""),
        packetFooter: String(formData.get("packetFooter") ?? "")
      })
    });

    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    setMessage(payload?.message ?? (response.ok ? "Settings saved." : "Save failed."));
    setIsSaving(false);
  }

  return (
    <form action={handleSubmit} className="stack">
      <input defaultValue={initialSettings.returnPolicyUrl} name="returnPolicyUrl" placeholder="Return policy URL" />
      <input defaultValue={initialSettings.refundPolicyUrl} name="refundPolicyUrl" placeholder="Refund policy URL" />
      <input defaultValue={initialSettings.supportEmail} name="supportEmail" placeholder="Support email" />
      <input defaultValue={initialSettings.supportPhone} name="supportPhone" placeholder="Support phone" />
      <input
        defaultValue={initialSettings.statementDescriptor}
        name="statementDescriptor"
        placeholder="Statement descriptor"
      />
      <textarea
        defaultValue={initialSettings.packetFooter}
        name="packetFooter"
        placeholder="Packet footer note"
        rows={5}
      />
      <button className="pill-link button-reset" disabled={isSaving} type="submit">
        {isSaving ? "Saving..." : "Save settings"}
      </button>
      {message ? <p className="sync-message">{message}</p> : null}
    </form>
  );
}
