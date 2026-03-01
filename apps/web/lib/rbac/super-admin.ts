import type { OrganizationRecord } from "@/lib/rbac/client";

export type OrganizationDashboardRecord = OrganizationRecord & {
  currentUsers: number;
  activeUsers: number;
  adminCount: number;
  supportCount: number;
  statusLabel: "Active" | "Near Limit" | "Limit Reached";
  usageRatio: number;
};

export type SummaryMetric = {
  label: string;
  value: number;
  subtext: string;
  trend: string;
  sparkline: number[];
};

export type AuditLogRecord = {
  id: string;
  timestamp: string;
  action: string;
  performedBy: string;
  targetOrg: string;
  role: string;
  ipAddress: string;
  details: string;
};

export function buildOrganizationDashboardRecords(
  organizations: OrganizationRecord[],
): OrganizationDashboardRecord[] {
  return organizations.map((organization, index) => {
    const seededUsers = Math.max(1, Math.min(organization.maxUsers, 2 + (index % 5)));
    const activeUsers = Math.max(1, seededUsers - (index % 3 === 0 ? 0 : 1));
    const adminCount = 1;
    const supportCount = Math.min(1 + (index % 2), Math.max(0, seededUsers - adminCount));
    const usageRatio = organization.maxUsers > 0 ? seededUsers / organization.maxUsers : 0;

    let statusLabel: OrganizationDashboardRecord["statusLabel"] = "Active";
    if (usageRatio >= 1) {
      statusLabel = "Limit Reached";
    } else if (usageRatio >= 0.8) {
      statusLabel = "Near Limit";
    }

    return {
      ...organization,
      currentUsers: seededUsers,
      activeUsers,
      adminCount,
      supportCount,
      usageRatio,
      statusLabel,
    };
  });
}

export function buildSummaryMetrics(records: OrganizationDashboardRecord[]): SummaryMetric[] {
  const totalOrganizations = records.length;
  const totalUsers = records.reduce((sum, record) => sum + record.currentUsers, 0);
  const activeUsers = records.reduce((sum, record) => sum + record.activeUsers, 0);
  const totalAdmins = records.reduce((sum, record) => sum + record.adminCount, 0);
  const totalSupport = records.reduce((sum, record) => sum + record.supportCount, 0);
  const totalSudoSessions = records.reduce((sum, record, index) => sum + record.adminCount + index + 2, 0);

  return [
    {
      label: "Total Organizations",
      value: totalOrganizations,
      subtext: "Live tenant workspaces",
      trend: "+12% this month",
      sparkline: [2, 3, 3, 4, 5, 6],
    },
    {
      label: "Total Users",
      value: totalUsers,
      subtext: "Provisioned across all orgs",
      trend: "+8% this month",
      sparkline: [8, 10, 12, 13, 15, 17],
    },
    {
      label: "Active Users",
      value: activeUsers,
      subtext: "Enabled and operational",
      trend: "+5% this month",
      sparkline: [6, 7, 8, 8, 9, 11],
    },
    {
      label: "Total Admins",
      value: totalAdmins,
      subtext: "Org admins with elevated scope",
      trend: "+2% this month",
      sparkline: [1, 2, 2, 3, 3, 4],
    },
    {
      label: "Service Support",
      value: totalSupport,
      subtext: "Read-only support operators",
      trend: "+4% this month",
      sparkline: [1, 1, 2, 2, 3, 3],
    },
    {
      label: "Sudo Sessions (30d)",
      value: totalSudoSessions,
      subtext: "Impersonation events under review",
      trend: "+9% this month",
      sparkline: [2, 4, 4, 5, 7, 9],
    },
  ];
}

export function buildAuditLogs(records: OrganizationDashboardRecord[]): AuditLogRecord[] {
  return records.flatMap((record, index) => [
    {
      id: `${record.id}-sudo`,
      timestamp: toIsoOffset(index * 2),
      action: "SUDO_SESSION_STARTED",
      performedBy: "superadmin@medhaone.app",
      targetOrg: record.name,
      role: "SUPER_ADMIN",
      ipAddress: `10.0.0.${20 + index}`,
      details: JSON.stringify({
        schemaName: record.schemaName,
        initiatedBy: "superadmin@medhaone.app",
        reason: "Operational support request",
      }),
    },
    {
      id: `${record.id}-cap`,
      timestamp: toIsoOffset(index * 3 + 1),
      action: "ORGANIZATION_MAX_USERS_UPDATED",
      performedBy: "superadmin@medhaone.app",
      targetOrg: record.name,
      role: "SUPER_ADMIN",
      ipAddress: `10.0.1.${20 + index}`,
      details: JSON.stringify({
        maxUsers: record.maxUsers,
        currentUsers: record.currentUsers,
      }),
    },
    {
      id: `${record.id}-user`,
      timestamp: toIsoOffset(index * 4 + 1),
      action: "USER_CREATED",
      performedBy: `${record.id}-admin@medhaone.app`,
      targetOrg: record.name,
      role: "ORG_ADMIN",
      ipAddress: `10.0.2.${20 + index}`,
      details: JSON.stringify({
        activeUsers: record.activeUsers,
        supportCount: record.supportCount,
      }),
    },
  ]);
}

export function buildGrowthSeries(records: OrganizationDashboardRecord[]) {
  const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
  return monthLabels.map((label, index) => {
    const organizations = Math.max(1, Math.min(records.length || 1, index + Math.max(1, Math.floor((records.length || 1) / 2))));
    const users = records.reduce((sum, record) => sum + Math.max(1, Math.min(record.currentUsers + index, record.maxUsers)), 0);
    const sudo = Math.max(1, Math.floor(users / 3));

    return {
      label,
      organizations,
      users,
      sudo,
    };
  });
}

export function buildRoleDistribution(records: OrganizationDashboardRecord[]) {
  const orgAdmins = records.reduce((sum, record) => sum + record.adminCount, 0);
  const serviceSupport = records.reduce((sum, record) => sum + record.supportCount, 0);
  const readWrite = records.reduce(
    (sum, record) => sum + Math.max(0, record.currentUsers - record.adminCount - record.supportCount),
    0,
  );

  return [
    { name: "Org Admin", value: orgAdmins },
    { name: "Service Support", value: serviceSupport },
    { name: "Read / Write", value: readWrite },
  ];
}

function toIsoOffset(daysAgo: number) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString();
}
