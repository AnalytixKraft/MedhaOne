import Link from "next/link";

import { PageTitle } from "@/components/layout/page-title";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { INVENTORY_REPORTS_TAB } from "@/lib/inventory/navigation";
import { DATA_QUALITY_REPORTS, MASTERS_REPORTS } from "@/lib/reports/navigation";

const groups = [
  {
    title: "Masters",
    cards: MASTERS_REPORTS,
  },
  {
    title: "Data Quality",
    cards: DATA_QUALITY_REPORTS,
  },
  {
    title: "Operational",
    cards: INVENTORY_REPORTS_TAB.items.map((item) => ({
      href: item.href,
      testId: `report-operational-${item.id}`,
      title: item.label,
      description: item.description,
    })),
  },
];

export default function ReportsPage() {
  return (
    <div className="space-y-6">
      <PageTitle title="Reports" description="Business, operational, and data-quality reporting for the ERP workspace." />
      {groups.map((group) => (
        <section key={group.title} className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {group.title}
          </h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {group.cards.map((card) => (
              <Link key={card.href} href={card.href} data-testid={card.testId}>
                <Card className="h-full transition hover:border-primary">
                  <CardHeader>
                    <CardTitle>{card.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">{card.description}</p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
