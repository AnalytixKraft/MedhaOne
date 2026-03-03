import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { z } from "zod";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const serviceRoot = path.resolve(currentDir, "..", "..");
const repoRoot = path.resolve(serviceRoot, "..", "..");

dotenv.config({ path: path.join(serviceRoot, ".env") });
dotenv.config({ path: path.join(repoRoot, ".env"), override: false });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(1740),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_EXPIRES_IN: z.string().default("8h"),
  CORS_ORIGIN: z.string().default("http://localhost:1729"),
  SUPER_ADMIN_EMAIL: z.string().email(),
  SUPER_ADMIN_PASSWORD: z.string().min(12),
});

function buildDatabaseUrl() {
  const explicitRbacUrl = process.env.RBAC_DATABASE_URL;
  if (explicitRbacUrl) {
    return explicitRbacUrl;
  }

  const host = process.env.RBAC_POSTGRES_HOST ?? "127.0.0.1";
  const port = process.env.RBAC_POSTGRES_PORT ?? "55432";
  const database = process.env.RBAC_POSTGRES_DB;
  const user = process.env.RBAC_POSTGRES_USER;
  const password = process.env.RBAC_POSTGRES_PASSWORD;

  if (!database || !user || !password) {
    const fallbackUrl = process.env.DATABASE_URL;
    if (
      fallbackUrl &&
      (fallbackUrl.startsWith("postgresql://") || fallbackUrl.startsWith("postgres://"))
    ) {
      return fallbackUrl;
    }
    return undefined;
  }

  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}?schema=public`;
}

export const env = envSchema.parse({
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.RBAC_PORT ?? process.env.PORT,
  DATABASE_URL: buildDatabaseUrl(),
  JWT_SECRET: process.env.RBAC_JWT_SECRET ?? process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.RBAC_JWT_EXPIRES_IN ?? process.env.JWT_EXPIRES_IN,
  CORS_ORIGIN: process.env.RBAC_CORS_ORIGIN ?? process.env.CORS_ORIGIN,
  SUPER_ADMIN_EMAIL: process.env.RBAC_SUPER_ADMIN_EMAIL ?? process.env.SUPER_ADMIN_EMAIL,
  SUPER_ADMIN_PASSWORD:
    process.env.RBAC_SUPER_ADMIN_PASSWORD ?? process.env.SUPER_ADMIN_PASSWORD,
});
