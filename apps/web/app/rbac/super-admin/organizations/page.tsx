import { SuperAdminLayout } from "@/components/rbac/super-admin/layout";
import { SuperAdminOrganizationsView } from "@/components/rbac/super-admin/organizations-view";

export default function SuperAdminOrganizationsPage() {
  return (
    <SuperAdminLayout>
      <SuperAdminOrganizationsView />
    </SuperAdminLayout>
  );
}
