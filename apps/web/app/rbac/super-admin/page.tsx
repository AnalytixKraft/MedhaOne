import { SuperAdminLayout } from "@/components/rbac/super-admin/layout";
import { SuperAdminDashboardView } from "@/components/rbac/super-admin/dashboard-view";

export default function SuperAdminPage() {
  return (
    <SuperAdminLayout>
      <SuperAdminDashboardView />
    </SuperAdminLayout>
  );
}
