-- Keeps the reconciled customer balance separate without rewriting credit history.
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS saldo_base numeric,
  ADD COLUMN IF NOT EXISTS saldo_base_fecha timestamptz;

COMMENT ON COLUMN public.clientes.saldo_base IS
  'Saldo confirmado usado como base para calcular la cartera de este cliente.';
COMMENT ON COLUMN public.clientes.saldo_base_fecha IS
  'Corte del saldo base; solo se suman movimientos de CREDITOS posteriores a esta fecha.';
