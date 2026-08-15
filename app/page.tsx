import { OverviewPageShell } from "@/components/overview-page-shell";
import { getOverviewMetrics, listDashboardDisputes, listRecommendations } from "@/lib/disputes/repository";
import { after } from "next/server";

import { syncIfStale, syncIfNeverSynced } from "@/lib/disputes/background-sync";
import { getAuthenticatedShopDomainForPage } from "@/lib/shopify/request-context";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type HomePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = (await searchParams) ?? {};
  const shopDomain = await getAuthenticatedShopDomainForPage(params);

  // Keeps data fresh without any external scheduler: runs after the response
  // has been sent, so it never delays the page.
  if (shopDomain) {
    // A merchant who has never synced would otherwise see "No open disputes"
    // on their very first load - which reads as broken, and is exactly what a
    // reviewer opens first. That one case is worth waiting for; every
    // subsequent refresh happens after the response is sent.
    try {
      await syncIfNeverSynced(shopDomain);
    } catch (error) {
      console.error("[background-sync] first-run sync failed", error);
    }

    after(async () => {
      try {
        await syncIfStale(shopDomain);
      } catch (error) {
        console.error("[background-sync] opportunistic sync failed", error);
      }
    });
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
