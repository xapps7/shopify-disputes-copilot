import { DisputesIndexPageShell } from "@/components/disputes-index-page-shell";
import { listDashboardDisputes } from "@/lib/disputes/repository";
import { getCurrentShopDomain } from "@/lib/shopify/auth";

export default async function DisputesPage() {
  const shopDomain = await getCurrentShopDomain();
  const disputes = await listDashboardDisputes(shopDomain);

  return <DisputesIndexPageShell disputes={disputes} />;
}
