import { PageTitle } from "@/components/layout/page-title";
import { GrnManager } from "@/components/purchase/grn-manager";

export default function PurchaseGrnPage() {
  return (
    <div>
      <PageTitle title="GRN" description="Create draft GRNs from approved PO and review receipts." />
      <GrnManager />
    </div>
  );
}
