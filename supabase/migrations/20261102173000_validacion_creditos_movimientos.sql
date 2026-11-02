CREATE TABLE IF NOT EXISTS public.validacion_creditos_movimientos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  person_sheet text NOT NULL,
  movement_type text NOT NULL CHECK (movement_type IN ('CREDITO', 'ABONO')),
  movement_date date NOT NULL,
  code text,
  detail text NOT NULL,
  quantity numeric(12, 2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit_value numeric(12, 2) NOT NULL DEFAULT 0 CHECK (unit_value >= 0),
  discount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  total numeric(12, 2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  payment_amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (payment_amount >= 0),
  balance_after numeric(12, 2) NOT NULL,
  business text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT validacion_creditos_movement_fields_check CHECK (
    (movement_type = 'CREDITO' AND code IS NOT NULL AND length(trim(code)) > 0
      AND length(trim(detail)) > 0 AND quantity > 0 AND unit_value > 0
      AND total > 0 AND payment_amount = 0)
    OR
    (movement_type = 'ABONO' AND payment_amount > 0 AND quantity = 0
      AND unit_value = 0 AND discount = 0 AND total = 0)
  )
);

CREATE INDEX IF NOT EXISTS validacion_creditos_person_date_idx
  ON public.validacion_creditos_movimientos (person_sheet, movement_date, created_at);

ALTER TABLE public.validacion_creditos_movimientos ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, DELETE ON public.validacion_creditos_movimientos TO anon, authenticated;

DROP POLICY IF EXISTS "Public can read validation credit movements"
  ON public.validacion_creditos_movimientos;
CREATE POLICY "Public can read validation credit movements"
  ON public.validacion_creditos_movimientos
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Public can add validation credit movements"
  ON public.validacion_creditos_movimientos;
CREATE POLICY "Public can add validation credit movements"
  ON public.validacion_creditos_movimientos
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Public can delete validation credit movements"
  ON public.validacion_creditos_movimientos;
CREATE POLICY "Public can delete validation credit movements"
  ON public.validacion_creditos_movimientos
  FOR DELETE TO anon, authenticated
  USING (true);
