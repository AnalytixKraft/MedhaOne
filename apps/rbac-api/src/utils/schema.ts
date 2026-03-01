export function buildOrgSchemaName(organizationId: string) {
  if (!/^[a-z0-9_]+$/.test(organizationId)) {
    throw new Error("Organization id must be snake-case alphanumeric");
  }
  return `org_${organizationId}`;
}

export function quoteIdentifier(identifier: string) {
  if (!/^[a-z_][a-z0-9_]*$/.test(identifier)) {
    throw new Error("Unsafe SQL identifier");
  }
  return `"${identifier}"`;
}
