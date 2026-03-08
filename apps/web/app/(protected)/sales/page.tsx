import Link from "next/link";

import { PageTitle } from "@/components/layout/page-title";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SALES_NAV_ITEMS } from "@/lib/sales/navigation";

export default function SalesPage() {
  return (
    <div>
      <PageTitle
        title="Sales"
        description="Manage customer orders, reserve stock, and post dispatches."
      />
      <div className="grid gap-4 md:grid-cols-2">
        {SALES_NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            data-testid={`sales-${item.id}-card`}
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
