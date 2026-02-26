import { DashboardMetricsCards } from "@/components/layout/dashboard-metrics";
import { PageTitle } from "@/components/layout/page-title";
import { UserSummaryCard } from "@/components/layout/user-summary-card";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <PageTitle
        title="Dashboard"
        description="Operational overview shell for medical distribution workflows."
      />

      <DashboardMetricsCards />

      <UserSummaryCard />
    </div>
  );
}
