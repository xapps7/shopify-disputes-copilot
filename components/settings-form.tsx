"use client";

import { useState } from "react";
import { Banner, BlockStack, Button, Checkbox, InlineGrid, Text, TextField } from "@shopify/polaris";

import type { MerchantSettings } from "@/lib/settings";
import { authenticatedFetch } from "@/components/authenticated-fetch";

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

  async function handleSubmit() {
    setIsSaving(true);
    setMessage(null);

    // Read from component state rather than FormData: the inactive fields below
    // are rendered `disabled`, and disabled inputs are omitted from FormData,
    // which would silently blank the stored values on every save.
    const response = await authenticatedFetch("/api/settings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        returnPolicyUrl,
        refundPolicyUrl,
        supportEmail,
        supportPhone,
        statementDescriptor,
        packetFooter,
        alertEmail,
        evidenceRetentionDays,
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

        <TextField
          autoComplete="off"
          label="Packet footer note"
          multiline={5}
          name="packetFooter"
          onChange={setPacketFooter}
          placeholder="Add a short merchant note that appears at the end of generated packet drafts."
          value={packetFooter}
        />

        <Checkbox
          label="Allow manual submission recording in the dispute workspace"
          checked={allowManualSubmissionRecording}
          onChange={setAllowManualSubmissionRecording}
        />

        <BlockStack gap="300">
          <Text as="h3" variant="headingSm">
            Not active yet
          </Text>
          <Banner tone="warning" title="These settings are saved but not used yet">
            <p>
              Disputes Co-Pilot does not send any email and does not delete files on a schedule. The values below are
              stored on your merchant record so they are ready when those features ship — until then, nothing here
              will alert you before Shopify auto-submits a response for you. The dispute queue is the only place that
              countdown appears, so check it.
            </p>
          </Banner>

          <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
            <TextField
              autoComplete="email"
              disabled
              helpText="Not active yet — no email is sent."
              label="Alert email"
              name="alertEmail"
              onChange={setAlertEmail}
              placeholder="ops@example.com"
              value={alertEmail}
            />
            <TextField
              autoComplete="off"
              disabled
              helpText="Not active yet — files are never deleted automatically."
              label="Evidence retention days"
              name="evidenceRetentionDays"
              onChange={setEvidenceRetentionDays}
              placeholder="365"
              value={evidenceRetentionDays}
            />
          </InlineGrid>

          <BlockStack gap="200">
            <Checkbox
              disabled
              helpText="Not active yet — no alert is sent."
              label="Alert when disputes are due within 48 hours"
              checked={notifyDueSoon}
              onChange={setNotifyDueSoon}
            />
            <Checkbox
              disabled
              helpText="Not active yet — no alert is sent."
              label="Alert when evidence is missing on active cases"
              checked={notifyMissingEvidence}
              onChange={setNotifyMissingEvidence}
            />
          </BlockStack>
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
