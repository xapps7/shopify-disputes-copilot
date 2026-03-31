import { EvidenceLibraryPageShell } from "@/components/evidence-library-page-shell";
import { listEvidenceLibrary } from "@/lib/disputes/repository";
import { getCurrentShopDomain } from "@/lib/shopify/auth";

export default async function EvidencePage() {
  const shopDomain = await getCurrentShopDomain();
  const items = await listEvidenceLibrary(shopDomain);

  return <EvidenceLibraryPageShell items={items} />;
}
