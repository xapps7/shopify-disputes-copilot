import { DisputesIndexPageShell } from "@/components/disputes-index-page-shell";
import { listDashboardDisputes } from "@/lib/disputes/repository";
import { getAuthenticatedShopDomainForPage } from "@/lib/shopify/request-context";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type DisputesPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DisputesPage({ searchParams }: DisputesPageProps) {
  const params = (await searchParams) ?? {};
  const shopDomain = await getAuthenticatedShopDomainForPage(params);
  const disputes = await listDashboardDisputes(shopDomain);

  return <DisputesIndexPageShell disputes={disputes} />;
}
