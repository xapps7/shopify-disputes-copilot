import { RecommendationsPageShell } from "@/components/recommendations-page-shell";
import { getEmbeddedPageShop } from "@/lib/shopify/page-context";
import { listRecommendations } from "@/lib/disputes/repository";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RecommendationsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function RecommendationsPage({ searchParams }: RecommendationsPageProps) {
  const params = (await searchParams) ?? {};
  const shopDomain = await getEmbeddedPageShop(params, "/recommendations");
  const recommendations = await listRecommendations(shopDomain);

  return <RecommendationsPageShell recommendations={recommendations} />;
}
