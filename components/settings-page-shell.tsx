"use client";

import { BlockStack, Card, Text } from "@shopify/polaris";

import { AdminPageLayout } from "@/components/admin-page-layout";
import { SetupReadinessCard } from "@/components/setup-readiness-card";
import type { SetupReadinessItem } from "@/lib/platform-readiness";
import type { MerchantSettings } from "@/lib/settings";
import { SettingsForm } from "@/components/settings-form";

type SettingsPageShellProps = {
  settings: MerchantSettings;
  readinessItems: SetupReadinessItem[];
};

export function SettingsPageShell({ settings, readinessItems }: SettingsPageShellProps) {
  return (
    <AdminPageLayout
      title="Settings"
      subtitle="Configure merchant context used in evidence packets and dispute workflows."
      mode="form"
      gap="400"
    >
      <SetupReadinessCard items={readinessItems} />
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
