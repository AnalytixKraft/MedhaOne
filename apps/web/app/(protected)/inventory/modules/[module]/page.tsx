import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";

import { PageTitle } from "@/components/layout/page-title";
import { Button } from "@/components/ui/button";
import { findInventoryModuleBySlug } from "@/lib/inventory/navigation";

type ModulePageProps = {
  params: Promise<{
    module: string;
  }>;
};

export default async function InventoryModulePlaceholderPage({
  params,
}: ModulePageProps) {
  const resolved = await params;
  const moduleMeta = findInventoryModuleBySlug(resolved.module);
  if (!moduleMeta) {
    notFound();
  }

  const backHref =
    moduleMeta.tab.id === "master-data"
      ? "/masters"
      : moduleMeta.tab.id === "reports"
        ? "/reports"
        : `/inventory?tab=${moduleMeta.tab.id}`;
  const backLabel =
    moduleMeta.tab.id === "master-data"
      ? "Masters"
      : moduleMeta.tab.id === "reports"
        ? "Reports"
        : "Inventory";

  return (
    <div className="space-y-6">
      <PageTitle
        title={moduleMeta.item.label}
        description={moduleMeta.item.description}
      />
      <section className="rounded-2xl border bg-card p-6">
        <p className="text-sm text-muted-foreground">
          This inventory sub-module route is mapped and ready for full screen
          implementation.
        </p>
        <div className="mt-4">
          <Button asChild variant="outline">
            <Link href={backHref}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back To {backLabel}
            </Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
