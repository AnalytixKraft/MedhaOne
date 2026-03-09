import { PurchaseOrderDetail } from "@/components/purchase/purchase-order-detail";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function PurchaseOrderDetailPage({ params }: PageProps) {
  const { id } = await params;
  return <PurchaseOrderDetail purchaseOrderId={Number(id)} />;
}
