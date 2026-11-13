import type { WorkbookRow } from './workbook'

export type ValidationCreditTransaction = {
  savedMovementId?: string
  sourceCreditId?: string
  sourceTransactionKey?: string
  fecha: string | null
  codigo: string | null
  detalle: string | null
  cantidad: number
  valor: number
  descuento: number
  total: number
  totalDerivado?: boolean
  abona: number
  debe: number
  tieneDebe: boolean
  negocio: string | null
  tipo: 'COMPRA' | 'ABONO' | 'DEVOLUCION'
}

export type ValidationCreditPerson = {
  name: string
  sheet: string
  aliases?: string[]
  transactions: ValidationCreditTransaction[]
  totalCompras: number
  totalAbonos: number
  totalDescuentos: number
  saldoPendiente: number
  ultimoMovimiento: string | null
  estado: 'PENDIENTE' | 'AL_DIA'
  issues: Array<{ fecha: string | null; detalle: string | null; issue: string }>
}

export type SavedValidationCreditMovement = {
  id: string
  request_id: string
  person_sheet: string
  movement_type: 'CREDITO' | 'ABONO' | 'DEVOLUCION'
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

const clientIdentityKey = (value: string): string => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es')
export const validationCreditClientAliases: Array<[string, string]> = [
  ['ANDRES MOMPOS', 'ANDRES MOMPOZ'],
  ['ANGIE SODEXO', 'ANGIE RIONEGRO'],
  ['BIBIANA MEMFIS', 'BIBIANA GALLETAS'],
  ['CLAUDIA CASTAÑO', 'CLAUDIA CASTAÑO'],
  ['DANY PAJARA', 'DANY DTK'],
  ['ESTEFANIA J Y G', 'ESTEFANIA JYG'],
  ['FABIO LEGUMBRERIA', 'FABIO LEGUMBRERIA'],
  ['DARIO SANMARTIN', 'DARIO SANMARTIN'],
  ['JOHANA MADRE COMUNITARIA', 'JHOANA M.COMUNITARIA'],
  ['KATERIN MAMA DE LIAM', 'KATER MAMA LIAM'],
  ['KAROL TRANSITO', 'KAROL'],
  ['KATE HERMANA MONICA', 'KATE H MONI'],
  ['LAURA MARTINEZ', 'LAURA PAYARES'],
  ['LEIDY PACIFICO', 'LEIDY PASIFICO'],
  ['LUISA VELAS', 'LUISA ASECOLI'],
  ['MANUELA AMIGA MANUEL', 'MANUELA AMIGA DE MANUEL'],
  ['MERCEDES BINGO', 'MERCEDES'],
  ['NERY VIP', 'NERY'],
  ['RAUL HERMANO DE SANDRA', 'RAUL H SANDRA GUZMAN'],
  ['SANDRA SANMARTIN', 'SANDRA SANMARTIN'],
  ['CRISTIAN ESPOSO GIMENA', 'CRISTIAN ESPOSO DE GIMENA'],
  ['VICTOR MANUEL BETANCUR', 'VICTOR MANUEL'],
  ['YAMIRLEY AMIGA ANGELA VIP', 'YAMIRLEY AMIGA DE ANGELA VIP'],
  ['YULET AMIGA DE NERY', 'YULET AMIGA NERY'],
  ['YULIANA DTK', 'YULIANA DTK FABRICA'],
  ['YARMILE AMIGA ANGELA', 'YAMIRLEY AMIGA DE ANGELA VIP'],
  ['YAMIRLE AMIGA DE ANGELA', 'YAMIRLEY AMIGA DE ANGELA VIP'],
  ['YAMIRLEY AMIGA ANGELA VIP', 'YAMIRLEY AMIGA DE ANGELA VIP'],
  ['CRISTIAN ESPOSO GIMENA', 'CRISTIAN ESPOSO DE GIMENA'],
  ['ANGY RIONEGRO', 'ANGIE RIONEGRO'],
  ['CAROLINA FREISER', 'CAROLINA FRASSER'],
  ['ESTEFA JYG', 'ESTEFANIA JYG'],
  ['LEYDI PACIFICO', 'LEIDY PASIFICO'],
  ['LEIDI PACIFICO', 'LEIDY PASIFICO'],
  ['LILIANA MAMA DE KATE', 'LILIA MAMA DE KATE'],
  ['MANUELA AMIGA MANUEL', 'MANUELA AMIGA DE MANUEL'],
  ['YULETH AMIGA DE NERY', 'YULET AMIGA NERY'],
  ['KARIS INTER EJECUTIVA', 'KARIS INTER'],
  ['KATE LIAM', 'KATER MAMA LIAM'],
  ['RAUL HERMANO SANDRA', 'RAUL H SANDRA GUZMAN'],
]
const clientIdentityAliases = new Map(validationCreditClientAliases.map(([alias, canonical]) => [
  clientIdentityKey(alias),
  clientIdentityKey(canonical),
]))

export function getValidationCreditSummary(people: ValidationCreditPerson[]) {
  return {
    totalPersonas: people.length,
    totalCompras: people.reduce((total, person) => total + person.totalCompras, 0),
    totalAbonos: people.reduce((total, person) => total + person.totalAbonos, 0),
    totalDescuentos: people.reduce((total, person) => total + person.totalDescuentos, 0),
    carteraPendiente: people.reduce((total, person) => total + Math.max(0, person.saldoPendiente), 0),
    personasConSaldoPendiente: people.filter((person) => person.saldoPendiente > 0).length,
    personasAlDia: people.filter((person) => person.saldoPendiente <= 0).length,
    registros: people.reduce((total, person) => total + person.transactions.length, 0),
    inconsistencias: people.reduce((total, person) => total + person.issues.length, 0),
  }
}

export function mergeValidationCreditMovements(
  movements: SavedValidationCreditMovement[],
  sourcePeople: ValidationCreditPerson[],
  deletedTransactions: ReadonlySet<string> = new Set(),
): ValidationCreditPerson[] {
  const grouped = new Map<string, SavedValidationCreditMovement[]>()
  movements.forEach((movement) => {
    const key = normalizeClientIdentity(movement.person_sheet)
    const records = grouped.get(key) ?? []
    records.push(movement)
    grouped.set(key, records)
  })

  const peopleByIdentity = new Map<string, ValidationCreditPerson>()
  sourcePeople.forEach((person) => peopleByIdentity.set(normalizeClientIdentity(person.sheet), person))
  grouped.forEach((records, identity) => {
    if (peopleByIdentity.has(identity) || records.length === 0) return
    const name = records[0].person_sheet
    peopleByIdentity.set(identity, {
      name,
      sheet: name,
      transactions: [],
      totalCompras: 0,
      totalAbonos: 0,
      totalDescuentos: 0,
      saldoPendiente: 0,
      ultimoMovimiento: null,
      estado: 'AL_DIA',
      issues: [],
    })
  })

  return [...peopleByIdentity.values()].map((sourcePerson) => {
    const sourceKeys = getValidationCreditTransactionKeys(sourcePerson.sheet, sourcePerson.transactions)
    const sourceTransactions = sourcePerson.transactions
      .filter((transaction, index) => Boolean(transaction.sourceCreditId) || !deletedTransactions.has(sourceKeys[index]))
    const sourceDelta = sourcePerson.transactions.reduce((total, transaction) => total + (
      transaction.tipo === 'ABONO' ? -transaction.abona
        : transaction.tipo === 'DEVOLUCION' ? -transaction.total
          : transaction.total || transaction.valor
    ), 0)
    const openingBalance = sourcePerson.saldoPendiente - sourceDelta
    let sourceBalance = openingBalance
    const recalculatedSourceTransactions = sourcePerson.transactions.map((transaction, index) => ({ transaction, key: sourceKeys[index] }))
      .filter(({ transaction, key }) => Boolean(transaction.sourceCreditId) || !deletedTransactions.has(key))
      .map(({ transaction, key }) => {
      if (transaction.sourceCreditId) {
        sourceBalance = transaction.debe
        return { ...transaction, sourceTransactionKey: key }
      }
      sourceBalance += transaction.tipo === 'ABONO' ? -transaction.abona
        : transaction.tipo === 'DEVOLUCION' ? -transaction.total
          : transaction.total || transaction.valor
      return { ...transaction, sourceTransactionKey: key, debe: sourceBalance, tieneDebe: true }
    })
    const person: ValidationCreditPerson = {
      ...sourcePerson,
      transactions: recalculatedSourceTransactions,
      totalCompras: sourceTransactions.reduce((total, transaction) => total + (transaction.tipo === 'COMPRA' ? transaction.total || transaction.valor : 0), 0),
      totalAbonos: sourceTransactions.reduce((total, transaction) => total + transaction.abona, 0),
      totalDescuentos: sourceTransactions.reduce((total, transaction) => total + transaction.descuento, 0),
      saldoPendiente: sourceBalance,
      ultimoMovimiento: sourceTransactions.reduce<string | null>((latest, transaction) => transaction.fecha && (!latest || transaction.fecha > latest) ? transaction.fecha : latest, null),
      estado: sourceBalance > 0 ? 'PENDIENTE' : 'AL_DIA',
    }
    const baselineTransactionCounts = new Map<string, number>()
    person.transactions.forEach((transaction) => {
      const key = validationTransactionKey(transaction)
      baselineTransactionCounts.set(key, (baselineTransactionCounts.get(key) ?? 0) + 1)
    })
    const additions = (grouped.get(normalizeClientIdentity(person.sheet)) ?? [])
      .slice()
      .sort((a, b) => a.movement_date.localeCompare(b.movement_date) || a.created_at.localeCompare(b.created_at))
      .filter((movement) => {
        const key = savedMovementKey(movement)
        const matchedBaselineRows = baselineTransactionCounts.get(key) ?? 0
        if (matchedBaselineRows) {
          baselineTransactionCounts.set(key, matchedBaselineRows - 1)
          return false
        }
        return true
      })
    const recordedBalance = [...person.transactions].reverse().find((transaction) => transaction.tieneDebe)?.debe
    let runningBalance = recordedBalance ?? person.saldoPendiente
    const addedPurchases = additions.filter((movement) => movement.movement_type === 'CREDITO').reduce((total, movement) => total + movement.total, 0)
    const addedPayments = additions.filter((movement) => movement.movement_type === 'ABONO').reduce((total, movement) => total + movement.payment_amount, 0)
    const addedDiscounts = additions.filter((movement) => movement.movement_type === 'CREDITO')
      .reduce((total, movement) => total + movement.discount, 0)
    const addedTransactions: ValidationCreditTransaction[] = additions.map((movement) => {
      const isPayment = movement.movement_type === 'ABONO'
      const isReturn = movement.movement_type === 'DEVOLUCION'
      runningBalance += isPayment ? -movement.payment_amount : isReturn ? -movement.total : movement.total
      return {
        ...(movement.id.startsWith('credit:') ? { sourceCreditId: movement.id.slice('credit:'.length) } : { savedMovementId: movement.id }),
        fecha: movement.movement_date,
        codigo: movement.code,
        detalle: movement.detail,
        cantidad: movement.quantity,
        valor: movement.unit_value,
        descuento: movement.discount,
        total: movement.total,
        abona: movement.payment_amount,
        debe: runningBalance,
        tieneDebe: true,
        negocio: movement.business,
        tipo: isPayment ? 'ABONO' : isReturn ? 'DEVOLUCION' : 'COMPRA',
      }
    })
    const latestAddition = additions.reduce<string | null>((latest, movement) => {
      return !latest || movement.movement_date > latest ? movement.movement_date : latest
    }, null)
    const ultimoMovimiento = latestAddition && (!person.ultimoMovimiento || latestAddition > person.ultimoMovimiento)
      ? latestAddition
      : person.ultimoMovimiento
    const saldoPendiente = runningBalance

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

export function getCreditHistoryPeople(rows: WorkbookRow[]): ValidationCreditPerson[] {
  const peopleByIdentity = new Map<string, ValidationCreditPerson>()
  rows.forEach((row) => {
    const name = String(row.NOMBRE ?? '').trim()
    const type = getCreditHistoryType(row.TIPO)
    if (!name || !type) return
    const identity = normalizeClientIdentity(name)
    const person: ValidationCreditPerson = peopleByIdentity.get(identity) ?? {
      name,
      sheet: name,
      transactions: [],
      totalCompras: 0,
      totalAbonos: 0,
      totalDescuentos: 0,
      saldoPendiente: 0,
      ultimoMovimiento: null,
      estado: 'AL_DIA',
      issues: [],
    }
    const amount = finiteNumber(row.VALOR)
    const payment = type === 'ABONO' ? amount : 0
    const total = type === 'COMPRA' || type === 'DEVOLUCION' ? amount : 0
    const movementDelta = type === 'ABONO' ? -payment : type === 'DEVOLUCION' ? -total : total
    const recordedDebt = row.DEUDA !== null && row.DEUDA !== undefined && row.DEUDA !== ''
      ? Number(row.DEUDA)
      : Number.NaN
    const previousDebt = person.transactions[person.transactions.length - 1]?.debe ?? person.saldoPendiente
    const balance = Number.isFinite(recordedDebt) ? recordedDebt : previousDebt + movementDelta
    const date = String(row.FECHA ?? '').slice(0, 10) || null
    const transaction: ValidationCreditTransaction = {
      sourceCreditId: String(row.id ?? `${identity}:${person.transactions.length}`),
      fecha: date,
      codigo: stringValue(row.CODIGO),
      detalle: stringValue(row.DETALLE),
      cantidad: finiteNumber(row.CANT),
      valor: finiteNumber(row.PRECIO),
      descuento: finiteNumber(row.DESCUENTO),
      total,
      abona: payment,
      debe: balance,
      tieneDebe: true,
      negocio: stringValue(row.NEGOCIO),
      tipo: type,
    }
    person.transactions.push(transaction)
    person.saldoPendiente = balance
    if (type === 'COMPRA') person.totalCompras += total
    if (type === 'ABONO') person.totalAbonos += payment
    person.totalDescuentos += transaction.descuento
    if (date && (!person.ultimoMovimiento || date > person.ultimoMovimiento)) person.ultimoMovimiento = date
    person.estado = balance > 0 ? 'PENDIENTE' : 'AL_DIA'
    peopleByIdentity.set(identity, person)
  })
  return [...peopleByIdentity.values()]
}

export function getValidationCreditTransactionKeys(personSheet: string, transactions: ValidationCreditTransaction[]): string[] {
  const occurrenceCounts = new Map<string, number>()
  return transactions.map((transaction) => {
    const baseKey = JSON.stringify([
      normalizeClientIdentity(personSheet), transaction.fecha ?? '', transaction.tipo,
      normalizeClientIdentity(transaction.codigo ?? ''), normalizeClientIdentity(transaction.detalle ?? ''),
      Number(transaction.cantidad ?? 0), Number(transaction.valor ?? 0), Number(transaction.descuento ?? 0),
      Number(transaction.total ?? 0), Number(transaction.abona ?? 0), normalizeClientIdentity(transaction.negocio ?? ''),
    ])
    const occurrence = occurrenceCounts.get(baseKey) ?? 0
    occurrenceCounts.set(baseKey, occurrence + 1)
    return `${baseKey}#${occurrence}`
  })
}

function normalizeClientIdentity(value: string): string {
  const identity = clientIdentityKey(value)
  return clientIdentityAliases.get(identity) ?? identity
}

function validationTransactionKey(transaction: ValidationCreditTransaction): string {
  return [
    transaction.fecha ?? '', transaction.tipo, normalizeClientIdentity(transaction.codigo ?? ''),
    Number(transaction.cantidad ?? 0), Number(transaction.valor ?? 0), Number(transaction.descuento ?? 0),
    Number(transaction.total ?? 0), Number(transaction.abona ?? 0),
  ].join('|')
}

function savedMovementKey(movement: SavedValidationCreditMovement): string {
  return [
    movement.movement_date.slice(0, 10), movement.movement_type === 'ABONO' ? 'ABONO' : 'COMPRA',
    normalizeClientIdentity(movement.code ?? ''), Number(movement.quantity ?? 0), Number(movement.unit_value ?? 0),
    Number(movement.discount ?? 0), Number(movement.total ?? 0), Number(movement.payment_amount ?? 0),
  ].join('|')
}

function getCreditHistoryType(value: unknown): ValidationCreditTransaction['tipo'] | null {
  const type = normalizeClientIdentity(String(value ?? ''))
  if (type === 'abono') return 'ABONO'
  if (type === 'devolucion') return 'DEVOLUCION'
  if (type === 'credito') return 'COMPRA'
  return null
}

function finiteNumber(value: unknown): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function stringValue(value: unknown): string | null {
  const text = String(value ?? '').trim()
  return text || null
}
