import { SettingsPageShell } from "@/components/settings-page-shell";
import { getMerchantSettings } from "@/lib/settings";
import { getEmbeddedPageShop } from "@/lib/shopify/page-context";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SettingsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const params = (await searchParams) ?? {};
  const shopDomain = await getEmbeddedPageShop(params, "/settings");
  const settings = await getMerchantSettings(shopDomain);

  return <SettingsPageShell settings={settings} />;
}
