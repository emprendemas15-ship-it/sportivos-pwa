# Arquitectura actual

## Fuente funcional

La fuente es `SPORTIVOS (1) (1).xlsm`. Solo se representan sus hojas visibles: `MENU`, `INVENTARIO_PT`, `COSTOS_NO_PRODUCIDOS`, `ENTRADAS`, `CLIENTES`, `CREDITOS`, `VENTAS`, `GASTOS` y `BALANCE`. El resumen `BALANCE SEPTIEMBRE` pertenece al historial del módulo `BALANCE`.

Las hojas ocultas no se muestran ni se importan. Esto excluye inventario de materia prima, costos ocultos, préstamos, deudas, recursos y consignaciones. Cotizaciones y lista de materiales tampoco forman parte de esta PWA.

## Aplicación y datos

- `frontend/`: aplicación React, Vite, TypeScript y PWA publicada con GitHub Pages.
- `frontend/src/App.tsx`: módulos, formularios, cálculos, sincronización y reportes.
- `frontend/src/lib/workbook.ts`: columnas visibles y reglas de captura.
- `frontend/src/lib/client-statement.ts`: PDF del estado de cuenta individual.
- `scripts/migrate-excel-to-supabase.ps1`: cotejo e importación de datos del libro a las tablas remotas.
- `backend/` y `prisma/`: componentes auxiliares que no se publican en GitHub Pages.

Los datos de las siete hojas operativas usan Supabase. Los campos calculados que no existen como columnas remotas se recalculan al leer o se excluyen al guardar: total de ENTRADAS, saldo de CLIENTES, mes de GASTOS y margen de COSTOS_NO_PRODUCIDOS. El saldo del inventario convierte el nombre de la columna de consignación entre el esquema remoto y el encabezado visible.

Los cierres mensuales se guardan en la tabla remota `balance`; `Estado del período` conserva el resumen completo para que el historial se pueda recuperar desde otro dispositivo. El balance calcula el fondo siguiente después de gastos y retiro sugerido.

## Acceso y publicación

La aplicación se publica sin inicio de sesión. Las políticas actuales de Supabase permiten acceso público a los datos usados por la PWA. El despliegue de GitHub Pages se define en `.github/workflows/pages.yml` y requiere los secretos `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.
