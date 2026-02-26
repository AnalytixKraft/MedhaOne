import Link from "next/link";

import { MastersNav } from "@/components/masters/masters-nav";
import { PageTitle } from "@/components/layout/page-title";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const masterCards = [
  {
    href: "/masters/parties",
    title: "Parties",
    description: "Manufacturers, distributors, hospitals, pharmacies and customers.",
  },
  {
    href: "/masters/products",
    title: "Products",
    description: "SKU catalog with brand, UOM, tax and barcode metadata.",
  },
  {
    href: "/masters/warehouses",
    title: "Warehouses",
    description: "Storage locations used by stock ledger and summary.",
  },
];

export default function MastersPage() {
  return (
    <div>
      <PageTitle title="Masters" description="Manage foundational data for operations." />
      <MastersNav />
      <div className="grid gap-4 md:grid-cols-3">
        {masterCards.map((card) => (
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
