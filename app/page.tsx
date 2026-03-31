import { OverviewPageShell } from "@/components/overview-page-shell";
import { getOverviewMetrics, listDashboardDisputes, listRecommendations } from "@/lib/disputes/repository";
import { getCurrentShopDomain } from "@/lib/shopify/auth";

type HomePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function getSingleValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = (await searchParams) ?? {};
  const shop = getSingleValue(params.shop);
  const host = getSingleValue(params.host);
  const shopDomain = shop ?? (await getCurrentShopDomain());

  if (shop || host) {
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
