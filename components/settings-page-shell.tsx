"use client";

import { Card, Page, Text } from "@shopify/polaris";

import type { MerchantSettings } from "@/lib/settings";
import { SettingsForm } from "@/components/settings-form";

type SettingsPageShellProps = {
  settings: MerchantSettings;
};

export function SettingsPageShell({ settings }: SettingsPageShellProps) {
  return (
    <Page
      title="Settings"
      subtitle="Configure merchant context used in evidence packets and dispute workflows."
    >
      <Card>
        <div className="polaris-card-stack">
          <Text as="p" tone="subdued">
            These values are stored locally in the merchant record and feed packet drafts, support
            context, and merchant-facing evidence narratives.
          </Text>
          <SettingsForm initialSettings={settings} />
        </div>
      </Card>
    </Page>
  );
}
