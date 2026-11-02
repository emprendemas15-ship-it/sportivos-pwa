export type CellValue = string | number | null
export type WorkbookRow = Record<string, CellValue>

export type ModuleKey =
  | 'INVENTARIO_PT'
  | 'ENTRADAS'
  | 'VENTAS'
  | 'GASTOS'
  | 'CREDITOS'
  | 'CLIENTES'
  | 'COSTOS_NO_PRODUCIDOS'
  | 'BALANCE'

export type Column = {
  key: string
  label: string
  type?: 'text' | 'number' | 'date' | 'select'
  required?: boolean
  options?: string[]
}

const excelErrorValues = new Set([-2146826288, -2146826281, -2146826273, -2146826265, -2146826259, -2146826252, -2146826246])

export function cleanExcelError(value: CellValue | undefined): CellValue | null {
  return typeof value === 'number' && excelErrorValues.has(value) ? null : value ?? null
}

export function calculateInventoryProfit(retailPrice: CellValue | undefined, totalCost: CellValue | undefined): number | null {
  const price = cleanExcelError(retailPrice)
  const cost = cleanExcelError(totalCost)
  if (price === null || price === '' || cost === null || cost === '') return null
  const profit = Number(price) - Number(cost)
  return Number.isFinite(profit) ? profit : null
}

export const moduleColumns: Record<ModuleKey, Column[]> = {
  INVENTARIO_PT: [
    { key: 'CODIGO', label: 'CODIGO', required: true }, { key: 'DETALLE', label: 'DETALLE', required: true },
    { key: 'PRECIO', label: 'PRECIO', type: 'number' }, { key: 'PRECIO_AL_POR_MAYOR', label: 'PRECIO_AL_POR_MAYOR', type: 'number' },
    { key: 'COSTO', label: 'COSTO', type: 'number' }, { key: 'Costo fijo', label: 'Costo fijo', type: 'number' },
    { key: 'Costo MO', label: 'Costo MO', type: 'number' },
    { key: 'GANANCIA', label: 'GANANCIA', type: 'number' }, { key: 'ENTRADAS', label: 'ENTRADAS', type: 'number' },
    { key: 'SALIDAS', label: 'SALIDAS', type: 'number' }, { key: 'CONSIGNACION', label: 'CONSIGNACIÓN', type: 'number' },
    { key: 'STOCK', label: 'STOCK', type: 'number' },
  ],
  ENTRADAS: [
    { key: 'FECHA', label: 'FECHA', type: 'date', required: true }, { key: 'CODIGO', label: 'CODIGO', required: true },
    { key: 'DETALLE', label: 'DETALLE', required: true }, { key: 'CANTIDAD', label: 'CANTIDAD', type: 'number', required: true },
    { key: 'COMENTARIOS', label: 'COMENTARIOS' }, { key: 'PRECIO', label: 'PRECIO', type: 'number' },
    { key: 'VALOR_PRODUCTO', label: 'VALOR DEL PRODUCTO', type: 'number' },
  ],
  VENTAS: [
    { key: 'FECHA', label: 'FECHA', type: 'date', required: true }, { key: 'CODIGO', label: 'CODIGO', required: true },
    { key: 'DETALLE', label: 'DETALLE', required: true }, { key: 'CANT', label: 'CANT', type: 'number', required: true },
    { key: 'PRECIO', label: 'PRECIO', type: 'number', required: true }, { key: 'DESCUENTO', label: 'DESCUENTO', type: 'number' },
    { key: 'TOTAL', label: 'TOTAL', type: 'number' }, { key: 'COMENTARIO', label: 'COMENTARIO' },
    { key: 'MEDIO_DE_PAGO', label: 'MEDIO_DE_PAGO', type: 'select', options: ['Efectivo', 'Transferencia', 'Otro'] },
    { key: 'MES', label: 'MES' },
  ],
  GASTOS: [
    { key: 'FECHA', label: 'FECHA', type: 'date', required: true },
    { key: 'DETALLE', label: 'DETALLE', required: true },
    { key: 'VALOR', label: 'VALOR', type: 'number', required: true },
  ],
  CREDITOS: [
    { key: 'FECHA', label: 'FECHA', type: 'date', required: true }, { key: 'CODIGO', label: 'CODIGO' },
    { key: 'DETALLE', label: 'DETALLE' }, { key: 'CANT', label: 'CANT', type: 'number' }, { key: 'DESCUENTO', label: 'DESCUENTO', type: 'number' },
    { key: 'PRECIO', label: 'PRECIO', type: 'number' }, { key: 'NOMBRE', label: 'NOMBRE', required: true }, { key: 'COMENTARIO', label: 'COMENTARIO' },
    { key: 'TIPO', label: 'TIPO', type: 'select', options: ['Crédito', 'Abono', 'Devolución'] }, { key: 'VALOR', label: 'VALOR', type: 'number', required: true },
    { key: 'MEDIO PAGO', label: 'MEDIO PAGO', type: 'select', options: ['Efectivo', 'Transferencia', 'Otro'] }, { key: 'DEUDA', label: 'DEUDA', type: 'number' }, { key: 'MES', label: 'MES' }, { key: 'Columna1', label: 'Columna1' },
  ],
  CLIENTES: [{ key: 'NOMBRE', label: 'NOMBRE', required: true }, { key: 'Columna1', label: 'SALDO PENDIENTE', type: 'number' }],
  COSTOS_NO_PRODUCIDOS: [
    { key: 'CODIGO', label: 'CODIGO', required: true }, { key: 'DETALLE', label: 'DETALLE', required: true }, { key: 'COSTO', label: 'COSTO', type: 'number', required: true },
    { key: 'COSTO FIJO', label: 'COSTO FIJO', type: 'number' }, { key: 'COSTO TOTAL', label: 'COSTO TOTAL', type: 'number' },
    { key: 'PRECIO AL PUBLICO', label: 'PRECIO AL PUBLICO', type: 'number', required: true }, { key: 'Columna1', label: 'Columna1', type: 'number' },
  ],
  BALANCE: [],
}

