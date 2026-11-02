import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import XLSX from 'xlsx'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const workbookPath = path.resolve(__dirname, '..', 'CREDITOS (2).xlsm')
const outputPath = path.resolve(__dirname, '..', 'frontend', 'src', 'data', 'validacion-creditos.json')

const number = (value) => {
  if (value === null || value === undefined || value === '') return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const normalized = String(value).replace(/\./g, '').replace(/,/g, '.').trim()
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

const cleanText = (value) => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.trim()
  return String(value).trim()
}

const toIsoDate = (value) => {
  if (!value) return null
  if (typeof value === 'number') {
    const asDate = XLSX.SSF.parse_date_code(value)
    if (asDate) return `${asDate.y}-${String(asDate.m).padStart(2, '0')}-${String(asDate.d).padStart(2, '0')}`
    return null
  }
  const text = cleanText(value)
  if (!text) return null
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (iso) return `${iso[1]}-${String(iso[2]).padStart(2, '0')}-${String(iso[3]).padStart(2, '0')}`
  const dmy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (dmy) return `${dmy[3]}-${String(dmy[2]).padStart(2, '0')}-${String(dmy[1]).padStart(2, '0')}`
  const dmySlash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (dmySlash) {
    const year = Number(dmySlash[3]) < 100 ? 2000 + Number(dmySlash[3]) : Number(dmySlash[3])
    return `${year}-${String(dmySlash[2]).padStart(2, '0')}-${String(dmySlash[1]).padStart(2, '0')}`
  }
  const parsed = new Date(text)
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10)
  return null
}

const normalizeKey = (value) => cleanText(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

const workbook = XLSX.readFile(workbookPath, { cellDates: true, raw: false })
const people = []

for (const sheetName of workbook.SheetNames) {
  if (sheetName === 'INGRESO DE CLIENTES') continue

  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, blankrows: false })
  const nonEmptyRows = rows.filter((row) => Array.isArray(row) && row.some((value) => value !== null && cleanText(value) !== ''))
  if (nonEmptyRows.length < 2) continue

  const headerIndex = nonEmptyRows.findIndex((row) => row.some((value) => {
    const text = normalizeKey(value)
    return ['codigo', 'fecha', 'detalle', 'cantidad', 'valor', 'total', 'abona', 'abono', 'debe'].some((entry) => text.includes(entry))
  }))

  if (headerIndex === -1) continue

  const headerRow = nonEmptyRows[headerIndex]
  const columnMap = {}
  headerRow.forEach((value, index) => {
    const key = normalizeKey(value)
    if (!key) return
    if (key.includes('codigo') || key === 's') columnMap.codigo = index
    else if (key.includes('fecha')) columnMap.fecha = index
    else if (key.includes('detalle')) columnMap.detalle = index
    else if (key.includes('cantidad')) columnMap.cantidad = index
    else if (key.includes('valor')) columnMap.valor = index
    else if (key.includes('descuento')) columnMap.descuento = index
    else if (key.includes('total')) columnMap.total = index
    else if (key.includes('abona') || key.includes('abono')) columnMap.abona = index
    else if (key.includes('debe')) columnMap.debe = index
    else if (key.includes('negocio')) columnMap.negocio = index
  })

  const name = cleanText(nonEmptyRows[0][0]) || cleanText(sheetName)
  const transactions = []
  const issues = []

  for (const row of nonEmptyRows.slice(headerIndex + 1)) {
    const values = row.map((value) => (value === null || value === undefined ? null : typeof value === 'string' ? value.trim() : value))
    const detalleRaw = values[columnMap.detalle ?? 2] ?? values[2] ?? null
    const detalle = cleanText(detalleRaw)
    const rawAbona = values[columnMap.abona ?? 9] ?? values[9] ?? null
    const rawTotal = values[columnMap.total ?? 8] ?? values[8] ?? null
    const hasAbonoValue = number(rawAbona) > 0
    const isAbono = /abono/i.test(detalle) || /abono/i.test(cleanText(rawAbona)) || (hasAbonoValue && number(rawTotal) === 0 && number(values[columnMap.valor ?? 6] ?? values[6]) === 0 && number(values[columnMap.cantidad ?? 5] ?? values[5]) === 0)

    if (!detalle && !isAbono && values.every((value) => value === null || cleanText(value) === '')) continue

    const fechaValue = values[columnMap.fecha ?? 1] ?? values[1] ?? null
    const fecha = toIsoDate(fechaValue)
    const codigo = cleanText(values[columnMap.codigo ?? 0] ?? values[0])
    const cantidad = number(values[columnMap.cantidad ?? 5])
    const valor = number(values[columnMap.valor ?? 6])
    const descuento = number(values[columnMap.descuento ?? 7])
    const total = number(rawTotal ?? (isAbono ? 0 : null))
    const abona = number(rawAbona)
    const debe = number(values[columnMap.debe ?? 10])
    const negocio = cleanText(values[columnMap.negocio ?? 11]) || null

    const transaction = {
      fecha,
      codigo: codigo || null,
      detalle: detalle || (isAbono ? 'ABONO' : null),
      cantidad: cantidad || 0,
      valor: valor || 0,
      descuento: descuento || 0,
      total: total || 0,
      abona: abona || 0,
      debe: debe || 0,
      negocio,
      tipo: isAbono ? 'ABONO' : 'COMPRA',
    }

    if (!fecha && !isAbono && !codigo && !detalle) continue

    if (transaction.tipo === 'ABONO' && transaction.abona <= 0 && transaction.debe > 0) {
      issues.push({ fecha, detalle: transaction.detalle, issue: 'Abono sin valor registrado' })
    }
    if (transaction.tipo === 'COMPRA' && transaction.total <= 0 && transaction.valor > 0) {
      issues.push({ fecha, detalle: transaction.detalle, issue: 'Compra sin total calculado' })
    }
    transactions.push(transaction)
  }

  const totalCompras = transactions.filter((row) => row.tipo === 'COMPRA').reduce((sum, row) => sum + row.total, 0)
  const totalAbonos = transactions.filter((row) => row.tipo === 'ABONO').reduce((sum, row) => sum + row.abona, 0)
  const saldoPendiente = totalCompras - totalAbonos

  people.push({
    name,
    sheet: sheetName,
    transactions,
    totalCompras,
    totalAbonos,
    totalDescuentos: transactions.reduce((sum, row) => sum + row.descuento, 0),
    saldoPendiente,
    ultimoMovimiento: transactions.reduce((latest, row) => {
      if (!row.fecha) return latest
      return !latest || row.fecha > latest ? row.fecha : latest
    }, null),
    estado: saldoPendiente > 0 ? 'PENDIENTE' : 'AL_DIA',
    issues,
  })
}

const summary = {
  totalPersonas: people.length,
  totalCompras: people.reduce((sum, person) => sum + person.totalCompras, 0),
  totalAbonos: people.reduce((sum, person) => sum + person.totalAbonos, 0),
  totalDescuentos: people.reduce((sum, person) => sum + person.totalDescuentos, 0),
  carteraPendiente: people.reduce((sum, person) => sum + Math.max(0, person.saldoPendiente), 0),
  personasConSaldoPendiente: people.filter((person) => person.saldoPendiente > 0).length,
  personasAlDia: people.filter((person) => person.saldoPendiente <= 0).length,
  registros: people.reduce((sum, person) => sum + person.transactions.length, 0),
  inconsistencias: people.reduce((sum, person) => sum + person.issues.length, 0),
}

const payload = { generatedAt: new Date().toISOString(), summary, people }
fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2))
console.log(JSON.stringify(summary, null, 2))
