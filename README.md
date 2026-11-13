# Sportivos PWA

Aplicación web progresiva basada en las hojas visibles de `SPORTIVOS (1) (1).xlsm`. La PWA incluye `MENU`, `INVENTARIO_PT`, `COSTOS_NO_PRODUCIDOS`, `ENTRADAS`, `CLIENTES`, `CREDITOS`, `VENTAS`, `GASTOS` y un único módulo `BALANCE` con historial mensual. `BALANCE SEPTIEMBRE` se muestra como el cierre histórico de septiembre, no como otro módulo.

También se incorporó el módulo `VALIDACION CREDITOS`, cuyo historial base se toma de los movimientos actuales de la tabla `CREDITOS` en Supabase, no del Excel. La auditoría de hojas, formularios, columnas y cálculos está en [docs/excel-audit.md](./docs/excel-audit.md).

La ficha muestra en solo lectura el historial real de CREDITOS y permite agregar o eliminar movimientos propios de VALIDACION CREDITOS. Al registrar un crédito, el campo de código sugiere los códigos que esa persona ya tiene en CREDITOS y, al elegir o escribir uno exacto, completa la descripción, el precio unitario y el descuento del último crédito de esa persona con ese código; también permite escribir un código nuevo. El botón `Historial PDF` descarga el historial visible de una persona, con sus movimientos, totales y saldo. Los movimientos nuevos se guardan aparte de la tabla del módulo `CREDITOS`, en `public.validacion_creditos_movimientos`, y no alteran CLIENTES ni CREDITOS; para habilitar el formulario y sus acciones, ejecuta una sola vez [la migración de Supabase](./supabase/migrations/20261102173000_validacion_creditos_movimientos.sql) desde el SQL Editor del proyecto Supabase. Como la PWA es pública y no requiere inicio de sesión, esa tabla permite lectura, inserción y eliminación públicas.

## Desarrollo y validación

Requisitos: Node.js 20.19+ o 22.12+ y npm.

```sh
npm ci
npm run dev --workspace=frontend
npm run build --workspace=frontend
npm run lint --workspace=frontend
```

## Datos y publicación

Los registros de las siete hojas de datos se sincronizan con Supabase. El historial de balances se guarda en la tabla `balance` para que los cierres se compartan entre dispositivos. La importación desde el libro se prepara con `scripts/migrate-excel-to-supabase.ps1`; `-Preview` valida cantidades y columnas sin escribir datos.

En cada tabla de datos se puede borrar un registro con confirmación; al sincronizar de nuevo se recalculan las existencias y los saldos derivados. En VALIDACION CREDITOS solo se pueden borrar los movimientos nuevos; los registros que provienen de CREDITOS son de solo lectura y se administran desde ese módulo. Los balances ya guardados se conservan como cierres históricos y se actualizan al generar y guardar otra vez el periodo.

La publicación está configurada en `.github/workflows/pages.yml`. GitHub Actions necesita los secretos `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`. El archivo local `frontend/.env.local` no se sube al repositorio.

La PWA conserva un identificador y una URL de inicio estables para que el acceso directo instalado siga apuntando a la misma aplicación. Al abrirla, volver a enfocarla o recuperar conexión, comprueba si hay una nueva versión; mientras permanece abierta, vuelve a comprobarla cada minuto y se actualiza automáticamente.

La PWA queda pública y sin inicio de sesión, según lo solicitado. Por ello, los nombres de clientes, créditos y demás información de la base son accesibles públicamente mediante la aplicación y la API. El borrado de movimientos de VALIDACION CREDITOS también queda disponible para cualquier visitante; no hay autenticación que lo limite a una persona específica.

## Estructura

- `frontend/`: PWA Sportivos con React, Vite y TypeScript.
- `scripts/migrate-excel-to-supabase.ps1`: importación de las hojas visibles del XLSM.
- `docs/`: auditoría del libro y arquitectura.
- `backend/` y `prisma/`: componentes auxiliares que no forman parte del despliegue de GitHub Pages.
