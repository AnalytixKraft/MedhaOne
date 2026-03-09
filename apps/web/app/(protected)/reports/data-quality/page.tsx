import Link from "next/link";

import { PageTitle } from "@/components/layout/page-title";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DATA_QUALITY_REPORTS } from "@/lib/reports/navigation";

export default function DataQualityReportsPage() {
  return (
    <div className="space-y-6">
      <PageTitle
        title="Data Quality Reports"
        description="Separate cleanup and validation visibility for missing fields, duplicates, compliance gaps, and invalid references."
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {DATA_QUALITY_REPORTS.map((report) => (
          <Link key={report.href} href={report.href} data-testid={report.testId}>
            <Card className="h-full transition hover:border-primary">
              <CardHeader>
                <CardTitle>{report.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{report.description}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
