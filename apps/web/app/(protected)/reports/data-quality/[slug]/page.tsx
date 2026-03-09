import { notFound } from "next/navigation";

import { GenericDataQualityReportPage } from "@/components/reports/generic-report-page";
import { findDataQualityReport } from "@/lib/reports/navigation";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function DataQualityReportDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const report = findDataQualityReport(slug);
  if (!report) {
    notFound();
  }
  return <GenericDataQualityReportPage config={report} />;
}
