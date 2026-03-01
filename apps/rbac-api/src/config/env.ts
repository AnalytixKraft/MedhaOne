import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

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
  const explicitUrl = process.env.RBAC_DATABASE_URL ?? process.env.DATABASE_URL;
  if (explicitUrl) {
    return explicitUrl;
  }

  const host = process.env.RBAC_POSTGRES_HOST ?? "localhost";
  const port = process.env.RBAC_POSTGRES_PORT ?? "5432";
  const database = process.env.RBAC_POSTGRES_DB;
  const user = process.env.RBAC_POSTGRES_USER;
  const password = process.env.RBAC_POSTGRES_PASSWORD;

  if (!database || !user || !password) {
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
