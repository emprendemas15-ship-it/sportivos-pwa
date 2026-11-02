# Sportivos PWA

Aplicación web progresiva basada en las hojas visibles de `SPORTIVOS (1) (1).xlsm`. La PWA incluye `MENU`, `INVENTARIO_PT`, `COSTOS_NO_PRODUCIDOS`, `ENTRADAS`, `CLIENTES`, `CREDITOS`, `VENTAS`, `GASTOS` y un único módulo `BALANCE` con historial mensual. `BALANCE SEPTIEMBRE` se muestra como el cierre histórico de septiembre, no como otro módulo.

También se incorporó el módulo `VALIDACION CREDITOS`, alimentado por `CREDITOS (2).xlsm`, con migración por persona, compras, abonos, saldos pendientes y detalle individual por cliente. La auditoría de hojas, formularios, columnas y cálculos está en [docs/excel-audit.md](./docs/excel-audit.md).

La ficha conserva el historial importado y permite agregar créditos o abonos por persona. Los movimientos nuevos se guardan aparte de la tabla del módulo `CREDITOS`, en `public.validacion_creditos_movimientos`; para habilitar el formulario, ejecuta una sola vez [la migración de Supabase](./supabase/migrations/20261102173000_validacion_creditos_movimientos.sql) desde el SQL Editor del proyecto Supabase. Como la PWA es pública y no requiere inicio de sesión, esa tabla también permite lectura e inserción públicas.

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

En cada tabla de datos se puede borrar un registro con confirmación; al sincronizar de nuevo se recalculan las existencias y los saldos derivados. Los balances ya guardados se conservan como cierres históricos y se actualizan al generar y guardar otra vez el periodo.

La publicación está configurada en `.github/workflows/pages.yml`. GitHub Actions necesita los secretos `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`. El archivo local `frontend/.env.local` no se sube al repositorio.

La PWA conserva un identificador y una URL de inicio estables para que el acceso directo instalado siga apuntando a la misma aplicación. Al abrirla, volver a enfocarla o recuperar conexión, comprueba si hay una nueva versión; mientras permanece abierta, vuelve a comprobarla cada minuto y se actualiza automáticamente.

La PWA queda pública y sin inicio de sesión, según lo solicitado. Por ello, los nombres de clientes, créditos y demás información de la base son accesibles públicamente mediante la aplicación y la API.

## Estructura

- `frontend/`: PWA Sportivos con React, Vite y TypeScript.
- `scripts/migrate-excel-to-supabase.ps1`: importación de las hojas visibles del XLSM.
- `docs/`: auditoría del libro y arquitectura.
- `backend/` y `prisma/`: componentes auxiliares que no forman parte del despliegue de GitHub Pages.
