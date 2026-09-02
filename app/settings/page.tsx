import { SettingsPageShell } from "@/components/settings-page-shell";
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
 * NOTHING FROM POLARIS IS IMPORTED HERE, and that is not a style preference.
 * This is a server component. Polaris builds its components on React context,
 * and `createContext` does not exist on the server - importing even a single
 * Polaris component here fails the BUILD, with
 * "Failed to collect configuration for /settings", which names the page and
 * says nothing about the cause. An earlier version of this file composed the
 * layout itself and imported `Card` directly for exactly that reason.
 *
 * So the split is: this file reads data, `SettingsPageShell` renders it. Every
 * Polaris component on this page lives behind that one "use client" boundary.
 *
 * The plan is read HERE, through `getPlanSummary` - the same gate the API
 * routes use, which fails closed to free. The card is handed the answer; it
 * never asks the database, and it is never the thing that decides what a
 * merchant is entitled to.
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

  return <SettingsPageShell settings={settings} plan={planSummary} />;
}
