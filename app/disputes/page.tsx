import { DisputesIndexPageShell } from "@/components/disputes-index-page-shell";
import {
  DISPUTE_QUEUE_LIMIT,
  countDashboardDisputes,
  listDashboardDisputes
} from "@/lib/disputes/repository";
import { getEmbeddedPageShop } from "@/lib/shopify/page-context";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type DisputesPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DisputesPage({ searchParams }: DisputesPageProps) {
  const params = (await searchParams) ?? {};
  const shopDomain = await getEmbeddedPageShop(params, "/disputes");
  const [disputes, totalCount] = await Promise.all([
    listDashboardDisputes(shopDomain),
    countDashboardDisputes(shopDomain)
  ]);

  return (
    <DisputesIndexPageShell disputes={disputes} loadedLimit={DISPUTE_QUEUE_LIMIT} totalCount={totalCount} />
  );
}
