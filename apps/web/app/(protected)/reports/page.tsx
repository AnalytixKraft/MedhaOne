import { PageTitle } from "@/components/layout/page-title";
import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function ReportsPage() {
  const cards = [
    {
      href: "/reports/stock-inward",
      title: "Stock Inward",
      description: "GRN-based inward stock receipts from suppliers.",
    },
    {
      href: "/reports/purchase-register",
      title: "Purchase Register",
      description: "Purchase order totals, status and pending quantities.",
    },
    {
      href: "/reports/stock-movement",
      title: "Stock Movement",
      description: "Inventory ledger movement with running balance.",
    },
  ];

  return (
    <div>
      <PageTitle title="Reports" description="Operational reports available for ERP users with reporting access." />
      <div className="grid gap-4 md:grid-cols-3">
        {cards.map((card) => (
          <Link key={card.href} href={card.href}>
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
    </div>
  );
}
