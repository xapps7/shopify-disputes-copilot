import { SettingsPageShell } from "@/components/settings-page-shell";
import { getSetupReadiness } from "@/lib/platform-readiness";
import { getMerchantSettings } from "@/lib/settings";
import { resolveShopDomain } from "@/lib/shopify/auth";

type SettingsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const params = (await searchParams) ?? {};
  const shopDomain = await resolveShopDomain(params);
  const settings = await getMerchantSettings(shopDomain);
  const readinessItems = getSetupReadiness();

  return <SettingsPageShell settings={settings} readinessItems={readinessItems} />;
}
