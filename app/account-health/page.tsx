import { AccountHealthPageShell } from "@/components/account-health-page-shell";
import { AccountHealthUnavailable } from "@/components/account-health-unavailable";
import { getAccountHealth } from "@/lib/economics/account-health";
import { getEmbeddedPageShop } from "@/lib/shopify/page-context";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type AccountHealthPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AccountHealthPage({ searchParams }: AccountHealthPageProps) {
  const params = (await searchParams) ?? {};
  const shopDomain = await getEmbeddedPageShop(params, "/account-health");
  const health = await getAccountHealth(shopDomain);

  if (!health) {
    // Not installed, or the shop could not be resolved. Showing empty meters
    // would imply a measured "zero risk", which is the one thing this screen
    // must never do.
    return <AccountHealthUnavailable />;
  }

  return <AccountHealthPageShell health={health} />;
}
