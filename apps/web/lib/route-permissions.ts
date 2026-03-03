const routePermissions = [
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
