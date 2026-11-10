CREATE TABLE IF NOT EXISTS public.sportivos_clientes_eliminados (
  client_identity text PRIMARY KEY,
  client_name text NOT NULL,
  hidden_from_clients boolean NOT NULL DEFAULT false,
  hidden_from_validation boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sportivos_clientes_eliminados ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.sportivos_clientes_eliminados TO anon, authenticated;

DROP POLICY IF EXISTS "Public can read hidden Sportivos clients"
  ON public.sportivos_clientes_eliminados;
CREATE POLICY "Public can read hidden Sportivos clients"
  ON public.sportivos_clientes_eliminados FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Public can add hidden Sportivos clients"
  ON public.sportivos_clientes_eliminados;
CREATE POLICY "Public can add hidden Sportivos clients"
  ON public.sportivos_clientes_eliminados FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Public can update hidden Sportivos clients"
  ON public.sportivos_clientes_eliminados;
CREATE POLICY "Public can update hidden Sportivos clients"
  ON public.sportivos_clientes_eliminados FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
