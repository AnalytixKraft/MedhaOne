export type AppRole =
  | "SUPER_ADMIN"
  | "ORG_ADMIN"
  | "SERVICE_SUPPORT"
  | "VIEW_ONLY"
  | "READ_WRITE";

export type AuthContext = {
  userId: string;
  email: string;
  fullName: string;
  role: AppRole;
  organizationId?: string;
  schemaName?: string;
  sudoFlag: boolean;
  impersonatedBy?: string;
};
