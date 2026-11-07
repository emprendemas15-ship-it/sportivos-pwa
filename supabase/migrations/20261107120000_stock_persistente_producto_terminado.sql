-- Producto terminado now uses one authoritative, persisted balance.
-- Historical movement rows are kept; the initial stock is deliberately reset.
CREATE TABLE IF NOT EXISTS public.inventario_pt_stock_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  initialized_at timestamptz NOT NULL
);

INSERT INTO public.inventario_pt_stock_config (id, initialized_at)
VALUES (true, now())
ON CONFLICT (id) DO UPDATE SET initialized_at = EXCLUDED.initialized_at;

UPDATE public.inventario_pt SET "STOCK" = 0;

CREATE OR REPLACE FUNCTION public.apply_inventario_pt_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_row jsonb;
  new_row jsonb;
  movement jsonb;
  item_code text;
  item_type text;
  item_quantity numeric;
  delta numeric;
  movement_index integer;
  changed_rows integer;
  stock_initialized_at timestamptz;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN old_row := to_jsonb(OLD); END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN new_row := to_jsonb(NEW); END IF;

  SELECT initialized_at INTO stock_initialized_at
  FROM public.inventario_pt_stock_config WHERE id = true;
  IF TG_OP IN ('UPDATE', 'DELETE')
     AND COALESCE(NULLIF(old_row->>'created_at', '')::timestamptz, '-infinity'::timestamptz) < stock_initialized_at THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  FOR movement_index IN 1..2 LOOP
    movement := CASE movement_index WHEN 1 THEN old_row ELSE new_row END;
    IF movement IS NULL THEN CONTINUE; END IF;
    item_code := btrim(COALESCE(movement->>'CODIGO', ''));
    item_type := lower(btrim(COALESCE(movement->>'TIPO', '')));
    item_quantity := COALESCE(NULLIF(movement->>'CANTIDAD', '')::numeric,
                              NULLIF(movement->>'CANT', '')::numeric, 0);
    IF item_quantity = 0 OR (TG_TABLE_NAME = 'creditos' AND item_type IN ('abono', 'pago')) THEN CONTINUE; END IF;

    IF TG_TABLE_NAME = 'entradas' THEN
      delta := item_quantity;
    ELSIF TG_TABLE_NAME = 'ventas' THEN
      delta := -item_quantity;
    ELSIF TG_TABLE_NAME = 'creditos' THEN
      IF item_type IN ('devolución', 'devolucion') THEN delta := item_quantity;
      ELSE delta := -item_quantity;
      END IF;
    ELSE
      CONTINUE;
    END IF;

    -- Reverse OLD, apply NEW; on DELETE there is no NEW row.
    IF movement_index = 1 THEN delta := -delta; END IF;
    IF item_code = '' THEN RAISE EXCEPTION 'El movimiento de inventario necesita código de producto'; END IF;

    UPDATE public.inventario_pt
       SET "STOCK" = COALESCE("STOCK", 0) + delta
     WHERE lower(btrim("CODIGO")) = lower(item_code)
       AND COALESCE("STOCK", 0) + delta >= 0;
    GET DIAGNOSTICS changed_rows = ROW_COUNT;
    IF changed_rows = 0 THEN
      RAISE EXCEPTION 'Stock insuficiente o producto inexistente para código %', item_code;
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS entradas_actualiza_stock_pt ON public.entradas;
CREATE TRIGGER entradas_actualiza_stock_pt
AFTER INSERT OR UPDATE OR DELETE ON public.entradas
FOR EACH ROW EXECUTE FUNCTION public.apply_inventario_pt_movement();

DROP TRIGGER IF EXISTS ventas_actualiza_stock_pt ON public.ventas;
CREATE TRIGGER ventas_actualiza_stock_pt
AFTER INSERT OR UPDATE OR DELETE ON public.ventas
FOR EACH ROW EXECUTE FUNCTION public.apply_inventario_pt_movement();

DROP TRIGGER IF EXISTS creditos_actualiza_stock_pt ON public.creditos;
CREATE TRIGGER creditos_actualiza_stock_pt
AFTER INSERT OR UPDATE OR DELETE ON public.creditos
FOR EACH ROW EXECUTE FUNCTION public.apply_inventario_pt_movement();

CREATE OR REPLACE FUNCTION public.add_inventory_pt_counts(p_items jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item jsonb;
  item_code text;
  item_quantity numeric;
  changed_rows integer;
BEGIN
  IF jsonb_typeof(p_items) <> 'array' THEN RAISE EXCEPTION 'La lista del conteo debe ser un arreglo'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    item_code := btrim(COALESCE(item->>'codigo', ''));
    item_quantity := COALESCE(NULLIF(item->>'cantidad', '')::numeric, -1);
    IF item_code = '' OR item_quantity < 0 THEN RAISE EXCEPTION 'Código o cantidad de conteo inválidos'; END IF;
    UPDATE public.inventario_pt
       SET "STOCK" = COALESCE("STOCK", 0) + item_quantity
     WHERE lower(btrim("CODIGO")) = lower(item_code);
    GET DIAGNOSTICS changed_rows = ROW_COUNT;
    IF changed_rows = 0 THEN RAISE EXCEPTION 'No existe producto con código %', item_code; END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.add_inventory_pt_counts(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_inventory_pt_counts(jsonb) TO anon, authenticated;
