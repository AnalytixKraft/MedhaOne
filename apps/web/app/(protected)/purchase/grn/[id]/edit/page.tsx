import { GrnForm } from "@/components/purchase/grn-form";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function PurchaseGrnEditPage({ params }: PageProps) {
  const { id } = await params;
  return <GrnForm mode="edit" source="po" grnId={Number(id)} />;
}
