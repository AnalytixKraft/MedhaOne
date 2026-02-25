import { PageTitle } from "@/components/layout/page-title";
import { UserSummaryCard } from "@/components/layout/user-summary-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <PageTitle
        title="Dashboard"
        description="Operational overview shell for medical distribution workflows."
      />

      <div className="grid gap-4 md:grid-cols-3">
        {[
          { label: "Open Purchase Orders", value: "0" },
          { label: "Pending Sales Invoices", value: "0" },
          { label: "Low Stock Alerts", value: "0" },
        ].map((item) => (
          <Card key={item.label}>
            <CardHeader>
              <CardTitle className="text-sm text-muted-foreground">{item.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold">{item.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <UserSummaryCard />
    </div>
  );
}
