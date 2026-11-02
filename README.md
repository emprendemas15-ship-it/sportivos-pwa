# Sportivos PWA

Aplicación web progresiva basada en las hojas visibles de `SPORTIVOS (1) (1).xlsm`. La PWA incluye `MENU`, `INVENTARIO_PT`, `COSTOS_NO_PRODUCIDOS`, `ENTRADAS`, `CLIENTES`, `CREDITOS`, `VENTAS`, `GASTOS` y un único módulo `BALANCE` con historial mensual. `BALANCE SEPTIEMBRE` se muestra como el cierre histórico de septiembre, no como otro módulo.

La auditoría de hojas, formularios, columnas y cálculos está en [docs/excel-audit.md](./docs/excel-audit.md).

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

La publicación está configurada en `.github/workflows/pages.yml`. GitHub Actions necesita los secretos `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`. El archivo local `frontend/.env.local` no se sube al repositorio.

La PWA queda pública y sin inicio de sesión, según lo solicitado. Por ello, los nombres de clientes, créditos y demás información de la base son accesibles públicamente mediante la aplicación y la API.

## Estructura

- `frontend/`: PWA Sportivos con React, Vite y TypeScript.
- `scripts/migrate-excel-to-supabase.ps1`: importación de las hojas visibles del XLSM.
- `docs/`: auditoría del libro y arquitectura.
- `backend/` y `prisma/`: componentes auxiliares que no forman parte del despliegue de GitHub Pages.
