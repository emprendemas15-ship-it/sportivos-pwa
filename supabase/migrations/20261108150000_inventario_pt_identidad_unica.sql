-- Prevent new finished-goods rows from reusing a code or a description.
-- Existing duplicate descriptions are deliberately retained because they are
-- part of the authoritative Excel catalog and require business review.

CREATE UNIQUE INDEX IF NOT EXISTS inventario_pt_codigo_normalizado_unico
  ON public.inventario_pt (lower(trim(regexp_replace("CODIGO", '\s+', ' ', 'g'))))
  WHERE NULLIF(trim(regexp_replace("CODIGO", '\s+', ' ', 'g')), '') IS NOT NULL;

CREATE OR REPLACE FUNCTION public.prevent_duplicate_inventario_pt_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized_code text;
  normalized_detail text;
BEGIN
  normalized_code := lower(trim(regexp_replace(COALESCE(NEW."CODIGO", ''), '\s+', ' ', 'g')));
  normalized_detail := translate(
    lower(trim(regexp_replace(COALESCE(NEW."DETALLE", ''), '\s+', ' ', 'g'))),
    'áéíóúüñ', 'aeiouun'
  );

  IF normalized_code = '' THEN
    RAISE EXCEPTION 'El código del producto es obligatorio.';
  END IF;
  IF normalized_detail = '' THEN
    RAISE EXCEPTION 'La descripción del producto es obligatoria.';
  END IF;

  -- Serialize product inserts so two concurrent requests cannot pass the
  -- description check at the same time.
  PERFORM pg_advisory_xact_lock(hashtext('public.inventario_pt.product_identity'));

  IF EXISTS (
    SELECT 1 FROM public.inventario_pt p
    WHERE lower(trim(regexp_replace(COALESCE(p."CODIGO", ''), '\s+', ' ', 'g'))) = normalized_code
  ) THEN
    RAISE EXCEPTION 'El código % ya existe en el inventario.', btrim(NEW."CODIGO");
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.inventario_pt p
    WHERE translate(
            lower(trim(regexp_replace(COALESCE(p."DETALLE", ''), '\s+', ' ', 'g'))),
            'áéíóúüñ', 'aeiouun'
          ) = normalized_detail
      AND lower(trim(regexp_replace(COALESCE(p."CODIGO", ''), '\s+', ' ', 'g'))) <> normalized_code
  ) THEN
    RAISE EXCEPTION 'La descripción % ya está asignada a otro código.', btrim(NEW."DETALLE");
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventario_pt_prevent_duplicate_identity ON public.inventario_pt;
CREATE TRIGGER inventario_pt_prevent_duplicate_identity
BEFORE INSERT ON public.inventario_pt
FOR EACH ROW EXECUTE FUNCTION public.prevent_duplicate_inventario_pt_identity();
