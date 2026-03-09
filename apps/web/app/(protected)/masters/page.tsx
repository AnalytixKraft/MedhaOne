import Link from "next/link";

import { MastersNav } from "@/components/masters/masters-nav";
import { PageTitle } from "@/components/layout/page-title";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const masterCards = [
  {
    href: "/masters/parties",
    testId: "masters-parties-card",
    title: "Party Master",
    description: "Customers, suppliers, hospitals, pharmacies, stockists and dual-role accounts.",
  },
  {
    href: "/masters/products",
    testId: "masters-products-card",
    title: "Products",
    description: "SKU catalog with brand, UOM, tax and barcode metadata.",
  },
  {
    href: "/masters/warehouses",
    testId: "masters-warehouses-card",
    title: "Warehouses",
    description: "Storage locations used by stock ledger and summary.",
  },
  {
    href: "/masters/settings",
    testId: "masters-settings-card",
    title: "Master Settings",
    description: "GST slabs, TDS/TCS placeholder, and category masters managed centrally.",
  },
  {
    href: "/masters/reports",
    testId: "masters-reports-card",
    title: "Reports",
    description: "Business-facing master reports for warehouses, items, parties, brands, and categories.",
  },
  {
    href: "/masters/bulk-import",
    testId: "masters-bulk-import-card",
    title: "Bulk Import",
    description: "Import parties and products from CSV templates under master data.",
  },
];

export default function MastersPage() {
  return (
    <div>
      <PageTitle title="Masters" description="Manage foundational data for operations." />
      <MastersNav />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        {masterCards.map((card) => (
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
    </div>
  );
}
