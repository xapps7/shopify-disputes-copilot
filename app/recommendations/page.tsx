import { RecommendationsPageShell } from "@/components/recommendations-page-shell";
import { getCurrentShopDomain } from "@/lib/shopify/auth";
import { listRecommendations } from "@/lib/disputes/repository";

export default async function RecommendationsPage() {
  const shopDomain = await getCurrentShopDomain();
  const recommendations = await listRecommendations(shopDomain);

  return <RecommendationsPageShell recommendations={recommendations} />;
}
