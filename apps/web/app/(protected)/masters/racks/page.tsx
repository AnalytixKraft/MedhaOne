import { MastersNav } from "@/components/masters/masters-nav";
import { RacksManager } from "@/components/masters/racks-manager";
import { PageTitle } from "@/components/layout/page-title";

export default function RacksPage() {
  return (
    <div>
      <PageTitle
        title="Rack Details"
        description="Manage warehouse-wise rack details for put-away and product defaults."
      />
      <MastersNav />
      <RacksManager />
    </div>
  );
}
