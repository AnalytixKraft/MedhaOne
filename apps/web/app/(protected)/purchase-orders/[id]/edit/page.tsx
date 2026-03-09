import { PurchaseOrderManager } from "@/components/purchase/po-manager";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditPurchaseOrderPage({ params }: PageProps) {
  const { id } = await params;
  return <PurchaseOrderManager mode="edit" purchaseOrderId={Number(id)} />;
}
