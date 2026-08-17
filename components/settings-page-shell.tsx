"use client";

import { Card } from "@shopify/polaris";

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
      mode="form"
      gap="400"
    >
      {/*
        The paragraph that used to open this card said what the page subtitle
        already says - that these values feed packet drafts and evidence
        narratives - and pushed the first field below it. The form leads.
      */}
      <Card>
        <SettingsForm initialSettings={settings} />
      </Card>
    </AdminPageLayout>
  );
}
