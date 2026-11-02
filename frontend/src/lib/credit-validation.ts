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
  tieneDebe: boolean
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

export type SavedValidationCreditMovement = {
  id: string
  request_id: string
  person_sheet: string
  movement_type: 'CREDITO' | 'ABONO'
  movement_date: string
  code: string | null
  detail: string | null
  quantity: number
  unit_value: number
  discount: number
  total: number
  payment_amount: number
  balance_after: number
  business: string
  created_at: string
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

export function mergeValidationCreditMovements(movements: SavedValidationCreditMovement[]): ValidationCreditPerson[] {
  const grouped = new Map<string, SavedValidationCreditMovement[]>()
  movements.forEach((movement) => {
    const records = grouped.get(movement.person_sheet) ?? []
    records.push(movement)
    grouped.set(movement.person_sheet, records)
  })

  return validationCreditPortfolio.map((person) => {
    const additions = (grouped.get(person.sheet) ?? []).slice().sort((a, b) => a.created_at.localeCompare(b.created_at))
    const addedPurchases = additions.filter((movement) => movement.movement_type === 'CREDITO').reduce((total, movement) => total + movement.total, 0)
    const addedPayments = additions.filter((movement) => movement.movement_type === 'ABONO').reduce((total, movement) => total + movement.payment_amount, 0)
    const addedDiscounts = additions.reduce((total, movement) => total + movement.discount, 0)
    const addedTransactions: ValidationCreditTransaction[] = additions.map((movement) => ({
      fecha: movement.movement_date,
      codigo: movement.code,
      detalle: movement.detail,
      cantidad: movement.quantity,
      valor: movement.unit_value,
      descuento: movement.discount,
      total: movement.total,
      abona: movement.payment_amount,
      debe: movement.balance_after,
      tieneDebe: true,
      negocio: movement.business,
      tipo: movement.movement_type === 'ABONO' ? 'ABONO' : 'COMPRA',
    }))
    const latestAddition = additions.reduce<string | null>((latest, movement) => {
      return !latest || movement.movement_date > latest ? movement.movement_date : latest
    }, null)
    const ultimoMovimiento = latestAddition && (!person.ultimoMovimiento || latestAddition > person.ultimoMovimiento)
      ? latestAddition
      : person.ultimoMovimiento
    const recordedBalance = [...person.transactions].reverse().find((transaction) => transaction.tieneDebe)?.debe
    const openingBalance = recordedBalance ?? person.saldoPendiente
    const saldoPendiente = openingBalance + addedPurchases - addedPayments

    return {
      ...person,
      transactions: [...person.transactions, ...addedTransactions],
      totalCompras: person.totalCompras + addedPurchases,
      totalAbonos: person.totalAbonos + addedPayments,
      totalDescuentos: person.totalDescuentos + addedDiscounts,
      saldoPendiente,
      ultimoMovimiento,
      estado: saldoPendiente > 0 ? 'PENDIENTE' : 'AL_DIA',
    }
  })
}
