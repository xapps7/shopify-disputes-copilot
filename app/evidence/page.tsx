import { EvidenceLibraryPageShell } from "@/components/evidence-library-page-shell";
import { listDisputeOptions, listEvidenceLibrary } from "@/lib/disputes/repository";
import { getMerchantSettings } from "@/lib/settings";
import { getEmbeddedPageShop } from "@/lib/shopify/page-context";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type EvidencePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function EvidencePage({ searchParams }: EvidencePageProps) {
  const params = (await searchParams) ?? {};
  const shopDomain = await getEmbeddedPageShop(params, "/evidence");
  const [items, disputeOptions, settings] = await Promise.all([
    listEvidenceLibrary(shopDomain),
    listDisputeOptions(shopDomain),
    getMerchantSettings(shopDomain)
  ]);

  return (
    <EvidenceLibraryPageShell
      cancellationPolicyStatement={settings.cancellationPolicyStatement}
      disputeOptions={disputeOptions}
      items={items}
      refundPolicyStatement={settings.refundPolicyStatement}
      standingDocuments={settings.standingDocuments}
    />
  );
}