const pt = (code: string, detail: string, price: number, wholesale: number, cost: number, stock: number): WorkbookRow => ({
  CODIGO: code, DETALLE: detail, PRECIO: price, PRECIO_AL_POR_MAYOR: wholesale, COSTO: cost,
  'Costo fijo': Math.round(cost * 0.02), 'Costo MO': Math.round(cost * 0.08),
  GANANCIA: wholesale - cost, ENTRADAS: stock + 1, SALIDAS: 1, CONSIGNACION: 0, STOCK: stock,
})

export const initialData: Record<ModuleKey, WorkbookRow[]> = {
  INVENTARIO_PT: [
    pt('CAM14', 'CAMA 75 X 95 CON ESPUMA 8CM', 206636, 177116, 123982, 0), pt('CAM07', 'CAMA 40 X 37', 65000, 51718, 36202, 0),
    pt('CAM06', 'CAMA 60 X 80', 110000, 95000, 62428, 1), pt('COLS', 'CAMISETA COLOMBIA S', 28000, 21857, 15300, 1),
    pt('PM', 'PANOLETA MEDIANA', 6035, 5173, 3621, 3), pt('PG', 'PANOLETAS GRANDES', 7990, 6849, 4794, 2),
    pt('PGR', 'PALO TALLA L ROJO', 18000, 13000, 7000, 4), pt('JGT', 'JUGUETE GRANDE TEJIDO', 12000, 10287, 7201, 1),
  ],
  ENTRADAS: [
    { FECHA: '2026-08-30', CODIGO: 'TP', DETALLE: 'TAPETE PEQUENO 25 X 30', CANTIDAD: 1, COMENTARIOS: null, PRECIO: 17903, Columna1: 17903 },
    { FECHA: '2026-08-30', CODIGO: 'JGT', DETALLE: 'JUGUETE GRANDE TEJIDO', CANTIDAD: 2, COMENTARIOS: null, PRECIO: 14402, Columna1: 28804 },
    { FECHA: '2026-08-16', CODIGO: 'GPXS', DETALLE: 'GORRA XS', CANTIDAD: 2, COMENTARIOS: null, PRECIO: 24072, Columna1: 48144 },
    { FECHA: '2026-07-29', CODIGO: 'PGR', DETALLE: 'PALO TALLA L ROJO', CANTIDAD: 10, COMENTARIOS: null, PRECIO: 70000, Columna1: 700000 },
    { FECHA: '2026-07-29', CODIGO: 'PPA', DETALLE: 'PALO TALLA S AMARILLO', CANTIDAD: 10, COMENTARIOS: null, PRECIO: 50000, Columna1: 500000 },
  ],
  VENTAS: [
    { FECHA: '2026-08-30', CODIGO: 'PG', DETALLE: 'PANOLETAS GRANDES', CANT: 1, PRECIO: 7990, DESCUENTO: 4000, TOTAL: 3990, COMENTARIO: null, MEDIO_DE_PAGO: 'Efectivo', MES: 'agosto' },
    { FECHA: '2026-08-30', CODIGO: 'GPS', DETALLE: 'GORRAS PEQUENAS S', CANT: 1, PRECIO: 19720, DESCUENTO: 0, TOTAL: 19720, COMENTARIO: null, MEDIO_DE_PAGO: 'Efectivo', MES: 'agosto' },
    { FECHA: '2026-08-30', CODIGO: 'PGR', DETALLE: 'PALO TALLA L ROJO', CANT: 1, PRECIO: 18000, DESCUENTO: 0, TOTAL: 18000, COMENTARIO: null, MEDIO_DE_PAGO: 'Efectivo', MES: 'agosto' },
    { FECHA: '2026-08-30', CODIGO: 'ROLB', DETALLE: 'ROLLITO DE BOLSAS', CANT: 3, PRECIO: 2040, DESCUENTO: 0, TOTAL: 6120, COMENTARIO: 'PARQUE ARVI', MEDIO_DE_PAGO: 'Transferencia', MES: 'agosto' },
    { FECHA: '2026-08-29', CODIGO: 'PM', DETALLE: 'PANOLETA MEDIANA', CANT: 1, PRECIO: 6035, DESCUENTO: 0, TOTAL: 6035, COMENTARIO: 'PARQUE ARVI', MEDIO_DE_PAGO: 'Efectivo', MES: 'agosto' },
    { FECHA: '2026-07-24', CODIGO: 'COLS', DETALLE: 'CAMISETA COLOMBIA S', CANT: 2, PRECIO: 28000, DESCUENTO: 0, TOTAL: 56000, COMENTARIO: null, MEDIO_DE_PAGO: 'Efectivo', MES: 'julio' },
  ],
  GASTOS: [
    { FECHA: '2026-08-30', CODIGO_MP: 'ESPUMA', DETALLE: 'ESPUMA', COMENTARIOS: 'COMPRA', CANTIDAD: 4, VALOR: 257600 },
    { FECHA: '2026-08-01', CODIGO_MP: null, DETALLE: null, COMENTARIOS: 'VIATICOS PARQUE ARVI', CANTIDAD: null, VALOR: 10000 },
    { FECHA: '2026-08-01', CODIGO_MP: null, DETALLE: null, COMENTARIOS: 'TOLDO PARQUE ARVI', CANTIDAD: null, VALOR: 33000 },
    { FECHA: '2026-07-15', CODIGO_MP: null, DETALLE: null, COMENTARIOS: 'PAGO TOLDO', CANTIDAD: null, VALOR: 68000 },
  ],
  CREDITOS: [
    { FECHA: '2026-07-28', CODIGO: 'PPA', DETALLE: 'PALO TALLA S AMARILLO', CANT: 1, DESCUENTO: 0, PRECIO: 10000, NOMBRE: 'VICTOR MANUEL', COMENTARIO: null, TIPO: 'Credito', VALOR: 10000, 'MEDIO PAGO': null, DEUDA: 40000, MES: 'julio' },
    { FECHA: '2026-07-24', CODIGO: 'COLS', DETALLE: 'CAMISETA COLOMBIA S', CANT: 1, DESCUENTO: 0, PRECIO: 28000, NOMBRE: 'SANDRA GUZMAN', COMENTARIO: null, TIPO: 'Credito', VALOR: 28000, 'MEDIO PAGO': null, DEUDA: 28000, MES: 'julio' },
    { FECHA: '2026-06-27', CODIGO: 'COL', DETALLE: 'COLCHONETA', CANT: 1, DESCUENTO: 0, PRECIO: 58375, NOMBRE: 'CARLOS KONDOR', COMENTARIO: null, TIPO: 'Credito', VALOR: 58375, 'MEDIO PAGO': null, DEUDA: 58375, MES: 'junio' },
    { FECHA: '2026-06-27', CODIGO: null, DETALLE: null, CANT: null, DESCUENTO: 0, PRECIO: 0, NOMBRE: 'CARLOS KONDOR', COMENTARIO: null, TIPO: 'Abono', VALOR: 30000, 'MEDIO PAGO': 'Efectivo', DEUDA: 28375, MES: 'junio' },
  ],
  CLIENTES: [{ NOMBRE: 'MARY LUZ', Columna1: 0 }, { NOMBRE: 'CATALINA CASTRO DTK', Columna1: 0 }, { NOMBRE: 'VICTOR MANUEL', Columna1: 0 }, { NOMBRE: 'CARLOS KONDOR', Columna1: 28375 }, { NOMBRE: 'SANDRA GUZMAN', Columna1: 28000 }],
  COSTOS_NO_PRODUCIDOS: [
    { CODIGO: 'CAMXL', DETALLE: 'CAMISETA PELUDA XL', COSTO: 16700, 'COSTO FIJO': 500, 'COSTO TOTAL': 17200, 'PRECIO AL PUBLICO': 30090, Columna1: 12890 },
    { CODIGO: 'DONG', DETALLE: 'DONA GRANDE', COSTO: 11650, 'COSTO FIJO': 500, 'COSTO TOTAL': 12150, 'PRECIO AL PUBLICO': 30005, Columna1: 17855 },
    { CODIGO: 'JGT', DETALLE: 'JUGUETE GRANDE TEJIDO', COSTO: 5060, 'COSTO FIJO': 500, 'COSTO TOTAL': 5560, 'PRECIO AL PUBLICO': 12002, Columna1: 6442 },
  ],
  BALANCE: [],
}

export function cloneInitialData(): Record<ModuleKey, WorkbookRow[]> {
  return JSON.parse(JSON.stringify(initialData)) as Record<ModuleKey, WorkbookRow[]>
}

export function monthName(date: string): string {
  if (!date) return ''
  return new Intl.DateTimeFormat('es-CO', { month: 'long' }).format(new Date(`${date}T12:00:00`))
}
