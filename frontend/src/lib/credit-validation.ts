import validationCreditDataRaw from '../data/validacion-creditos.json'

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

export type ValidationCreditDataset = {
  generatedAt: string
  sourceWorkbook?: string
  sourceAsOf?: string
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

const validationCreditData = validationCreditDataRaw as ValidationCreditDataset

export const validationCreditPortfolio = validationCreditData.people
export const validationCreditSourceWorkbook = validationCreditData.sourceWorkbook ?? 'CREDITOS.xlsm'
export const validationCreditSourceAsOf = Date.parse(validationCreditData.sourceAsOf ?? validationCreditData.generatedAt)

const clientIdentityKey = (value: string): string => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es')
const clientIdentityAliases = new Map<string, string>()
validationCreditPortfolio.forEach((person) => {
  const canonical = clientIdentityKey(person.sheet)
  clientIdentityAliases.set(clientIdentityKey(person.name), canonical)
  clientIdentityAliases.set(canonical, canonical)
  person.aliases?.forEach((alias) => clientIdentityAliases.set(clientIdentityKey(alias), canonical))
})

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

export function mergeValidationCreditMovements(
  movements: SavedValidationCreditMovement[],
  clientNames: string[] = [],
  deletedTransactions: ReadonlySet<string> = new Set(),
  includeImportedPortfolio = true,
): ValidationCreditPerson[] {
  const grouped = new Map<string, SavedValidationCreditMovement[]>()
  movements.forEach((movement) => {
    const key = normalizeClientIdentity(movement.person_sheet)
    const records = grouped.get(key) ?? []
    records.push(movement)
    grouped.set(key, records)
  })

  const peopleByIdentity = new Map<string, ValidationCreditPerson>()
  if (includeImportedPortfolio) {
    validationCreditPortfolio.forEach((person) => peopleByIdentity.set(normalizeClientIdentity(person.sheet), person))
  }
  clientNames.forEach((rawName) => {
    const name = rawName.trim()
    const identity = normalizeClientIdentity(name)
    if (!identity || peopleByIdentity.has(identity)) return
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
      .filter((_, index) => !deletedTransactions.has(sourceKeys[index]))
    const sourceDelta = sourcePerson.transactions.reduce((total, transaction) => total + (
      transaction.tipo === 'ABONO' ? -transaction.abona
        : transaction.tipo === 'DEVOLUCION' ? -transaction.total
          : transaction.total || transaction.valor
    ), 0)
    const openingBalance = sourcePerson.saldoPendiente - sourceDelta
    let sourceBalance = openingBalance
    const recalculatedSourceTransactions = sourcePerson.transactions.map((transaction, index) => ({ transaction, key: sourceKeys[index] }))
      .filter(({ key }) => !deletedTransactions.has(key))
      .map(({ transaction, key }) => {
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
  const aliases: Record<string, string> = {
    'yarmile amiga angela': 'yamirley amiga de angela vip',
    'yamirle amiga de angela': 'yamirley amiga de angela vip',
    'yamirley amiga angela vip': 'yamirley amiga de angela vip',
    'cristian esposo gimena': 'cristian esposo de gimena',
    'angy rionegro': 'angie rionegro',
    'carolina freiser': 'carolina frasser',
    'estefa jyg': 'estefania jyg',
    'johana madre comunitaria': 'jhoana m.comunitaria',
    'leydi pacifico': 'leidy pasifico',
    'liliana mama de kate': 'lilia mama de kate',
    'manuela amiga manuel': 'manuela amiga de manuel',
    'yuleth amiga de nery': 'yulet amiga nery',
    'yulet amiga de nery': 'yulet amiga nery',
    'karis inter ejecutiva': 'karis inter',
    'kate liam': 'kater mama liam',
    'raul hermano sandra': 'raul h sandra guzman',
  }
  const normalized = aliases[identity] ?? identity
  return clientIdentityAliases.get(normalized) ?? clientIdentityAliases.get(identity) ?? normalized
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
