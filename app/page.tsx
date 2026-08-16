import { after } from "next/server";

import { OverviewPageShell } from "@/components/overview-page-shell";
import { syncIfStale, syncIfNeverSynced } from "@/lib/disputes/background-sync";
import { getTodayView } from "@/lib/disputes/today";
import { getEmbeddedPageShop } from "@/lib/shopify/page-context";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type HomePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = (await searchParams) ?? {};
  const shopDomain = await getEmbeddedPageShop(params, "/");

  // Keeps data fresh without any external scheduler: runs after the response
  // has been sent, so it never delays the page.
  if (shopDomain) {
    // A merchant who has never synced would otherwise see "No disputes yet" on
    // their very first load - which reads as broken, and is exactly what a
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

  // One query, one shape. Today no longer loads the dispute list at all - it
  // showed the first eight rows of /disputes, which is what made the two
  // screens indistinguishable.
  const today = await getTodayView(shopDomain);

  return <OverviewPageShell today={today} />;
}
