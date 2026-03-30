import { SettingsPageShell } from "@/components/settings-page-shell";
import { getMerchantSettings } from "@/lib/settings";
import { getCurrentShopDomain } from "@/lib/shopify/auth";

export default async function SettingsPage() {
  const shopDomain = await getCurrentShopDomain();
  const settings = await getMerchantSettings(shopDomain);

  return <SettingsPageShell settings={settings} />;
}
