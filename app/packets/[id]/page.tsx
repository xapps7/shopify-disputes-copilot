import { PacketPreviewPageShell } from "@/components/packet-preview-page-shell";
import { getDisputeDetail } from "@/lib/disputes/repository";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PacketPreviewPageProps = {
  params: Promise<{ id: string }>;
};

export default async function PacketPreviewPage({ params }: PacketPreviewPageProps) {
  const { id } = await params;
  const dispute = await getDisputeDetail(id);

  return <PacketPreviewPageShell dispute={dispute} />;
}
