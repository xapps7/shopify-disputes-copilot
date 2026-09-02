import { Card } from "@shopify/polaris";

import { AdminPageLayout } from "@/components/admin-page-layout";
import { PlanCard } from "@/components/plan-card";
import { SettingsForm } from "@/components/settings-form";
import { getPlanSummary } from "@/lib/billing/gate";
import { getMerchantSettings } from "@/lib/settings";
import { getEmbeddedPageShop } from "@/lib/shopify/page-context";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SettingsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Settings, with the plan on top.
 *
 * The plan is read HERE, on the server, through `getPlanSummary` - the same
 * gate the API routes use, which fails closed to free. The card below is a
 * client component and is handed the answer; it never asks the database, and it
 * is never the thing that decides what the merchant is entitled to.
 *
 * The layout is composed here rather than through `components/settings-page-shell.tsx`
 * because that shell renders the settings form and takes no slot above it, so
 * there was nowhere to put the plan card. Everything else about the page -
 * title, subtitle, form mode, spacing, and the form itself - is unchanged.
 */
export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const params = (await searchParams) ?? {};
  const shopDomain = await getEmbeddedPageShop(params, "/settings");

  // Two independent reads; neither needs the other's answer.
  //
  // `getEmbeddedPageShop` can return null when the page is opened without a
  // resolvable shop. `getPlanSummary` takes a domain, and an empty one resolves
  // to the free plan inside the gate - the same fail-closed answer the API
  // routes get, which is the right thing to show a session we cannot identify.
  const [settings, planSummary] = await Promise.all([
    getMerchantSettings(shopDomain),
    getPlanSummary(shopDomain ?? "")
  ]);

  return (
    <AdminPageLayout
      title="Settings"
      subtitle="Configure merchant context used in evidence packets and dispute workflows."
      mode="form"
      gap="400"
    >
      {/*
        First on the page, and in its own card. A merchant who opens Settings to
        ask "what am I paying for?" should not have to scroll past a form to
        find out, and nesting it inside the form card would read as a setting.
      */}
      <PlanCard plan={planSummary} />

      <Card>
        <SettingsForm initialSettings={settings} />
      </Card>
    </AdminPageLayout>
  );
}
