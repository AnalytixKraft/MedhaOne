const routePermissions = [
  { prefix: "/reports/masters", permission: "reports:view" },
  { prefix: "/reports/data-quality", permission: "reports:view" },
  { prefix: "/masters/reports", permission: "masters:view" },
  { prefix: "/purchase-orders", permission: "purchase:view" },
  { prefix: "/purchase/bills", permission: "purchase_bill:view" },
  { prefix: "/sales/dispatches", permission: "dispatch:view" },
  { prefix: "/sales/orders", permission: "sales:view" },
  { prefix: "/sales", permission: "sales:view" },
  { prefix: "/inventory/modules/stock-correction", permission: "stock_correction:view" },
  { prefix: "/inventory/modules/stock-adjustment", permission: "stock_adjustment:view" },
  { prefix: "/settings/audit-trail", permission: "audit:view" },
  { prefix: "/dashboard", permission: "dashboard:view" },
  { prefix: "/masters", permission: "masters:view" },
  { prefix: "/purchase", permission: "purchase:view" },
  { prefix: "/inventory", permission: "inventory:view" },
  { prefix: "/warehouse", permission: "inventory:view" },
  { prefix: "/reports", permission: "reports:view" },
  { prefix: "/settings", permission: "settings:view" },
] as const;

export function getRequiredPermissionForPath(pathname: string): string | null {
  for (const routePermission of routePermissions) {
    if (
      pathname === routePermission.prefix ||
      pathname.startsWith(`${routePermission.prefix}/`)
    ) {
      return routePermission.permission;
    }
  }

  return null;
}
