import Link from "next/link";

import { PageTitle } from "@/components/layout/page-title";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { INVENTORY_REPORTS_TAB } from "@/lib/inventory/navigation";

export default function OperationalReportsPage() {
  return (
    <div className="space-y-6">
      <PageTitle
        title="Operational Reports"
        description="Inventory and operations-focused reporting for stock, movement, ageing, expiry, and dead stock."
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {INVENTORY_REPORTS_TAB.items.map((item) => (
          <Link key={item.href} href={item.href} data-testid={`report-operational-${item.id}`}>
            <Card className="h-full transition hover:border-primary">
              <CardHeader>
                <CardTitle>{item.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{item.description}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
