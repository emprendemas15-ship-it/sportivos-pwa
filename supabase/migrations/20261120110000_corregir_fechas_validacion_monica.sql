DO $$
DECLARE
  corrected_rows integer;
BEGIN
  UPDATE public.validacion_creditos_movimientos
     SET movement_date = DATE '2026-11-08'
   WHERE person_sheet = 'MONICA LOCAL'
     AND movement_date = DATE '2026-11-19'
     AND movement_type = 'CREDITO'
     AND (
       (id = '3595ba36-fc64-4ac1-ac01-bffd35d190e2'::uuid AND code = 'COBANG' AND total = 95000)
       OR
       (id = 'd782dffd-34b6-4393-bbca-60ccb0d55bba'::uuid AND code = 'REDNI' AND total = 210000)
     );

  SELECT count(*) INTO corrected_rows
    FROM public.validacion_creditos_movimientos
   WHERE person_sheet = 'MONICA LOCAL'
     AND movement_date = DATE '2026-11-08'
     AND movement_type = 'CREDITO'
     AND (
       (id = '3595ba36-fc64-4ac1-ac01-bffd35d190e2'::uuid AND code = 'COBANG' AND total = 95000)
       OR
       (id = 'd782dffd-34b6-4393-bbca-60ccb0d55bba'::uuid AND code = 'REDNI' AND total = 210000)
     );

  IF corrected_rows <> 2 THEN
    RAISE EXCEPTION 'No se pudieron verificar las dos fechas corregidas de MONICA LOCAL; se encontraron % registros.', corrected_rows;
  END IF;
END;
$$;
