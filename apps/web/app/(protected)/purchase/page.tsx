import Link from "next/link";

import { PageTitle } from "@/components/layout/page-title";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const cards = [
  {
    href: "/purchase/po",
    title: "Purchase Orders",
    description: "Create and approve purchase orders.",
  },
  {
    href: "/purchase/grn",
    title: "Goods Receipt Notes",
    description: "Receive stock against approved purchase orders.",
  },
];

export default function PurchasePage() {
  return (
    <div>
      <PageTitle title="Purchase" description="Phase 1 procurement workflow (PO -> GRN)." />
      <div className="grid gap-4 md:grid-cols-2">
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
