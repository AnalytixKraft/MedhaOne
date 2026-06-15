import Link from "next/link";

import { PageTitle } from "@/components/layout/page-title";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PURCHASE_NAV_ITEMS, PURCHASE_REPORT_ITEMS } from "@/lib/purchase/navigation";

export default function PurchasePage() {
  return (
    <div className="space-y-6">
      <PageTitle title="Purchase" description="Procurement workspace for purchase orders, invoices, and stock receipts." />

      <div className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-[hsl(var(--text-primary))]">Transactions</h2>
          <p className="text-sm text-[hsl(var(--text-secondary))]">
            Core purchase execution across orders, bills, and receipts.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {PURCHASE_NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              data-testid={
                item.id === "po"
                  ? "purchase-orders-card"
                  : item.id === "bills"
                    ? "purchase-bills-card"
                    : "purchase-grn-card"
              }
            >
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

      <div className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-[hsl(var(--text-primary))]">Reports</h2>
          <p className="text-sm text-[hsl(var(--text-secondary))]">
            Procurement intelligence and analytics built on purchase activity.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {PURCHASE_REPORT_ITEMS.map((item) => (
            <Link key={item.href} href={item.href} data-testid={`purchase-report-${item.id}-card`}>
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
    </div>
  );
}
