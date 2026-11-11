-- Persist soft-deletions for imported validation history and optionally restore stock.
CREATE TABLE IF NOT EXISTS public.validacion_creditos_registros_eliminados (
  client_identity text NOT NULL,
  transaction_key text NOT NULL,
  adjust_stock boolean NOT NULL DEFAULT false,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_identity, transaction_key)
);

ALTER TABLE public.validacion_creditos_registros_eliminados ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.validacion_creditos_registros_eliminados TO anon, authenticated;

DROP POLICY IF EXISTS "Public can read deleted validation history" ON public.validacion_creditos_registros_eliminados;
CREATE POLICY "Public can read deleted validation history"
  ON public.validacion_creditos_registros_eliminados
  FOR SELECT TO anon, authenticated USING (true);

CREATE OR REPLACE FUNCTION public.delete_validation_credit_history_transaction(
  p_client_identity text,
  p_transaction_key text,
  p_adjust_stock boolean,
  p_code text DEFAULT NULL,
  p_quantity numeric DEFAULT 0,
  p_movement_type text DEFAULT 'COMPRA'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_rows integer;
  changed_rows integer;
BEGIN
  IF COALESCE(btrim(p_client_identity), '') = '' OR COALESCE(btrim(p_transaction_key), '') = '' THEN
    RAISE EXCEPTION 'Falta la persona o el identificador del registro';
  END IF;
  IF p_adjust_stock IS NULL THEN RAISE EXCEPTION 'Indica si se debe ajustar el stock'; END IF;

  INSERT INTO public.validacion_creditos_registros_eliminados
    (client_identity, transaction_key, adjust_stock)
  VALUES (p_client_identity, p_transaction_key, p_adjust_stock)
  ON CONFLICT (client_identity, transaction_key) DO NOTHING;
  GET DIAGNOSTICS inserted_rows = ROW_COUNT;
  IF inserted_rows <> 1 THEN RAISE EXCEPTION 'Este registro ya fue eliminado'; END IF;

  IF p_adjust_stock AND upper(COALESCE(p_movement_type, '')) = 'COMPRA'
     AND COALESCE(p_quantity, 0) > 0 AND COALESCE(btrim(p_code), '') <> '' THEN
    UPDATE public.inventario_pt
       SET "STOCK" = COALESCE("STOCK", 0) + p_quantity
     WHERE lower(btrim("CODIGO")) = lower(btrim(p_code));
    GET DIAGNOSTICS changed_rows = ROW_COUNT;
    IF changed_rows <> 1 THEN RAISE EXCEPTION 'No se encontró un único producto para aumentar el stock'; END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_validation_credit_history_transaction(text, text, boolean, text, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_validation_credit_history_transaction(text, text, boolean, text, numeric, text) TO anon, authenticated;
