import { PageTitle } from "@/components/layout/page-title";
import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function ReportsPage() {
  const groups = [
    {
      title: "Inventory Intelligence",
      cards: [
        {
          href: "/reports/current-stock",
          testId: "report-current-stock",
          title: "Current Stock",
          description: "Real-time available stock, value and batch-level visibility.",
        },
        {
          href: "/reports/stock-ageing",
          testId: "report-stock-ageing",
          title: "Stock Ageing",
          description: "Bucketed stock ageing based on posted GRN receipt dates.",
        },
      ],
    },
    {
      title: "Expiry",
      cards: [
        {
          href: "/reports/expiry",
          testId: "report-expiry",
          title: "Expiry",
          description: "Current stock near expiry or already expired.",
        },
      ],
    },
    {
      title: "Dead Stock",
      cards: [
        {
          href: "/reports/dead-stock",
          testId: "report-dead-stock",
          title: "Dead Stock",
          description: "Products with no movement beyond the inactivity threshold.",
        },
      ],
    },
    {
      title: "Purchasing",
      cards: [
        {
          href: "/reports/purchase-register",
          testId: "report-purchase-register",
          title: "Purchase Register",
          description: "Purchase order totals, status and pending quantities.",
        },
        {
          href: "/reports/purchase-credit-notes",
          testId: "report-purchase-credit-notes",
          title: "Purchase Credit Notes",
          description: "Auto-generated informational credit notes linked to posted purchase returns.",
        },
      ],
    },
    {
      title: "Stock Operations",
      cards: [
        {
          href: "/reports/stock-inward",
          testId: "report-stock-inward",
          title: "Stock Inward",
          description: "GRN-based inward stock receipts from suppliers.",
        },
        {
          href: "/reports/stock-movement",
          testId: "report-stock-movement",
          title: "Stock Movement",
          description: "Inventory ledger movement with running balance.",
        },
        {
          href: "/reports/opening-stock",
          testId: "report-opening-stock",
          title: "Opening Stock",
          description: "Opening stock entries and their current balance impact.",
        },
      ],
    },
  ];

  return (
    <div className="space-y-6">
      <PageTitle title="Reports" description="Operational reports available for ERP users with reporting access." />
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
