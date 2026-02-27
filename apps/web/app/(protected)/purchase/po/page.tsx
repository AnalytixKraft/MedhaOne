import { PageTitle } from "@/components/layout/page-title";
import { PurchaseOrderManager } from "@/components/purchase/po-manager";

export default function PurchaseOrdersPage() {
  return (
    <div>
      <PageTitle title="Purchase Orders" description="Create and approve PO documents." />
      <PurchaseOrderManager />
    </div>
  );
}
