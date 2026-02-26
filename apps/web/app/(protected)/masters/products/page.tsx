import { MastersNav } from "@/components/masters/masters-nav";
import { ProductsManager } from "@/components/masters/products-manager";
import { PageTitle } from "@/components/layout/page-title";

export default function ProductsPage() {
  return (
    <div>
      <PageTitle title="Products" description="Create and maintain item catalog for inventory." />
      <MastersNav />
      <ProductsManager />
    </div>
  );
}
