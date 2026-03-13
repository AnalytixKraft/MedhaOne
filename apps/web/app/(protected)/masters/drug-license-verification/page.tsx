import { MastersNav } from "@/components/masters/masters-nav";
import { DrugLicenseVerificationWorkspace } from "@/components/masters/drug-license-verification-workspace";
import { PageTitle } from "@/components/layout/page-title";

export default function DrugLicenseVerificationPage() {
  return (
    <div>
      <PageTitle
        title="Drug Licence Verification"
        description="Manual-assisted compliance workspace for verifying party drug licences, capturing portal results, and maintaining traceable verification history."
      />
      <MastersNav />
      <DrugLicenseVerificationWorkspace />
    </div>
  );
}
