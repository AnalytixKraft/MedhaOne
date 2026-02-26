import { MastersNav } from "@/components/masters/masters-nav";
import { WarehousesManager } from "@/components/masters/warehouses-manager";
import { PageTitle } from "@/components/layout/page-title";

export default function WarehousesPage() {
  return (
    <div>
      <PageTitle title="Warehouses" description="Create and manage storage locations." />
      <MastersNav />
      <WarehousesManager />
    </div>
  );
}
