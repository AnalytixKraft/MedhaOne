import { MastersNav } from "@/components/masters/masters-nav";
import { GSTVerificationWorkspace } from "@/components/masters/gst-verification-workspace";
import { PageTitle } from "@/components/layout/page-title";

export default function GSTVerificationPage() {
  return (
    <div>
      <PageTitle
        title="GST Verification"
        description="Verify taxpayer GSTIN details against the GST portal — captcha is solved automatically. Optionally link a party to save verified data to Party Master."
      />
      <MastersNav />
      <GSTVerificationWorkspace />
    </div>
  );
}
