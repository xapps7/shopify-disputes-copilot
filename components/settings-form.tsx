"use client";

import { useState } from "react";
import { BlockStack, Button, Checkbox, InlineGrid, Text, TextField } from "@shopify/polaris";

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
  const [alertEmail, setAlertEmail] = useState(initialSettings.alertEmail);
  const [evidenceRetentionDays, setEvidenceRetentionDays] = useState(initialSettings.evidenceRetentionDays);
  const [notifyDueSoon, setNotifyDueSoon] = useState(initialSettings.notifyDueSoon);
  const [notifyMissingEvidence, setNotifyMissingEvidence] = useState(initialSettings.notifyMissingEvidence);
  const [allowManualSubmissionRecording, setAllowManualSubmissionRecording] = useState(
    initialSettings.allowManualSubmissionRecording
  );

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
        packetFooter: String(formData.get("packetFooter") ?? ""),
        alertEmail: String(formData.get("alertEmail") ?? ""),
        evidenceRetentionDays: String(formData.get("evidenceRetentionDays") ?? ""),
        notifyDueSoon,
        notifyMissingEvidence,
        allowManualSubmissionRecording
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

        <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
          <TextField
            autoComplete="email"
            label="Alert email"
            name="alertEmail"
            onChange={setAlertEmail}
            placeholder="ops@example.com"
            value={alertEmail}
          />
          <TextField
            autoComplete="off"
            label="Evidence retention days"
            name="evidenceRetentionDays"
            onChange={setEvidenceRetentionDays}
            placeholder="365"
            value={evidenceRetentionDays}
          />
        </InlineGrid>

        <TextField
          autoComplete="off"
          label="Packet footer note"
          multiline={5}
          name="packetFooter"
          onChange={setPacketFooter}
          placeholder="Add a short merchant note that appears at the end of generated packet drafts."
          value={packetFooter}
        />

        <BlockStack gap="200">
          <Checkbox
            label="Alert when disputes are due within 48 hours"
            checked={notifyDueSoon}
            onChange={setNotifyDueSoon}
          />
          <Checkbox
            label="Alert when evidence is missing on active cases"
            checked={notifyMissingEvidence}
            onChange={setNotifyMissingEvidence}
          />
          <Checkbox
            label="Allow manual submission recording in the dispute workspace"
            checked={allowManualSubmissionRecording}
            onChange={setAllowManualSubmissionRecording}
          />
        </BlockStack>

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
