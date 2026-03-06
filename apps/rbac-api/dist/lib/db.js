import { Pool } from "pg";
import { env } from "../config/env.js";
export const pool = new Pool({ connectionString: env.DATABASE_URL });
export async function withPgClient(fn) {
    const client = await pool.connect();
    try {
        return await fn(client);
    }
    finally {
        client.release();
    }
}
