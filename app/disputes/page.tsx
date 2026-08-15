import { DisputesIndexPageShell } from "@/components/disputes-index-page-shell";
import { listDashboardDisputes } from "@/lib/disputes/repository";
import { getEmbeddedPageShop } from "@/lib/shopify/page-context";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type DisputesPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DisputesPage({ searchParams }: DisputesPageProps) {
  const params = (await searchParams) ?? {};
  const shopDomain = await getEmbeddedPageShop(params, "/disputes");
  const disputes = await listDashboardDisputes(shopDomain);

  return <DisputesIndexPageShell disputes={disputes} />;
}
