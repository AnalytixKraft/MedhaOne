import { MastersNav } from "@/components/masters/masters-nav";
import { MasterSettingsManager } from "@/components/masters/master-settings-manager";
import { PageTitle } from "@/components/layout/page-title";

type MasterSettingsPageProps = {
  searchParams?: Promise<{ tab?: string }>;
};

export default async function MasterSettingsPage({
  searchParams,
}: MasterSettingsPageProps) {
  const resolved = (await searchParams) ?? {};
  const initialTab =
    resolved.tab === "categories" ||
    resolved.tab === "tds-tcs" ||
    resolved.tab === "gst" ||
    resolved.tab === "brands"
      ? resolved.tab
      : "gst";

  return (
    <div>
      <PageTitle
        title="Master Settings"
        description="Manage GST slabs, brands, categories, and future tax controls from one place."
      />
      <MastersNav />
      <MasterSettingsManager initialTab={initialTab} />
    </div>
  );
}
