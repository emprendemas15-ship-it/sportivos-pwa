CREATE TABLE IF NOT EXISTS public.inventario_conteos_fisicos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL CHECK (length(trim(codigo)) > 0),
  cantidad_contada numeric(12, 3) NOT NULL CHECK (cantidad_contada >= 0),
  contado_at timestamptz NOT NULL DEFAULT now(),
  nota text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inventario_conteos_fisicos_codigo_fecha_idx
  ON public.inventario_conteos_fisicos (codigo, contado_at, created_at);

ALTER TABLE public.inventario_conteos_fisicos ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.inventario_conteos_fisicos TO anon, authenticated;

DROP POLICY IF EXISTS "Public can read physical inventory counts"
  ON public.inventario_conteos_fisicos;
CREATE POLICY "Public can read physical inventory counts"
  ON public.inventario_conteos_fisicos
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Public can add physical inventory counts"
  ON public.inventario_conteos_fisicos;
CREATE POLICY "Public can add physical inventory counts"
  ON public.inventario_conteos_fisicos
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);
