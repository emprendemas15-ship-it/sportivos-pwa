# Auditoría del libro de referencia

Fuente inspeccionada: `C:\Users\victor\Downloads\SPORTIVOS (1) (1).xlsm`.

## Hojas visibles implementadas

El libro tiene 17 hojas. Después de revisar el estado de cada hoja en `xl/workbook.xml`, las únicas hojas visibles son:

`MENU`, `INVENTARIO_PT`, `COSTOS_NO_PRODUCIDOS`, `ENTRADAS`, `CLIENTES`, `CREDITOS`, `VENTAS`, `GASTOS` y `BALANCE`. `BALANCE SEPTIEMBRE` es un resumen histórico que se conserva como un periodo guardado dentro del único módulo `BALANCE`.

Estas son las únicas hojas visibles representadas en la PWA. Los dos formatos de balance se presentan en un único módulo con historial mensual.

## Hojas ocultas excluidas

No se implementan las hojas ocultas `INSTRUCCIONES`, `INVENTARIO_MP`, `PRESTAMOS`, `DEUDAS`, `RECURSOS`, `COSTOS`, `CONSIGNACION` ni ninguna funcionalidad asociada a ellas.

También quedaron fuera del proyecto las funcionalidades de cotizaciones, lista de materiales y flujo de caja porque no corresponden a hojas visibles del archivo Sportivos analizado.

## Relaciones usadas

- `INVENTARIO_PT` toma las entradas registradas, las ventas y los créditos.
- El formulario de `INVENTARIO_PT` captura `CODIGO` y `DETALLE`; precio/costos y existencias son columnas calculadas. Solo se completa automáticamente la ficha de costos cuando el código existe en la hoja visible `COSTOS_NO_PRODUCIDOS`.
- `VENTAS` calcula `TOTAL` con cantidad, precio y descuento, y deriva el mes desde la fecha.
- `CREDITOS` registra créditos y abonos por cliente y calcula la deuda resultante.
- `GASTOS` conserva `MES` como campo manual; las filas visibles del libro usan `Otro`.
- `BALANCE` conserva un resumen por mes. Septiembre se carga como histórico y cada nuevo periodo guardado se agrega en el mismo módulo.
- Los formularios respetan las columnas visibles del libro. Las columnas calculadas se generan al guardar: total de ENTRADAS, saldo neto de CLIENTES, valor/deuda/mes de CREDITOS, total/mes de VENTAS y costo total/margen de COSTOS_NO_PRODUCIDOS.
- `COSTOS_NO_PRODUCIDOS` conserva los costos de productos comprados o no producidos.

## Datos cargados

Se importaron a Supabase los registros de las hojas visibles de datos: `INVENTARIO_PT` (222), `ENTRADAS` (273), `VENTAS` (9), `GASTOS` (32), `CREDITOS` (575), `CLIENTES` (63) y `COSTOS_NO_PRODUCIDOS` (230). Los campos calculados se omiten de la escritura cuando no existen como columnas remotas; la PWA los genera al mostrar o guardar los formularios.

El historial de `BALANCE` se guarda en la tabla remota `balance` para compartir los cierres entre dispositivos. La PWA se despliega sin inicio de sesión, por lo que esos datos quedan accesibles públicamente.

## Comprobación de paridad con el XLSM

En la revisión del 2 de noviembre de 2026, las cantidades de registros del libro y de la web coincidieron en `ENTRADAS` (273), `VENTAS` (9), `GASTOS` (32), `CREDITOS` (575), `CLIENTES` (63) y `COSTOS_NO_PRODUCIDOS` (230). `INVENTARIO_PT` tenía 222 filas en el libro y 223 en Supabase; el registro adicional de la web se conservó para no borrar datos ingresados desde la aplicación.

Se corrigió `GANANCIA` para seguir la fórmula visible del libro (`PRECIO` menos `COSTO`) y se dejaron de mostrar como importes los códigos de error de Excel presentes en columnas calculadas.

Quedan dos diferencias de valores que requieren decisión antes de forzar una copia literal:

- `INVENTARIO_PT`: el cálculo dinámico de la web coincide con el `STOCK` guardado en 214 de las 222 filas; en 8 filas el valor guardado difiere. La web vuelve a calcular existencias con entradas, ventas, créditos y devoluciones, mientras que el libro conserva los valores de `SALIDAS` y `STOCK` como datos guardados.
- `BALANCE` de octubre: los totales de recaudo, costos y gastos coinciden, pero el detalle de costos fijos muestra $13.000 en la web (26 unidades de las entradas) y $10.500 en el balance guardado del libro (21 unidades). La hoja de balance contiene valores estáticos, no fórmulas; por eso se mantiene el cálculo dinámico y no se sustituye por el valor histórico.

La verificación del modo celular a 390 px confirmó las mismas filas y valores que en escritorio en todas las hojas; las tablas anchas se pueden desplazar horizontalmente sin desbordar la página.
