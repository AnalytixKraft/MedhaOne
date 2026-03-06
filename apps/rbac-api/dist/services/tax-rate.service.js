import { z } from "zod";
import { withPgClient } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { quoteIdentifier } from "../utils/schema.js";
const defaultGlobalTaxRates = [
    { code: "GST_0", label: "GST 0%", ratePercent: "0.00" },
    { code: "GST_5", label: "GST 5%", ratePercent: "5.00" },
    { code: "GST_12", label: "GST 12%", ratePercent: "12.00" },
    { code: "GST_28", label: "GST 28%", ratePercent: "28.00" },
];
const taxRateInputBase = z.object({
    code: z
        .string()
        .min(1)
        .max(40)
        .regex(/^[A-Z0-9_]+$/),
    label: z.string().min(1).max(120),
    ratePercent: z.number().min(0).max(100),
    isActive: z.boolean().default(true),
});
export const createGlobalTaxRateInput = taxRateInputBase;
export const updateGlobalTaxRateInput = taxRateInputBase.partial();
export async function listGlobalTaxRates() {
    return withPgClient(async (client) => {
        await ensureGlobalTaxRatesTableAndDefaults(client);
        const result = await client.query(`SELECT id, code, label, rate_percent::text, is_active, created_at::text, updated_at::text
       FROM public.global_tax_rates
       ORDER BY rate_percent ASC, id ASC`);
        return result.rows.map(mapGlobalTaxRateRow);
    });
}
export async function createGlobalTaxRate(rawInput) {
    const input = createGlobalTaxRateInput.parse(rawInput);
    return withPgClient(async (client) => {
        await ensureGlobalTaxRatesTableAndDefaults(client);
        try {
            const result = await client.query(`INSERT INTO public.global_tax_rates (code, label, rate_percent, is_active)
         VALUES ($1, $2, $3, $4)
         RETURNING id, code, label, rate_percent::text, is_active, created_at::text, updated_at::text`, [input.code, input.label.trim(), input.ratePercent.toFixed(2), input.isActive]);
            return mapGlobalTaxRateRow(result.rows[0]);
        }
        catch (error) {
            if (error instanceof Error && "code" in error && error.code === "23505") {
                throw new AppError(409, "GLOBAL_TAX_RATE_EXISTS", "Global tax code already exists");
            }
            throw error;
        }
    });
}
export async function updateGlobalTaxRate(id, rawInput) {
    const input = updateGlobalTaxRateInput.parse(rawInput);
    return withPgClient(async (client) => {
        await ensureGlobalTaxRatesTableAndDefaults(client);
        const existing = await client.query("SELECT id FROM public.global_tax_rates WHERE id = $1", [id]);
        if (!existing.rows[0]) {
            throw new AppError(404, "GLOBAL_TAX_RATE_NOT_FOUND", "Global tax rate not found");
        }
        const updates = [];
        const values = [];
        if (input.code !== undefined) {
            updates.push(`code = $${values.length + 1}`);
            values.push(input.code);
        }
        if (input.label !== undefined) {
            updates.push(`label = $${values.length + 1}`);
            values.push(input.label.trim());
        }
        if (input.ratePercent !== undefined) {
            updates.push(`rate_percent = $${values.length + 1}`);
            values.push(input.ratePercent.toFixed(2));
        }
        if (input.isActive !== undefined) {
            updates.push(`is_active = $${values.length + 1}`);
            values.push(input.isActive);
        }
        if (updates.length === 0) {
            const unchanged = await client.query(`SELECT id, code, label, rate_percent::text, is_active, created_at::text, updated_at::text
         FROM public.global_tax_rates
         WHERE id = $1`, [id]);
            return mapGlobalTaxRateRow(unchanged.rows[0]);
        }
        values.push(id);
        try {
            const result = await client.query(`UPDATE public.global_tax_rates
         SET ${updates.join(", ")}, updated_at = NOW()
         WHERE id = $${values.length}
         RETURNING id, code, label, rate_percent::text, is_active, created_at::text, updated_at::text`, values);
            return mapGlobalTaxRateRow(result.rows[0]);
        }
        catch (error) {
            if (error instanceof Error && "code" in error && error.code === "23505") {
                throw new AppError(409, "GLOBAL_TAX_RATE_EXISTS", "Global tax code already exists");
            }
            throw error;
        }
    });
}
export async function seedTenantTaxRatesFromGlobalDefaults(client, schemaName) {
    await ensureGlobalTaxRatesTableAndDefaults(client);
    const schema = quoteIdentifier(schemaName);
    await client.query(`INSERT INTO ${schema}.tax_rates (code, label, rate_percent, is_active)
     SELECT code, label, rate_percent, is_active
     FROM public.global_tax_rates
     WHERE is_active IS TRUE
     ON CONFLICT (code) DO NOTHING`);
}
async function ensureGlobalTaxRatesTableAndDefaults(client) {
    await client.query(`
    CREATE TABLE IF NOT EXISTS public.global_tax_rates (
      id SERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      rate_percent NUMERIC(5, 2) NOT NULL CHECK (rate_percent >= 0 AND rate_percent <= 100),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
    await client.query("CREATE INDEX IF NOT EXISTS idx_global_tax_rates_rate_percent ON public.global_tax_rates(rate_percent)");
    await client.query("CREATE INDEX IF NOT EXISTS idx_global_tax_rates_is_active ON public.global_tax_rates(is_active)");
    for (const taxRate of defaultGlobalTaxRates) {
        await client.query(`INSERT INTO public.global_tax_rates (code, label, rate_percent, is_active)
       VALUES ($1, $2, $3, TRUE)
       ON CONFLICT (code) DO NOTHING`, [taxRate.code, taxRate.label, taxRate.ratePercent]);
    }
}
function mapGlobalTaxRateRow(row) {
    return {
        id: row.id,
        code: row.code,
        label: row.label,
        ratePercent: row.rate_percent,
        isActive: row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
