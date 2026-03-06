import { PurchaseOrderManager } from "@/components/purchase/po-manager";

export default function PurchaseOrdersPage() {
  return (
    <div className="relative flex min-h-screen w-full flex-col gap-4 bg-[radial-gradient(120%_120%_at_50%_0%,#1f2937_0%,#0b1220_45%,#060c1a_100%)] pb-8">
      <PurchaseOrderManager />
    </div>
  );
}
