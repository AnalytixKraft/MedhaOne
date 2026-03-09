import { GrnDetail } from "@/components/purchase/grn-detail";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function GrnDetailPage({ params }: PageProps) {
  const { id } = await params;

  return <GrnDetail grnId={Number(id)} />;
}
