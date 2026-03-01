import { Pool, PoolClient } from "pg";

import { env } from "../config/env.js";

export const pool = new Pool({ connectionString: env.DATABASE_URL });

export async function withPgClient<T>(fn: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
