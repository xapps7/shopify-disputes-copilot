import { AnalyticsPageShell } from "@/components/analytics-page-shell";
import { getAnalyticsSnapshot } from "@/lib/disputes/repository";
import { getCurrentShopDomain } from "@/lib/shopify/auth";

export default async function AnalyticsPage() {
  const shopDomain = await getCurrentShopDomain();
  const snapshot = await getAnalyticsSnapshot(shopDomain);

  return <AnalyticsPageShell snapshot={snapshot} />;
}
