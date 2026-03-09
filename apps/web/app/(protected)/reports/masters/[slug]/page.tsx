import { notFound } from "next/navigation";

import { GenericMasterReportPage } from "@/components/reports/generic-report-page";
import { ReportView } from "@/components/reports/report-view";
import { findMastersReport } from "@/lib/reports/navigation";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function MasterReportDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const report = findMastersReport(slug);
  if (!report) {
    notFound();
  }

  if (report.legacyKind) {
    return <ReportView kind={report.legacyKind} />;
  }

  return <GenericMasterReportPage config={report} />;
}
