import { OverviewPageShell } from "@/components/overview-page-shell";
import { getOverviewMetrics, listDashboardDisputes, listRecommendations } from "@/lib/disputes/repository";
import { getAuthenticatedShopDomainForPage } from "@/lib/shopify/request-context";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type HomePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = (await searchParams) ?? {};
  const shopDomain = await getAuthenticatedShopDomainForPage(params);

  const [metrics, recentDisputes, recommendations] = await Promise.all([
    getOverviewMetrics(shopDomain),
    listDashboardDisputes(shopDomain),
    listRecommendations(shopDomain)
  ]);

  return (
    <OverviewPageShell
      metrics={metrics}
      recentDisputes={recentDisputes}
      recommendations={recommendations}
    />
  );
}
