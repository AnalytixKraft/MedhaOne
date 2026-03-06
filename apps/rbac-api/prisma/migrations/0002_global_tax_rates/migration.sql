CREATE TABLE IF NOT EXISTS public.global_tax_rates (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  rate_percent NUMERIC(5, 2) NOT NULL CHECK (rate_percent >= 0 AND rate_percent <= 100),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_global_tax_rates_rate_percent
  ON public.global_tax_rates(rate_percent);
CREATE INDEX IF NOT EXISTS idx_global_tax_rates_is_active
  ON public.global_tax_rates(is_active);

INSERT INTO public.global_tax_rates (code, label, rate_percent, is_active)
VALUES
  ('GST_0', 'GST 0%', 0.00, TRUE),
  ('GST_5', 'GST 5%', 5.00, TRUE),
  ('GST_12', 'GST 12%', 12.00, TRUE),
  ('GST_28', 'GST 28%', 28.00, TRUE)
ON CONFLICT (code) DO NOTHING;
