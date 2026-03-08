import Link from "next/link";

import { PageTitle } from "@/components/layout/page-title";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PURCHASE_NAV_ITEMS } from "@/lib/purchase/navigation";

export default function PurchasePage() {
  return (
    <div>
      <PageTitle title="Purchase" description="Procurement workspace for purchase orders, invoices, and stock receipts." />
      <div className="grid gap-4 md:grid-cols-2">
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
  );
}
