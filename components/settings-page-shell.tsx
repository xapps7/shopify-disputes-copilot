"use client";

import { Card } from "@shopify/polaris";

import { AdminPageLayout } from "@/components/admin-page-layout";
import { PlanCard, type PlanCardSummary } from "@/components/plan-card";
import type { MerchantSettings } from "@/lib/settings";
import { SettingsForm } from "@/components/settings-form";

type SettingsPageShellProps = {
  settings: MerchantSettings;
  /** Read on the server by `getPlanSummary`. This component never asks. */
  plan: PlanCardSummary;
};

// The "Setup readiness" card used to render here. It reported internal
// operational status ("Move to S3-compatible storage before production
// launch", "Protected customer data approval is still pending") to merchants,
// who can neither act on it nor should see it. It is no longer rendered.
export function SettingsPageShell({ settings, plan }: SettingsPageShellProps) {
  return (
    <AdminPageLayout
      title="Settings"
      subtitle="Configure merchant context used in evidence packets and dispute workflows."
      mode="form"
      gap="400"
    >
      {/*
        The plan comes first, and in its own card. A merchant who opens Settings
        to ask "what am I paying for?" should not have to scroll past a form to
        find out, and nesting it inside the form card would read as a setting.
      */}
      <PlanCard plan={plan} />

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
