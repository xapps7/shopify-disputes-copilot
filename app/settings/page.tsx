import { SettingsForm } from "@/components/settings-form";
import { getMerchantSettings } from "@/lib/settings";
import { getCurrentShopDomain } from "@/lib/shopify/auth";

export default async function SettingsPage() {
  const shopDomain = await getCurrentShopDomain();
  const settings = await getMerchantSettings(shopDomain);

  return (
    <section className="panel">
      <h2>Settings</h2>
      <p>
        Configure merchant context used in evidence packets and dispute workflows. These values are
        stored locally in the merchant record and included in packet drafts.
      </p>
      <SettingsForm initialSettings={settings} />
    </section>
  );
}
