import { RecommendationsPageShell } from "@/components/recommendations-page-shell";
import { resolveShopDomain } from "@/lib/shopify/auth";
import { listRecommendations } from "@/lib/disputes/repository";

type RecommendationsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function RecommendationsPage({ searchParams }: RecommendationsPageProps) {
  const params = (await searchParams) ?? {};
  const shopDomain = await resolveShopDomain(params);
  const recommendations = await listRecommendations(shopDomain);

  return <RecommendationsPageShell recommendations={recommendations} />;
}
