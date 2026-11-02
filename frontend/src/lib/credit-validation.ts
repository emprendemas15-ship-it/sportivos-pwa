import validationCreditDataRaw from '../data/validacion-creditos.json'

export type ValidationCreditTransaction = {
  fecha: string | null
  codigo: string | null
  detalle: string | null
  cantidad: number
  valor: number
  descuento: number
  total: number
  abona: number
  debe: number
  negocio: string | null
  tipo: 'COMPRA' | 'ABONO'
}

export type ValidationCreditPerson = {
  name: string
  sheet: string
  transactions: ValidationCreditTransaction[]
  totalCompras: number
  totalAbonos: number
  totalDescuentos: number
  saldoPendiente: number
  ultimoMovimiento: string | null
  estado: 'PENDIENTE' | 'AL_DIA'
  issues: Array<{ fecha: string | null; detalle: string | null; issue: string }>
}

export type ValidationCreditDataset = {
  generatedAt: string
  summary: {
    totalPersonas: number
    totalCompras: number
    totalAbonos: number
    totalDescuentos: number
    carteraPendiente: number
    personasConSaldoPendiente: number
    personasAlDia: number
    registros: number
    inconsistencias: number
  }
  people: ValidationCreditPerson[]
}

const validationCreditData = validationCreditDataRaw as ValidationCreditDataset

export const validationCreditPortfolio = validationCreditData.people

export function getValidationCreditSummary() {
  return validationCreditData.summary
}

export function getValidationCreditPeople(search: string = '') {
  const needle = search.trim().toLowerCase()
  if (!needle) return validationCreditPortfolio
  return validationCreditPortfolio.filter((person) => {
    const haystack = [person.name, person.sheet, person.transactions.map((row) => row.codigo ?? '').join(' ')].join(' ').toLowerCase()
    return haystack.includes(needle)
  })
}
