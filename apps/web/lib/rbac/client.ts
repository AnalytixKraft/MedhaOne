export type RbacRole = "SUPER_ADMIN" | "ORG_ADMIN" | "SERVICE_SUPPORT" | "VIEW_ONLY" | "READ_WRITE";

export type RbacSessionUser = {
  id: string;
  email: string;
  fullName: string;
  role: RbacRole;
  organizationId?: string;
};

export type RbacSessionSnapshot = {
  token: string;
  user: RbacSessionUser;
  sudoBanner?: string;
};

export type RbacSession = RbacSessionSnapshot & {
  parentSession?: RbacSessionSnapshot;
};

export type OrganizationRecord = {
  id: string;
  name: string;
  schemaName: string;
  maxUsers: number;
  currentUsers: number;
  activeUsers: number;
  adminCount: number;
  supportCount: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type GlobalAuditLogRecord = {
  id: string;
  timestamp: string;
  action: string;
  performedBy: string;
  targetOrg: string;
  role: string;
  ipAddress: string;
  details: string;
};

export type OrgUserRecord = {
  id: string;
  email: string;
  fullName: string;
  role: "ORG_ADMIN" | "SERVICE_SUPPORT" | "VIEW_ONLY" | "READ_WRITE";
  isActive: boolean;
  lastLoginAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

const baseUrl = "/api/rbac";
const storageKey = "medhaone-rbac-session";

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `Request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export const rbacClient = {
  login: (payload: { email: string; password: string; organizationId?: string }) =>
    request<RbacSession>("/auth/login", { method: "POST", body: JSON.stringify(payload) }),
  listOrganizations: (token?: string) => request<OrganizationRecord[]>("/organizations", { method: "GET" }, token),
  createOrganization: (
    token: string | undefined,
    payload: {
      id: string;
      name: string;
      maxUsers: number;
      adminEmail: string;
      adminPassword: string;
      adminFullName: string;
    },
  ) => request<OrganizationRecord>("/organizations", { method: "POST", body: JSON.stringify(payload) }, token),
  updateMaxUsers: (token: string | undefined, organizationId: string, maxUsers: number) =>
    request<OrganizationRecord>(
      `/organizations/${organizationId}/max-users`,
      { method: "PATCH", body: JSON.stringify({ maxUsers }) },
      token,
    ),
  updateOrganization: (
    token: string | undefined,
    organizationId: string,
    payload: { name: string; maxUsers: number; isActive: boolean },
  ) =>
    request<OrganizationRecord>(
      `/organizations/${organizationId}`,
      { method: "PATCH", body: JSON.stringify(payload) },
      token,
    ),
  resetOrganizationAdminPassword: (token: string | undefined, organizationId: string, password: string) =>
    request<{ organizationId: string; adminEmail: string }>(
      `/superadmin/org/${organizationId}/reset-admin-password`,
      { method: "POST", body: JSON.stringify({ password }) },
      token,
    ),
  listOrganizationAuditLogs: (token: string | undefined, organizationId?: string) =>
    request<GlobalAuditLogRecord[]>(
      organizationId ? `/organizations/${organizationId}/audit-logs` : "/organizations/audit-logs",
      { method: "GET" },
      token,
    ),
  deleteOrganization: (token: string | undefined, organizationId: string) =>
    request<{ id: string; name: string; schemaName: string }>(
      `/organizations/${organizationId}`,
      { method: "DELETE" },
      token,
    ),
  sudo: (token: string | undefined, organizationId: string) =>
    request<{ token: string; banner: string; organization: OrganizationRecord }>(
      `/auth/sudo/${organizationId}`,
      { method: "POST" },
      token,
    ),
  listUsers: (token?: string) => request<OrgUserRecord[]>("/users", { method: "GET" }, token),
  createUser: (
    token: string | undefined,
    payload: { email: string; password: string; fullName: string; role: "VIEW_ONLY" | "READ_WRITE" | "SERVICE_SUPPORT" },
  ) => request<OrgUserRecord>("/users", { method: "POST", body: JSON.stringify(payload) }, token),
  updateUserRole: (token: string | undefined, userId: string, role: "VIEW_ONLY" | "READ_WRITE" | "SERVICE_SUPPORT") =>
    request<OrgUserRecord>(`/users/${userId}/role`, { method: "PATCH", body: JSON.stringify({ role }) }, token),
  updateUserStatus: (token: string | undefined, userId: string, isActive: boolean) =>
    request<OrgUserRecord>(`/users/${userId}/status`, { method: "PATCH", body: JSON.stringify({ isActive }) }, token),
  loadSession: () => {
    if (typeof window === "undefined") {
      return null;
    }
    const raw = window.localStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as RbacSession) : null;
  },
  saveSession: (session: RbacSession) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(storageKey, JSON.stringify(session));
    }
  },
  clearSession: () => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(storageKey);
    }
  },
};
