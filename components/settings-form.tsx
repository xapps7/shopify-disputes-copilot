"use client";

import { useState } from "react";
import { BlockStack, Button, InlineGrid, Text, TextField } from "@shopify/polaris";

import type { MerchantSettings } from "@/lib/settings";

type SettingsFormProps = {
  initialSettings: MerchantSettings;
};

export function SettingsForm({ initialSettings }: SettingsFormProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [returnPolicyUrl, setReturnPolicyUrl] = useState(initialSettings.returnPolicyUrl);
  const [refundPolicyUrl, setRefundPolicyUrl] = useState(initialSettings.refundPolicyUrl);
  const [supportEmail, setSupportEmail] = useState(initialSettings.supportEmail);
  const [supportPhone, setSupportPhone] = useState(initialSettings.supportPhone);
  const [statementDescriptor, setStatementDescriptor] = useState(initialSettings.statementDescriptor);
  const [packetFooter, setPacketFooter] = useState(initialSettings.packetFooter);

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
    <form action={handleSubmit} className="polaris-form">
      <BlockStack gap="400">
        <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
          <TextField
            autoComplete="url"
            label="Return policy URL"
            name="returnPolicyUrl"
            onChange={setReturnPolicyUrl}
            placeholder="https://example.com/returns"
            value={returnPolicyUrl}
          />
          <TextField
            autoComplete="url"
            label="Refund policy URL"
            name="refundPolicyUrl"
            onChange={setRefundPolicyUrl}
            placeholder="https://example.com/refunds"
            value={refundPolicyUrl}
          />
          <TextField
            autoComplete="email"
            label="Support email"
            name="supportEmail"
            onChange={setSupportEmail}
            placeholder="support@example.com"
            value={supportEmail}
          />
          <TextField
            autoComplete="tel"
            label="Support phone"
            name="supportPhone"
            onChange={setSupportPhone}
            placeholder="+1 555 555 5555"
            value={supportPhone}
          />
        </InlineGrid>

        <TextField
          autoComplete="off"
          label="Statement descriptor"
          name="statementDescriptor"
          onChange={setStatementDescriptor}
          placeholder="DISPUTES COPILOT"
          value={statementDescriptor}
        />

        <TextField
          autoComplete="off"
          label="Packet footer note"
          multiline={5}
          name="packetFooter"
          onChange={setPacketFooter}
          placeholder="Add a short merchant note that appears at the end of generated packet drafts."
          value={packetFooter}
        />

        <div className="polaris-actions">
          <Button loading={isSaving} submit variant="primary">
            Save settings
          </Button>
          {message ? (
            <Text as="p" tone="subdued">
              {message}
            </Text>
          ) : null}
        </div>
      </BlockStack>
    </form>
  );
}
