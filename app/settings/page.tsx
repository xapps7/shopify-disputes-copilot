import { SettingsPageShell } from "@/components/settings-page-shell";
import { getSetupReadiness } from "@/lib/platform-readiness";
import { getMerchantSettings } from "@/lib/settings";
import { getCurrentShopDomain } from "@/lib/shopify/auth";

export default async function SettingsPage() {
  const shopDomain = await getCurrentShopDomain();
  const settings = await getMerchantSettings(shopDomain);
  const readinessItems = getSetupReadiness();

  return <SettingsPageShell settings={settings} readinessItems={readinessItems} />;
}
