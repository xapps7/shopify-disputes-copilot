import { DisputesIndexPageShell } from "@/components/disputes-index-page-shell";
import { listDashboardDisputes } from "@/lib/disputes/repository";
import { resolveShopDomain } from "@/lib/shopify/auth";

type DisputesPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DisputesPage({ searchParams }: DisputesPageProps) {
  const params = (await searchParams) ?? {};
  const shopDomain = await resolveShopDomain(params);
  const disputes = await listDashboardDisputes(shopDomain);

  return <DisputesIndexPageShell disputes={disputes} />;
}
