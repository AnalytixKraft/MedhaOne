import { MastersNav } from "@/components/masters/masters-nav";
import { PartiesManager } from "@/components/masters/parties-manager";
import { PageTitle } from "@/components/layout/page-title";

export default function PartiesPage() {
  return (
    <div>
      <PageTitle title="Parties" description="Create and maintain business parties." />
      <MastersNav />
      <PartiesManager />
    </div>
  );
}
