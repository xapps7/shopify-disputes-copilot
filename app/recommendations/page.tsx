import { RecommendationsPageShell } from "@/components/recommendations-page-shell";
import { getAuthenticatedShopDomainForPage } from "@/lib/shopify/request-context";
import { listRecommendations } from "@/lib/disputes/repository";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RecommendationsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function RecommendationsPage({ searchParams }: RecommendationsPageProps) {
  const params = (await searchParams) ?? {};
  const shopDomain = await getAuthenticatedShopDomainForPage(params);
  const recommendations = await listRecommendations(shopDomain);

  return <RecommendationsPageShell recommendations={recommendations} />;
}
