import { EvidenceLibraryPageShell } from "@/components/evidence-library-page-shell";
import { listDisputeOptions, listEvidenceLibrary } from "@/lib/disputes/repository";
import { getCurrentShopDomain } from "@/lib/shopify/auth";

export default async function EvidencePage() {
  const shopDomain = await getCurrentShopDomain();
  const [items, disputeOptions] = await Promise.all([
    listEvidenceLibrary(shopDomain),
    listDisputeOptions(shopDomain)
  ]);

  return <EvidenceLibraryPageShell items={items} disputeOptions={disputeOptions} />;
}
