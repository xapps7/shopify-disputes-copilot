import { EvidenceLibraryPageShell } from "@/components/evidence-library-page-shell";
import { listDisputeOptions, listEvidenceLibrary } from "@/lib/disputes/repository";
import { resolveShopDomain } from "@/lib/shopify/auth";

type EvidencePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function EvidencePage({ searchParams }: EvidencePageProps) {
  const params = (await searchParams) ?? {};
  const shopDomain = await resolveShopDomain(params);
  const [items, disputeOptions] = await Promise.all([
    listEvidenceLibrary(shopDomain),
    listDisputeOptions(shopDomain)
  ]);

  return <EvidenceLibraryPageShell items={items} disputeOptions={disputeOptions} />;
}
