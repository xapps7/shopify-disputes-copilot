import { OverviewPageShell } from "@/components/overview-page-shell";
import { getOverviewMetrics, listDashboardDisputes, listRecommendations } from "@/lib/disputes/repository";
import { resolveShopDomain } from "@/lib/shopify/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type HomePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = (await searchParams) ?? {};
  const shopDomain = await resolveShopDomain(params);

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
