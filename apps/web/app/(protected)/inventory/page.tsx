import Link from "next/link";
import { ArrowRight, Boxes, Building2, Warehouse } from "lucide-react";

import { PageTitle } from "@/components/layout/page-title";

const items = [
  {
    href: "/masters",
    title: "Master Data",
    description: "Manage parties, products, and warehouse masters used by inventory and purchase flows.",
    icon: Building2,
  },
  {
    href: "/warehouse",
    title: "Stock Operations",
    description: "Review warehouse operations and inventory workflows for the current organization.",
    icon: Warehouse,
  },
];

export default function InventoryPage() {
  return (
    <div className="space-y-6">
      <PageTitle
        title="Inventory"
        description="Centralize inventory controls, stock movement, and foundational setup."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="group rounded-3xl border bg-card p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-4">
                <span className="rounded-2xl border p-3 text-muted-foreground">
                  <Icon className="h-5 w-5" />
                </span>
                <ArrowRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5" />
              </div>
              <h2 className="mt-5 text-lg font-semibold">{item.title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{item.description}</p>
            </Link>
          );
        })}
      </div>

      <section className="rounded-3xl border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="rounded-2xl border p-3 text-muted-foreground">
            <Boxes className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-lg font-semibold">Inventory visibility</h2>
            <p className="text-sm text-muted-foreground">
              Use Purchase and Reports to monitor inward stock, movements, and current availability.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
