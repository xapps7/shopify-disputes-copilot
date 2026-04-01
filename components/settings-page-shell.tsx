"use client";

import { BlockStack, Card, Text } from "@shopify/polaris";

import { AdminPageLayout } from "@/components/admin-page-layout";
import type { MerchantSettings } from "@/lib/settings";
import { SettingsForm } from "@/components/settings-form";

type SettingsPageShellProps = {
  settings: MerchantSettings;
};

export function SettingsPageShell({ settings }: SettingsPageShellProps) {
  return (
    <AdminPageLayout
      title="Settings"
      subtitle="Configure merchant context used in evidence packets and dispute workflows."
      mode="form"
      gap="400"
    >
      <Card>
        <BlockStack gap="400">
          <Text as="p" tone="subdued">
            These values are stored locally in the merchant record and feed packet drafts, support
            context, and merchant-facing evidence narratives.
          </Text>
          <SettingsForm initialSettings={settings} />
        </BlockStack>
      </Card>
    </AdminPageLayout>
  );
}
