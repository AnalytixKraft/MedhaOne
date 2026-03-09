import { BulkImportPage } from "@/components/masters/bulk-import-page";
import { MastersNav } from "@/components/masters/masters-nav";
import { PageTitle } from "@/components/layout/page-title";

export default function MastersBulkImportPage() {
  return (
    <div>
      <PageTitle
        title="Bulk Import"
        description="Import party and item master data using standard CSV templates."
      />
      <MastersNav />
      <BulkImportPage />
    </div>
  );
}
