"use client";

import { BlockStack, Card, Text } from "@shopify/polaris";

import { AdminPageLayout } from "@/components/admin-page-layout";
import type { MerchantSettings } from "@/lib/settings";
import { SettingsForm } from "@/components/settings-form";

type SettingsPageShellProps = {
  settings: MerchantSettings;
};

// The "Setup readiness" card used to render here. It reported internal
// operational status ("Move to S3-compatible storage before production
// launch", "Protected customer data approval is still pending") to merchants,
// who can neither act on it nor should see it. It is no longer rendered.
export function SettingsPageShell({ settings }: SettingsPageShellProps) {
  return (
    <AdminPageLayout
      title="Settings"
      subtitle="Configure merchant context used in evidence packets and dispute workflows."
      // The evidence library came off the primary nav: it is a filing cabinet,
      // not a destination. This is one of its two ways in - the other is the
      // dispute that needs a file, where the slot takes the upload directly.
      secondaryActions={[{ content: "Open evidence library", url: "/evidence" }]}
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
