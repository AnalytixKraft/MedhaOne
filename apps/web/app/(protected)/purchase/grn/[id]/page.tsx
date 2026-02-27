import { GrnDetail } from "@/components/purchase/grn-detail";
import { PageTitle } from "@/components/layout/page-title";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function GrnDetailPage({ params }: PageProps) {
  const { id } = await params;

  return (
    <div>
      <PageTitle title={`GRN #${id}`} description="View GRN lines and post stock movement." />
      <GrnDetail grnId={Number(id)} />
    </div>
  );
}
