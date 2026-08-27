"use client";

import { useState } from "react";
import { Banner, BlockStack, Button, Checkbox, InlineGrid, Text, TextField } from "@shopify/polaris";

import type { MerchantSettings } from "@/lib/settings";
import { authenticatedFetch } from "@/components/authenticated-fetch";
import { describeRetentionPolicy, parseRetentionDays } from "@/lib/compliance/retention";

type SettingsFormProps = {
  initialSettings: MerchantSettings;
};

export function SettingsForm({ initialSettings }: SettingsFormProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [returnPolicyUrl, setReturnPolicyUrl] = useState(initialSettings.returnPolicyUrl);
  const [refundPolicyUrl, setRefundPolicyUrl] = useState(initialSettings.refundPolicyUrl);
  const [cancellationPolicyUrl, setCancellationPolicyUrl] = useState(initialSettings.cancellationPolicyUrl);
  const [supportEmail, setSupportEmail] = useState(initialSettings.supportEmail);
  const [supportPhone, setSupportPhone] = useState(initialSettings.supportPhone);
  const [statementDescriptor, setStatementDescriptor] = useState(initialSettings.statementDescriptor);
  const [packetFooter, setPacketFooter] = useState(initialSettings.packetFooter);
  const [alertEmail, setAlertEmail] = useState(initialSettings.alertEmail);
  const [alertWebhookUrl, setAlertWebhookUrl] = useState(initialSettings.alertWebhookUrl);
  const [evidenceRetentionDays, setEvidenceRetentionDays] = useState(initialSettings.evidenceRetentionDays);
  const [notifyDueSoon, setNotifyDueSoon] = useState(initialSettings.notifyDueSoon);
  const [notifyMissingEvidence, setNotifyMissingEvidence] = useState(initialSettings.notifyMissingEvidence);
  const [notifyDecided, setNotifyDecided] = useState(initialSettings.notifyDecided);
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
        cancellationPolicyUrl,
        supportEmail,
        supportPhone,
        statementDescriptor,
        packetFooter,
        alertEmail,
        alertWebhookUrl,
        evidenceRetentionDays,
        notifyDueSoon,
        notifyMissingEvidence,
        notifyDecided,
        allowManualSubmissionRecording
      })
    });

    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    setMessage(payload?.message ?? (response.ok ? "Settings saved." : "Save failed."));
    setIsSaving(false);
  }

  /**
   * Proves the email path before a chargeback depends on it.
   *
   * Surfaces the provider's own message rather than a generic failure: every
   * likely fault here is one only the merchant can fix - an address that is not
   * theirs, an unverified sending domain, a revoked key - and "could not send"
   * tells them none of that.
   */
  async function handleTestEmail() {
    setIsTesting(true);
    setTestResult(null);

    try {
      const response = await authenticatedFetch("/api/settings/test-email", { method: "POST" });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; message?: string }
        | null;

      setTestResult({
        ok: Boolean(payload?.ok),
        message: payload?.message ?? "The app could not reach the email provider."
      });
    } catch {
      setTestResult({ ok: false, message: "The request failed before it reached the app." });
    } finally {
      setIsTesting(false);
    }
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
            autoComplete="url"
            helpText="Only if you sell subscriptions or services. Used to draft the cancellation policy disclosure."
            label="Cancellation policy URL"
            name="cancellationPolicyUrl"
            onChange={setCancellationPolicyUrl}
            placeholder="https://example.com/cancellation"
            value={cancellationPolicyUrl}
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
          <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
            {/*
              This field was `disabled` under a banner reading "Disputes
              Co-Pilot does not send any email" - which stayed there after the
              email actually shipped. A merchant could not type an address, so
              alerts silently fell back to the support email, and a test send
              reported success to an address they had never chosen for alerts.
            */}
            <TextField
              autoComplete="email"
              helpText="Where deadline alerts are sent. Falls back to your support email if this is empty."
              label="Alert email"
              name="alertEmail"
              onChange={setAlertEmail}
              placeholder="ops@example.com"
              value={alertEmail}
            />
            <TextField
              autoComplete="off"
              /*
                Live now. This field was saved to the database and read by
                nothing for the whole life of the app - a setting that promised
                a behaviour the code did not have. The hourly sweep gives it
                one, so it is editable, and the help text is GENERATED from the
                value in force rather than written by hand, so what a merchant
                reads here and what the compliance answer says can never drift
                apart.
              */
              helpText={describeRetentionPolicy(parseRetentionDays(evidenceRetentionDays))}
              label="Keep customer data for"
              name="evidenceRetentionDays"
              onChange={setEvidenceRetentionDays}
              placeholder="365"
              suffix="days"
              type="number"
              value={evidenceRetentionDays}
            />
          </InlineGrid>

          <BlockStack gap="200">
            <Text as="h3" variant="headingSm">
              Email reminders
            </Text>
            {/*
              These three can be switched off. Two cannot, and are not listed as
              choices: the notice that a chargeback has opened, and the notice
              that Shopify has already answered. Both report facts Shopify tells
              a merchant nowhere else, and an app whose core warning is optional
              is an app that gets blamed for silence it was told to keep.
            */}
            <Text as="p" variant="bodySm" tone="subdued">
              You are always told when a chargeback opens and when Shopify has answered for you. These are the
              reminders in between.
            </Text>
            <Checkbox
              helpText="Sent 3 days and 24 hours before Shopify answers — and not sent at all once your response is ready."
              label="Remind me before Shopify answers"
              checked={notifyDueSoon}
              onChange={setNotifyDueSoon}
            />
            <Checkbox
              helpText="A sharper version of the reminder above, for cases where nothing has been added yet."
              label="Warn me when nothing has been added"
              checked={notifyMissingEvidence}
              onChange={setNotifyMissingEvidence}
            />
            <Checkbox
              helpText="One email when a dispute is won, lost, or accepted."
              label="Tell me the outcome"
              checked={notifyDecided}
              onChange={setNotifyDecided}
            />

            {/*
              One field. A merchant pastes a Slack or Discord URL and is done -
              the payload leads with a `text` key precisely so no mapping or
              template is needed. Anything more configurable stops being the
              thing you can set up while a deadline is running.
            */}
            <TextField
              autoComplete="url"
              helpText="Optional. Paste a Slack, Discord, Zapier or n8n URL and the same alerts are posted there. Must be https."
              label="Webhook URL"
              name="alertWebhookUrl"
              onChange={setAlertWebhookUrl}
              placeholder="https://hooks.slack.com/services/..."
              value={alertWebhookUrl}
            />

            {/*
              Save first, then test. The endpoint reads the SAVED values, so
              testing an unsaved edit would report on the old ones and look like
              a bug in the delivery rather than in the order of operations.
            */}
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" tone="subdued">
                Save your changes first, then send yourself a test to confirm the alerts will actually arrive - by email, webhook, or both.
              </Text>
              <div>
                <Button loading={isTesting} onClick={handleTestEmail}>
                  Send a test alert
                </Button>
              </div>
              {testResult ? (
                <Banner tone={testResult.ok ? "success" : "warning"}>
                  <p>{testResult.message}</p>
                </Banner>
              ) : null}
            </BlockStack>
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
