import { MastersNav } from "@/components/masters/masters-nav";
import { PartiesManager } from "@/components/masters/parties-manager";
import { PageTitle } from "@/components/layout/page-title";

export default function PartiesPage() {
  return (
    <div>
      <PageTitle title="Party Master" description="Create and maintain ERP business parties with tax, contact, and commercial details." />
      <MastersNav />
      <PartiesManager />
    </div>
  );
}
