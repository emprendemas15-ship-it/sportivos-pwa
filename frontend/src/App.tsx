import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import './App.css'
import { calculateInventoryProfit, cleanExcelError, monthName, moduleColumns, type CellValue, type Column, type ModuleKey, type WorkbookRow } from './lib/workbook'
import { hasSupabaseConfig, supabase } from './lib/supabase'
import { getValidationCreditSummary, mergeValidationCreditMovements, validationCreditPortfolio, validationCreditSourceAsOf, validationCreditSourceWorkbook, type SavedValidationCreditMovement, type ValidationCreditPerson, type ValidationCreditTransaction } from './lib/credit-validation'

const currency = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
const number = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 })
const CREDIT_TYPE = 'Cr\u00e9dito'
const menuItems: Array<{ key: ModuleKey | 'MENU'; label: string; group: string; icon: string }> = [
  { key: 'MENU', label: 'MENU', group: 'PRINCIPAL', icon: 'M' },
  { key: 'INVENTARIO_PT', label: 'INVENTARIO_PT', group: 'INVENTARIOS', icon: 'PT' },
  { key: 'ENTRADAS', label: 'ENTRADAS', group: 'MOVIMIENTOS', icon: '+' },
  { key: 'VENTAS', label: 'VENTAS', group: 'MOVIMIENTOS', icon: 'V' },
  { key: 'GASTOS', label: 'GASTOS', group: 'MOVIMIENTOS', icon: '-' },
  { key: 'CREDITOS', label: 'CREDITOS', group: 'CARTERA', icon: '$' },
  { key: 'VALIDACION_CREDITOS', label: 'VALIDACION CREDITOS', group: 'CARTERA', icon: 'VC' },
  { key: 'CLIENTES', label: 'CLIENTES', group: 'CARTERA', icon: 'C' },
  { key: 'COSTOS_NO_PRODUCIDOS', label: 'COSTOS_NO_PRODUCIDOS', group: 'COSTOS', icon: 'NP' },
  { key: 'BALANCE', label: 'BALANCE', group: 'REPORTES', icon: 'B' },
]
const editableModules = new Set<ModuleKey>(['INVENTARIO_PT', 'ENTRADAS', 'VENTAS', 'GASTOS', 'CREDITOS', 'CLIENTES', 'COSTOS_NO_PRODUCIDOS'])
const remoteTableByModule: Partial<Record<ModuleKey, string>> = {
  INVENTARIO_PT: 'inventario_pt', ENTRADAS: 'entradas', VENTAS: 'ventas', GASTOS: 'gastos', CREDITOS: 'creditos', CLIENTES: 'clientes', COSTOS_NO_PRODUCIDOS: 'costos_no_producidos',
}
type SyncState = 'syncing' | 'synced' | 'error'
type PhysicalInventoryCount = { id: string; code: string; quantity: number; countedAt: string; note: string | null }
type RemoteSnapshot = { data: Record<ModuleKey, WorkbookRow[]>; physicalCounts: PhysicalInventoryCount[]; physicalCountsError: string }
type CreditFilters = { name: string; product: string; type: string; from: string; to: string }
type ValidationCreditFormValues = {
  requestId: string
  personSheet: string
  type: 'CREDITO' | 'ABONO'
  date: string
  code: string
  detail: string
  quantity: string
  unitValue: string
  discount: string
  paymentAmount: string
  business: string
  businessDetail: string
}
type HiddenClientRecord = {
  client_identity: string
  client_name: string
  hidden_from_clients: boolean
  hidden_from_validation: boolean
  updated_at: string
}
type DeletedValidationHistoryRecord = { client_identity: string; transaction_key: string; adjust_stock: boolean }

const validationCreditTable = 'validacion_creditos_movimientos'
const hiddenClientTable = 'sportivos_clientes_eliminados'
const deletedValidationHistoryTable = 'validacion_creditos_registros_eliminados'
const validationCreditBusinesses = ['COLIPETS', 'OTRO', 'SPORTIVOS']
const validationCreditClientSheets = new Map(validationCreditPortfolio.flatMap((person) => [person.name, person.sheet].map((name) => [normalizeClientName(name), person.sheet] as const)))
const renamedValidationCreditClient = validationCreditPortfolio.find((person) => normalizeClientName(person.sheet) === normalizeClientName('YAMIRLEY AMIGA DE ANGELA VIP'))
if (renamedValidationCreditClient) {
  for (const alias of ['YARMILE AMIGA ANGELA', 'YAMIRLE AMIGA DE ANGELA', 'YAMIRLEY AMIGA ANGELA VIP']) {
    validationCreditClientSheets.set(normalizeClientName(alias), renamedValidationCreditClient.sheet)
  }
}
const validationCreditClientAliases = [
  ['CRISTIAN ESPOSO GIMENA', 'CRISTIAN ESPOSO DE GIMENA'],
  ['ANGY RIONEGRO', 'ANGIE RIONEGRO'],
  ['CAROLINA FREISER', 'CAROLINA FRASSER'],
  ['ESTEFA JYG', 'ESTEFANIA JYG'],
  ['JOHANA MADRE COMUNITARIA', 'JHOANA M.COMUNITARIA'],
  ['LEYDI PACIFICO', 'LEIDY PASIFICO'],
  ['LILIANA MAMA DE KATE', 'LILIA MAMA DE KATE'],
  ['MANUELA AMIGA MANUEL', 'MANUELA AMIGA DE MANUEL'],
  ['YULETH AMIGA DE NERY', 'YULET AMIGA NERY'],
  ['YULET AMIGA DE NERY', 'YULET AMIGA NERY'],
]
validationCreditClientAliases.forEach(([alias, canonical]) => {
  const person = validationCreditPortfolio.find((candidate) => normalizeClientName(candidate.sheet) === normalizeClientName(canonical))
  if (person) validationCreditClientSheets.set(normalizeClientName(alias), person.sheet)
})
// The original CREDITOS import completed on Nov 4. New spreadsheet balances replace it;
// only later live rows absent from that spreadsheet are added to each client balance.
const importedCreditHistoryCutoff = Date.parse('2026-11-05T00:00:00.000Z')
const validationCreditOpeningBalances = new Map(validationCreditPortfolio.map((person) => [normalizeClientName(person.sheet), person.saldoPendiente]))
const localDateInputValue = () => {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

const datedOperationalModules = new Set<ModuleKey>(['ENTRADAS', 'VENTAS', 'GASTOS', 'CREDITOS'])

type PeriodPolicy = {
  month: number
  year: number
  firstDate: string
  today: string
  previousMonth: number
  previousYear: number
  balancesLoaded: boolean
  previousBalanceClosed: boolean
  canRegister: boolean
  message: string
}

function currentPeriod(): { month: number; year: number; firstDate: string; today: string } {
  const now = new Date()
  const today = localDateInputValue()
  return {
    month: now.getMonth() + 1,
    year: now.getFullYear(),
    firstDate: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`,
    today,
  }
}

function previousPeriod(month: number, year: number): { month: number; year: number } {
  return month === 1 ? { month: 12, year: year - 1 } : { month: month - 1, year }
}

function buildPeriodPolicy(history: MonthlyBalance[], balancesLoaded: boolean, data: Record<ModuleKey, WorkbookRow[]>): PeriodPolicy {
  const current = currentPeriod()
  const previous = previousPeriod(current.month, current.year)
  const previousBalanceClosed = history.some((item) => item.month === previous.month && item.year === previous.year)
  const previousHasMovements = [...data.ENTRADAS, ...data.VENTAS, ...data.GASTOS, ...data.CREDITOS]
    .some((row) => matchesPeriod(row, previous.month, previous.year))
  const requiresPreviousClose = previousHasMovements || history.length > 0
  const canRegister = balancesLoaded && (!requiresPreviousClose || previousBalanceClosed)
  const message = !balancesLoaded
    ? 'Espera a que se verifique el estado del balance mensual.'
    : !previousBalanceClosed && requiresPreviousClose
      ? `No puedes registrar movimientos de ${monthLabels[current.month - 1]} ${current.year} hasta guardar el balance de ${monthLabels[previous.month - 1]} ${previous.year}.`
      : ''
  return { ...current, previousMonth: previous.month, previousYear: previous.year, balancesLoaded, previousBalanceClosed, canRegister, message }
}

function dateInputValue(value: CellValue | undefined): string {
  const raw = String(value ?? '').trim()
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (iso) return `${iso[1]}-${String(Number(iso[2])).padStart(2, '0')}-${String(Number(iso[3])).padStart(2, '0')}`
  const timestamp = rowDateValue(value ?? null)
  if (!timestamp) return ''
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function validateOperationalDate(value: CellValue | undefined, policy: PeriodPolicy): string {
  const date = dateInputValue(value)
  if (!date) return 'La fecha es obligatoria y debe ser válida.'
  if (date < policy.firstDate || date > policy.today) {
    return `La fecha debe estar entre ${policy.firstDate} y ${policy.today}, dentro del mes en curso.`
  }
  if (!policy.canRegister) return policy.message
  return ''
}

function App() {
  const { data, physicalCounts, physicalCountsError, syncState, syncError, writeBlocked, refreshAll, markWriteFailure, markWriteSuccess } = useWorkbookSync()
  const { balances: balanceHistory, loaded: balancesLoaded } = useSavedBalances()
  const periodPolicy = useMemo(() => buildPeriodPolicy(balanceHistory, balancesLoaded, data), [balanceHistory, balancesLoaded, data])
  const [active, setActive] = useState<ModuleKey | 'MENU'>('MENU')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [creditFilters, setCreditFilters] = useState<CreditFilters>({ name: '', product: '', type: '', from: '', to: '' })
  const [showForm, setShowForm] = useState(false)
  const [notice, setNotice] = useState('')
  const [deletingRecord, setDeletingRecord] = useState<string | null>(null)
  const [stockDeleteCandidate, setStockDeleteCandidate] = useState<WorkbookRow | null>(null)
  const [showPhysicalCount, setShowPhysicalCount] = useState(false)
  const [hiddenClientRecords, setHiddenClientRecords] = useState<HiddenClientRecord[]>([])
  const [hiddenClientRecordsError, setHiddenClientRecordsError] = useState('')
  const [deletedHistoryRecords, setDeletedHistoryRecords] = useState<DeletedValidationHistoryRecord[]>([])
  const [deletedHistoryError, setDeletedHistoryError] = useState('')

  const refreshHiddenClientRecords = useCallback(async () => {
    if (!supabase) return
    const result = await readHiddenClientRecords(supabase)
    if (result.error) throw result.error
    setHiddenClientRecords(result.data)
    setHiddenClientRecordsError('')
  }, [])

  useEffect(() => {
    let active = true
    const refresh = async () => {
      try {
        if (!supabase) return
        const result = await readHiddenClientRecords(supabase)
        if (!active) return
        if (result.error) throw result.error
        setHiddenClientRecords(result.data)
        setHiddenClientRecordsError('')
      } catch (error) {
        if (active) setHiddenClientRecordsError(error instanceof Error ? error.message : 'No se pudieron cargar los controles de eliminación.')
      }
    }
    void refresh()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 60_000)
    window.addEventListener('focus', refresh)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  useEffect(() => {
    let active = true
    const refresh = async () => {
      if (!supabase) return
      const result = await readAllDeletedValidationHistoryRecords(supabase)
      if (!active) return
      if (result.error) {
        setDeletedHistoryError('Para borrar movimientos importados ejecuta la migración supabase/migrations/20261110140000_validacion_creditos_borrado_historial.sql. ' + result.error.message)
        return
      }
      setDeletedHistoryError('')
      setDeletedHistoryRecords(result.data)
    }
    void refresh()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 60_000)
    window.addEventListener('focus', refresh)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  const deletedHistoryKeys = useMemo(() => new Set(deletedHistoryRecords.map((record) => record.transaction_key)), [deletedHistoryRecords])
  const rows = useMemo(() => {
    let currentRows = getRows(active, data, physicalCounts, deletedHistoryKeys)
    if (active === 'CLIENTES') {
      const hidden = new Set(hiddenClientRecords.filter((record) => record.hidden_from_clients).map((record) => record.client_identity))
      currentRows = currentRows.filter((row) => !hidden.has(normalizeClientName(row.NOMBRE)))
      return currentRows.sort((a, b) => compareClientNames(a.NOMBRE, b.NOMBRE))
    }
    if (active === 'MENU' || active === 'BALANCE' || active === 'CREDITOS') return currentRows
    return [...currentRows].sort((a, b) => rowCreatedAtValue(b) - rowCreatedAtValue(a))
  }, [active, data, physicalCounts, hiddenClientRecords, deletedHistoryKeys])
  const filteredRows = useMemo(() => {
    if (active === 'CREDITOS') return filterCreditRows(rows, creditFilters)
    const needle = search.trim().toLowerCase()
    return needle ? rows.filter((row) => Object.values(row).some((value) => String(value ?? '').toLowerCase().includes(needle))) : rows
  }, [active, rows, search, creditFilters])

  const flashNotice = useCallback((message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 2800)
  }, [])

  useEffect(() => {
    const handleNotice = (event: Event) => {
      if (event instanceof CustomEvent && typeof event.detail === 'string') flashNotice(event.detail)
    }
    window.addEventListener('sportivos:notice', handleNotice)
    return () => window.removeEventListener('sportivos:notice', handleNotice)
  }, [flashNotice])

  function navigate(next: ModuleKey | 'MENU') {
    setActive(next)
    setSidebarOpen(false)
    setSearch('')
    setShowForm(false)
  }

  async function saveRow(row: WorkbookRow) {
    if (active === 'MENU' || active === 'BALANCE') return
    if (active === 'INVENTARIO_PT') {
      const identityError = validateProductIdentity(row, data.INVENTARIO_PT)
      if (identityError) {
        flashNotice('No se guardó: ' + identityError)
        return
      }
    }
    if (syncState !== 'synced') {
      flashNotice('No se guardó: espera a que aparezca la conexión con la base compartida.')
      return
    }
    const normalized = normalizeRow(active, row, data)
    if (datedOperationalModules.has(active)) {
      const dateError = validateOperationalDate(normalized.FECHA, periodPolicy)
      if (dateError) {
        flashNotice(dateError)
        return
      }
    }
    if (!supabase) {
      flashNotice('No se guardó: falta conexión con la base compartida. Conéctate y vuelve a intentar.')
      return
    }
    const client = supabase as any
    const table = remoteTableByModule[active]
    if (!table) return
    try {
      const result = await client.from(table).insert(toRemoteRow(active, normalized))
      if (result.error) throw new Error(result.error.message)
      if (active === 'CLIENTES') {
        const hidden = hiddenClientRecords.find((record) => record.client_identity === normalizeClientName(normalized.NOMBRE))
        if (hidden && (hidden.hidden_from_clients || hidden.hidden_from_validation)) {
          await saveHiddenClientFlags(String(normalized.NOMBRE ?? ''), { hidden_from_clients: false, hidden_from_validation: false })
        }
      }
      markWriteSuccess()
      setShowForm(false)
      flashNotice('Registro guardado en ' + active + '. Actualizando los datos...')
      void refreshAll(false, true).then((refreshed) => {
        flashNotice(refreshed
          ? 'Registro guardado en ' + active + ' y sincronizado.'
          : 'Registro guardado en ' + active + ', pero no se pudieron actualizar los datos.')
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido'
      markWriteFailure('La base está en línea, pero no se pudo guardar el registro. ' + message)
      flashNotice('No se pudo guardar: ' + message)
    }
  }

  async function savePhysicalCounts(values: Array<{ code: string; quantity: number; note: string }>): Promise<boolean> {
    if (!values.length) {
      flashNotice('Escribe al menos una cantidad contada antes de guardar.')
      return false
    }
    if (syncState !== 'synced' || !supabase) {
      flashNotice('No se guardó: espera a que aparezca la conexión con la base compartida.')
      return false
    }
    try {
      const result = await (supabase as any).rpc('add_inventory_pt_counts', {
        p_items: values.map((value) => ({ codigo: value.code, cantidad: value.quantity })),
      })
      if (result.error) throw new Error(result.error.message)
      markWriteSuccess()
      flashNotice('Conteo físico guardado. Actualizando existencias...')
      void refreshAll(false, true).then((refreshed) => {
        flashNotice(refreshed
          ? 'Conteo físico guardado. No se creó una entrada/salida ni se modificó el balance.'
          : 'Conteo guardado, pero no se pudieron actualizar las existencias. Pulsa Actualizar.')
      })
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido'
      const setupHint = message.toLowerCase().includes('does not exist') || message.toLowerCase().includes('function')
        ? ' Ejecuta la migración supabase/migrations/20261107120000_stock_persistente_producto_terminado.sql en Supabase.'
        : ''
      markWriteFailure('No se pudo guardar el conteo físico. ' + message + setupHint)
      flashNotice('No se pudo guardar el conteo físico. ' + message + setupHint)
      return false
    }
  }

  async function deleteRow(module: ModuleKey, row: WorkbookRow, adjustStock?: boolean) {
    const table = remoteTableByModule[module]
    if (!editableModules.has(module) || !table) return
    if (syncState !== 'synced') {
      flashNotice('No se eliminó: espera a que aparezca la conexión con la base compartida.')
      return
    }
    if (!supabase) {
      flashNotice('No se eliminó: falta conexión con la base compartida.')
      return
    }
    if (row.id === null || row.id === undefined || row.id === '') {
      flashNotice('No se eliminó: el registro no tiene un identificador de la base compartida.')
      return
    }
    const recordKey = `${module}:${row.id}`
    if (deletingRecord) return
    const hasStockEffect = module === 'CREDITOS' && Boolean(String(row.CODIGO ?? '').trim()) && Number(row.CANT ?? row.CANTIDAD ?? 0) > 0 && !isAbonoType(row.TIPO)
    if (hasStockEffect && adjustStock === undefined) {
      setStockDeleteCandidate(row)
      return
    }
    const description = [
      row.FECHA ? `Fecha: ${String(row.FECHA)}` : '',
      row.NOMBRE ? `Cliente: ${String(row.NOMBRE)}` : '',
      row.TIPO ? `Tipo: ${String(row.TIPO)}` : '',
      row.CODIGO ? `Código: ${String(row.CODIGO)}` : '',
      row.DETALLE ? `Detalle: ${String(row.DETALLE)}` : '',
      row.VALOR !== null && row.VALOR !== undefined ? `Valor: ${currency.format(Number(row.VALOR))}` : '',
    ].filter(Boolean).join('\n')
    if (adjustStock === undefined && !window.confirm(`¿Eliminar este registro de ${module}?\n\n${description}\n\nSe recalcularán los saldos derivados. Los balances guardados son cierres históricos; si este cambio los afecta, vuelve a generar y guardar el periodo. Esta acción no se puede deshacer.`)) return

    setDeletingRecord(recordKey)
    try {
      const client = supabase as any
      if (module === 'CREDITOS' && hasStockEffect) {
        const result = await client.rpc('delete_credit_movement', { p_id: String(row.id), p_adjust_stock: adjustStock })
        if (result.error) throw new Error(result.error.message)
      } else {
        const result = await client.from(table).delete().eq('id', row.id).select('id')
        if (result.error) throw new Error(result.error.message)
        if (result.data?.length !== 1) throw new Error('No se encontró el registro para eliminarlo.')
      }
      markWriteSuccess()
      const refreshed = await refreshAll(true)
      flashNotice(refreshed ? `Registro eliminado de ${module}; datos y cálculos actualizados.` : `Registro eliminado de ${module}, pero no se pudieron actualizar los datos. Pulsa Actualizar.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido'
      const setupHint = module === 'CREDITOS' && (message.toLowerCase().includes('function') || message.toLowerCase().includes('schema cache'))
        ? ' Ejecuta supabase/migrations/20261110130000_creditos_borrado_con_ajuste_stock.sql en Supabase y vuelve a intentar.'
        : ''
      markWriteFailure('La base está en línea, pero no se pudo eliminar el registro. ' + message + setupHint)
      flashNotice('No se pudo eliminar: ' + message + setupHint)
    } finally {
      setDeletingRecord(null)
    }
  }

  async function saveHiddenClientFlags(name: string, updates: Partial<Pick<HiddenClientRecord, 'hidden_from_clients' | 'hidden_from_validation'>>) {
    if (!supabase) throw new Error('No hay conexión con Supabase.')
    const identity = normalizeClientName(name)
    const existing = hiddenClientRecords.find((record) => record.client_identity === identity)
    const payload = {
      client_identity: identity,
      client_name: name.trim(),
      hidden_from_clients: updates.hidden_from_clients ?? existing?.hidden_from_clients ?? false,
      hidden_from_validation: updates.hidden_from_validation ?? existing?.hidden_from_validation ?? false,
      updated_at: new Date().toISOString(),
    }
    const result = await supabase.from(hiddenClientTable).upsert(payload, { onConflict: 'client_identity' }).select('*').single()
    if (result.error) throw new Error(result.error.message)
    setHiddenClientRecords((current) => [...current.filter((record) => record.client_identity !== identity), result.data as HiddenClientRecord])
  }

  async function deleteClient(row: WorkbookRow) {
    const name = String(row.NOMBRE ?? '').trim()
    if (!name || !supabase || syncState !== 'synced') {
      flashNotice('No se eliminó el cliente: espera a que conecte con la base compartida.')
      return
    }
    if (!window.confirm(`¿Eliminar ${name} de CLIENTES?\n\nSe ocultará de la lista de clientes y de los formularios. Sus movimientos en CREDITOS se conservarán.`)) return
    const recordKey = `CLIENTES:${row.id ?? normalizeClientName(name)}`
    if (deletingRecord) return
    setDeletingRecord(recordKey)
    let hiddenSaved = false
    try {
      await saveHiddenClientFlags(name, { hidden_from_clients: true })
      hiddenSaved = true
      if (row.id !== null && row.id !== undefined && row.id !== '') {
        const result = await supabase.from('clientes').delete().eq('id', row.id).select('id')
        if (result.error) throw new Error(result.error.message)
        if (result.data?.length !== 1) throw new Error('No se encontró el registro del cliente.')
      }
      await refreshHiddenClientRecords()
      markWriteSuccess()
      await refreshAll(true)
      flashNotice(`Cliente ${name} eliminado de la lista.`)
    } catch (error) {
      if (hiddenSaved) await saveHiddenClientFlags(name, { hidden_from_clients: false }).catch(() => undefined)
      const message = error instanceof Error ? error.message : 'Error desconocido.'
      markWriteFailure('No se pudo eliminar el cliente. ' + message)
      flashNotice('No se pudo eliminar el cliente. Ejecuta la migración de eliminaciones si la tabla no existe. ' + message)
    } finally {
      setDeletingRecord(null)
    }
  }

  async function deleteValidationPerson(person: ValidationCreditPerson) {
    if (!supabase || syncState !== 'synced') throw new Error('Espera a que conecte con la base compartida.')
    await saveHiddenClientFlags(person.sheet, { hidden_from_validation: true })
    try {
      const result = await supabase.from(validationCreditTable).delete().eq('person_sheet', person.sheet).select('id')
      if (result.error) throw new Error(result.error.message)
      await refreshHiddenClientRecords()
      markWriteSuccess()
      flashNotice(`Se eliminó ${person.sheet} de VALIDACION CREDITOS.`)
    } catch (error) {
      await saveHiddenClientFlags(person.sheet, { hidden_from_validation: false }).catch(() => undefined)
      throw error
    }
  }

  const connectionStatus = syncState === 'error' ? 'offline' : syncState === 'syncing' ? 'checking' : writeBlocked ? 'blocked' : 'online'
  const connectionLabel = connectionStatus === 'offline' ? 'Sin conexión' : connectionStatus === 'blocked' ? 'En línea · no guarda' : connectionStatus === 'checking' ? 'Conectando…' : 'En línea · listo'

  return <div className="app-shell">
    <aside className={'sidebar' + (sidebarOpen ? ' sidebar-open' : '')} onPointerLeave={(event) => { if (event.pointerType === 'mouse') setSidebarOpen(false) }} onFocusCapture={() => setSidebarOpen(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setSidebarOpen(false) }}>
      <button className="brand" type="button" onClick={() => navigate('MENU')} aria-label="Volver al menu">
        <img className="brand-logo" src={`${import.meta.env.BASE_URL}logo-sportivos.png`} alt="Tienda Sportivo's" />
      </button>
      <p className="nav-caption">HOJAS DEL EXCEL</p>
      <nav className="main-nav" aria-label="Navegacion principal">
        {['PRINCIPAL', 'INVENTARIOS', 'MOVIMIENTOS', 'CARTERA', 'COSTOS', 'REPORTES'].map((group) => <div key={group} className="nav-group">
          {group !== 'PRINCIPAL' && <span className="nav-group-label">{group}</span>}
          {menuItems.filter((item) => item.group === group).map((item) => <button key={item.key} className={'nav-link ' + (active === item.key ? 'active' : '')} type="button" onClick={() => navigate(item.key)}>
            <span className="nav-symbol">{item.icon}</span>{item.label}
          </button>)}
        </div>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="data-status"><i /> {hasSupabaseConfig ? 'Base compartida Supabase' : 'Base compartida no configurada'}</div>
      </div>
    </aside>
    <main className="main-content">
      <header className="topbar">
        <div className="breadcrumb"><button className="menu-toggle" type="button" onClick={() => setSidebarOpen((open) => !open)} aria-expanded={sidebarOpen} aria-label={sidebarOpen ? 'Ocultar menú' : 'Abrir menú'} title={sidebarOpen ? 'Ocultar menú' : 'Abrir menú'}>☰ <span>MENÚ</span></button><span>/</span><strong>{active}</strong></div>
        <div className="topbar-right"><span className="connection" data-state={connectionStatus} role="status" aria-live="polite" title={connectionStatus === 'online' ? 'Conectado con la base compartida; puedes guardar registros.' : connectionStatus === 'blocked' ? 'La base responde, pero el último intento de guardar falló. Puedes reintentar después de revisar el aviso.' : connectionStatus === 'offline' ? 'No se pudo conectar con la base compartida.' : 'Comprobando la conexión con la base compartida.'}><i aria-hidden="true" /><span>{connectionLabel}</span></span><button className="refresh-button" type="button" onClick={() => void refreshAll(true)} title="Volver a cargar los datos y recalcular existencias">Actualizar</button></div>
      </header>
      {notice && <div className="toast" role="status">{notice}</div>}
      {syncError && <div className="sync-warning" role="status">{syncError}</div>}
      {active === 'MENU' ? <Menu data={data} balances={balanceHistory} physicalCounts={physicalCounts} onNavigate={navigate} /> : active === 'VALIDACION_CREDITOS' ? <ValidationCreditView data={data} periodPolicy={periodPolicy} hiddenClientRecords={hiddenClientRecords} hiddenClientRecordsError={hiddenClientRecordsError} deletedHistoryRecords={deletedHistoryRecords} deletedHistoryError={deletedHistoryError} onDeletedHistoryRecord={(record) => setDeletedHistoryRecords((current) => current.some((item) => item.client_identity === record.client_identity && item.transaction_key === record.transaction_key) ? current : [...current, record])} onDeletePerson={deleteValidationPerson} /> : <ModuleView module={active} data={data} rows={filteredRows} totalRows={rows.length} search={search} onSearch={setSearch} creditFilters={creditFilters} onCreditFiltersChange={setCreditFilters} onNew={() => { if (!datedOperationalModules.has(active) || periodPolicy.canRegister) { if (syncState === 'synced') setShowForm(true); else flashNotice('Espera a que conecte con la base compartida antes de agregar registros.') } else flashNotice(periodPolicy.message) }} onPhysicalCount={() => setShowPhysicalCount(true)} onDelete={deleteRow} onDeleteClient={deleteClient} deletingRecord={deletingRecord} hiddenClientRecordsError={hiddenClientRecordsError} deletedHistoryRecords={deletedHistoryRecords} onNotice={flashNotice} physicalCountsError={physicalCountsError} />}
    </main>
    {showForm && active !== 'MENU' && <RecordForm module={active} data={data} physicalCounts={physicalCounts} periodPolicy={periodPolicy} hiddenClientRecords={hiddenClientRecords} deletedHistoryRecords={deletedHistoryRecords} onClose={() => setShowForm(false)} onSave={saveRow} />}
    {showPhysicalCount && <PhysicalInventoryCountModal data={data} counts={physicalCounts} setupError="" onClose={() => setShowPhysicalCount(false)} onSave={savePhysicalCounts} />}
    {stockDeleteCandidate && <CreditStockDeleteModal row={stockDeleteCandidate} busy={Boolean(deletingRecord)} onClose={() => setStockDeleteCandidate(null)} onConfirm={(adjustStock) => { const row = stockDeleteCandidate; setStockDeleteCandidate(null); void deleteRow('CREDITOS', row, adjustStock) }} />}
  </div>
}

function useWorkbookSync() {
  const [data, setData] = useState<Record<ModuleKey, WorkbookRow[]>>(emptyWorkbookData)
  const [physicalCounts, setPhysicalCounts] = useState<PhysicalInventoryCount[]>([])
  const [physicalCountsError, setPhysicalCountsError] = useState('')
  const [syncState, setSyncState] = useState<SyncState>('syncing')
  const [syncError, setSyncError] = useState('')
  const [writeBlocked, setWriteBlocked] = useState(false)
  const refreshInFlight = useRef(false)
  const manualRefreshQueued = useRef(false)
  const hasLoadedRemote = useRef(false)
  const lastSuccessfulRefreshAt = useRef(0)
  const writeBlockedRef = useRef(false)
  const refreshAllRef = useRef<((showNotice?: boolean) => Promise<boolean>) | null>(null)

  const markWriteFailure = useCallback((message: string) => {
    writeBlockedRef.current = true
    setWriteBlocked(true)
    setSyncError(message)
  }, [])
  const markWriteSuccess = useCallback(() => {
    writeBlockedRef.current = false
    setWriteBlocked(false)
    setSyncError('')
  }, [])

  const refreshAll = useCallback(async (showNotice = false, force = false): Promise<boolean> => {
    if (!supabase) {
      setSyncState('error')
      setSyncError('Esta aplicación no está conectada a la base compartida. No guardes registros desde esta versión.')
      if (showNotice) window.dispatchEvent(new CustomEvent('sportivos:notice', { detail: 'No se pudo actualizar: falta configurar la base compartida.' }))
      return false
    }
    if (!force && !showNotice && Date.now() - lastSuccessfulRefreshAt.current < 30_000) return true
    if (refreshInFlight.current) {
      if (showNotice) manualRefreshQueued.current = true
      return showNotice
    }
    refreshInFlight.current = true
    if (!hasLoadedRemote.current || showNotice) setSyncState('syncing')
    try {
      const remoteData = await readRemoteData()
      hasLoadedRemote.current = true
      lastSuccessfulRefreshAt.current = Date.now()
      setData(remoteData.data)
      setPhysicalCounts(remoteData.physicalCounts)
      setPhysicalCountsError(remoteData.physicalCountsError)
      setSyncError(writeBlockedRef.current ? 'La base está en línea, pero un intento de guardado fue rechazado. Revisa los permisos o intenta guardar de nuevo.' : '')
      setSyncState('synced')
      window.dispatchEvent(new CustomEvent('sportivos:balance-updated'))
      if (showNotice || manualRefreshQueued.current) window.dispatchEvent(new CustomEvent('sportivos:notice', { detail: 'Datos recargados y existencias recalculadas con los códigos normalizados. Solo se recuperan registros guardados en la base.' }))
      return true
    } catch (error) {
      setSyncState('error')
      setSyncError('No hay conexión con la base compartida. Los cambios no se guardan; vuelve a conectar y pulsa Actualizar. ' + (error instanceof Error ? error.message : ''))
      if (showNotice || manualRefreshQueued.current) window.dispatchEvent(new CustomEvent('sportivos:notice', { detail: 'No se pudo actualizar desde la base compartida.' }))
      return false
    } finally {
      const refreshQueued = manualRefreshQueued.current
      manualRefreshQueued.current = false
      refreshInFlight.current = false
      if (refreshQueued) window.setTimeout(() => {
        const refresh = refreshAllRef.current
        if (refresh) void refresh(true)
      }, 0)
    }
  }, [])
  useEffect(() => {
    refreshAllRef.current = refreshAll
  }, [refreshAll])

  useEffect(() => {
    void refreshAll()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshAll()
    }, 60_000)
    const refreshWhenActive = () => {
      if (document.visibilityState === 'visible') void refreshAll()
    }
    const handleOffline = () => {
      setSyncState('error')
      setSyncError('El dispositivo no tiene conexión a internet. Los datos no se pueden cargar ni guardar.')
    }
    const handleOnline = () => { void refreshAll() }
    window.addEventListener('focus', refreshWhenActive)
    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)
    document.addEventListener('visibilitychange', refreshWhenActive)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refreshWhenActive)
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
      document.removeEventListener('visibilitychange', refreshWhenActive)
    }
  }, [refreshAll])

  useEffect(() => {
    const handleWriteStatus = (event: Event) => {
      if (!(event instanceof CustomEvent) || typeof event.detail !== 'object' || event.detail === null) return
      if (event.detail.success === true) markWriteSuccess()
      else if (event.detail.success === false) markWriteFailure(String(event.detail.message ?? 'La base está en línea, pero no se pudo guardar el cambio.'))
    }
    window.addEventListener('sportivos:write-status', handleWriteStatus)
    return () => window.removeEventListener('sportivos:write-status', handleWriteStatus)
  }, [markWriteFailure, markWriteSuccess])

  return { data, physicalCounts, physicalCountsError, syncState, syncError, writeBlocked, refreshAll, markWriteFailure, markWriteSuccess }
}

function useSavedBalances(): { balances: MonthlyBalance[]; loaded: boolean } {
  const [balances, setBalances] = useState<MonthlyBalance[]>([])
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    if (!supabase) {
      setLoaded(true)
      return
    }
    const client = supabase
    let cancelled = false
    let loading = false
    const refresh = async () => {
      if (loading) return
      loading = true
      try {
        const result = await client.from('balance').select('*')
        if (result.error) throw new Error(result.error.message)
        const byPeriod = new Map<string, MonthlyBalance>()
        for (const row of result.data ?? []) {
          const snapshot = parseBalanceSnapshot(row['Estado del período'])
          if (snapshot) byPeriod.set(`${snapshot.year}-${snapshot.month}`, snapshot)
        }
        if (!cancelled) setBalances([...byPeriod.values()].sort((a, b) => a.year - b.year || a.month - b.month))
      } catch (error) {
        console.error('No se pudieron cargar los balances del dashboard.', error)
      } finally {
        loading = false
        if (!cancelled) setLoaded(true)
      }
    }
    const refreshWhenActive = () => { if (document.visibilityState === 'visible') void refresh() }
    void refresh()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 60_000)
    window.addEventListener('sportivos:balance-updated', refreshWhenActive)
    window.addEventListener('focus', refreshWhenActive)
    document.addEventListener('visibilitychange', refreshWhenActive)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener('sportivos:balance-updated', refreshWhenActive)
      window.removeEventListener('focus', refreshWhenActive)
      document.removeEventListener('visibilitychange', refreshWhenActive)
    }
  }, [])
  return { balances, loaded }
}

async function readRemoteData(): Promise<RemoteSnapshot> {
  if (!supabase) throw new Error('Falta la configuración de Supabase.')
  const client = supabase
  async function readTable(table: string) {
    const pageSize = 1000
    const rows: WorkbookRow[] = []
    for (let offset = 0; ; offset += pageSize) {
      // `created_at` is not unique; offset pagination on it can repeat or skip
      // rows when many records share a timestamp. Every remote module table has
      // a primary `id`, so use that stable key to page through the full dataset.
      const result = await client.from(table).select('*').order('id', { ascending: true }).range(offset, offset + pageSize - 1)
      if (result.error) throw result.error
      const page = (result.data ?? []) as WorkbookRow[]
      rows.push(...page)
      if (page.length < pageSize) return rows
    }
  }
  const entries = await Promise.all((Object.keys(remoteTableByModule) as ModuleKey[]).map(async (module) => {
    const table = remoteTableByModule[module]
    if (!table) return [module, []] as const
    try {
      const rows = await readTable(table)
      return [module, rows.map((row) => fromRemoteRow(module, row))] as const
    } catch (error) {
      throw new Error(module + ': ' + (error instanceof Error ? error.message : String(error)))
    }
  }))
  return {
    data: { ...emptyWorkbookData(), ...Object.fromEntries(entries) } as Record<ModuleKey, WorkbookRow[]>,
    physicalCounts: [],
    physicalCountsError: '',
  }
}
function fromRemoteRow(module: ModuleKey, row: WorkbookRow): WorkbookRow {
  const next = { ...row }
  if (module === 'INVENTARIO_PT') next.CONSIGNACION = row.CONSIGNACION ?? row['CONSIGNACIÓN'] ?? null
  if (module === 'ENTRADAS') next.VALOR_PRODUCTO = calculateLineTotal(row.CANTIDAD, row.PRECIO)
  if (module === 'GASTOS') {
    next.DETALLE = String(row.DETALLE ?? '').trim() || String(row.COMENTARIOS ?? '').trim() || String(row.CODIGO_MP ?? '').trim() || null
    next.MES = 'Otro'
  }
  return next
}
function toRemoteRow(module: ModuleKey, row: WorkbookRow): WorkbookRow {
  const next = { ...row }
  delete next.id
  delete next.created_at
  delete next.updated_at
  if (module === 'INVENTARIO_PT') {
    next['CONSIGNACIÓN'] = next.CONSIGNACION ?? next['CONSIGNACIÓN'] ?? 0
    delete next.CONSIGNACION
  }
  if (module === 'ENTRADAS') {
    delete next.Columna1
    delete next.VALOR_PRODUCTO
  }
  if (module === 'CLIENTES' || module === 'COSTOS_NO_PRODUCIDOS' || module === 'CREDITOS') delete next.Columna1
  if (module === 'GASTOS') {
    delete next.MES
    delete next.COMENTARIOS
    delete next.CANTIDAD
  }
  return next
}

function ValidationCreditView({ data, periodPolicy, hiddenClientRecords, hiddenClientRecordsError, deletedHistoryRecords, deletedHistoryError, onDeletedHistoryRecord, onDeletePerson }: { data: Record<ModuleKey, WorkbookRow[]>; periodPolicy: PeriodPolicy; hiddenClientRecords: HiddenClientRecord[]; hiddenClientRecordsError: string; deletedHistoryRecords: DeletedValidationHistoryRecord[]; deletedHistoryError: string; onDeletedHistoryRecord: (record: DeletedValidationHistoryRecord) => void; onDeletePerson: (person: ValidationCreditPerson) => Promise<void> }) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [movements, setMovements] = useState<SavedValidationCreditMovement[]>([])
  const [movementLoadError, setMovementLoadError] = useState('')
  const [isLoadingMovements, setIsLoadingMovements] = useState(true)
  const [showMovementForm, setShowMovementForm] = useState(false)
  const [showHistoryPdfModal, setShowHistoryPdfModal] = useState(false)
  const [historyPdfPersonSheet, setHistoryPdfPersonSheet] = useState('')
  const [historyPdfError, setHistoryPdfError] = useState('')
  const [isGeneratingHistoryPdf, setIsGeneratingHistoryPdf] = useState(false)
  const [isSavingMovement, setIsSavingMovement] = useState(false)
  const [movementFormError, setMovementFormError] = useState('')
  const [movementActionError, setMovementActionError] = useState('')
  const [movementNotice, setMovementNotice] = useState('')
  const [historyDeleteCandidate, setHistoryDeleteCandidate] = useState<{ person: string; transaction: ValidationCreditTransaction } | null>(null)
  const [deletingMovementId, setDeletingMovementId] = useState<string | null>(null)
  const [deletingPersonSheet, setDeletingPersonSheet] = useState<string | null>(null)
  const [personQuery, setPersonQuery] = useState('')
  const [personOptionsOpen, setPersonOptionsOpen] = useState(false)
  const [activePersonIndex, setActivePersonIndex] = useState(-1)
  const [form, setForm] = useState<ValidationCreditFormValues>(() => ({
    requestId: '',
    personSheet: '',
    type: 'CREDITO',
    date: localDateInputValue(),
    code: '',
    detail: '',
    quantity: '1',
    unitValue: '',
    discount: '0',
    paymentAmount: '',
    business: '',
    businessDetail: '',
  }))
  const baseSummary = useMemo(() => getValidationCreditSummary(), [])
  const registeredClientNames = useMemo(() => [...data.CLIENTES, ...data.CREDITOS]
    .map((row) => String(row.NOMBRE ?? '').trim())
    .filter(Boolean), [data.CLIENTES, data.CREDITOS])
  const deletedHistoryKeys = useMemo(() => new Set(deletedHistoryRecords.map((record) => record.transaction_key)), [deletedHistoryRecords])
  const allPeople = useMemo(() => mergeValidationCreditMovements(movements, registeredClientNames, deletedHistoryKeys)
    .filter((person) => !hiddenClientRecords.some((record) => record.hidden_from_validation && record.client_identity === normalizeClientName(person.sheet)))
    .slice()
    .sort((a, b) => compareClientNames(a.sheet, b.sheet)), [movements, registeredClientNames, hiddenClientRecords, deletedHistoryKeys])
  const summary = useMemo(() => ({
    ...baseSummary,
    totalPersonas: allPeople.length,
    totalCompras: allPeople.reduce((sum, person) => sum + person.totalCompras, 0),
    totalAbonos: allPeople.reduce((sum, person) => sum + person.totalAbonos, 0),
    totalDescuentos: allPeople.reduce((sum, person) => sum + person.totalDescuentos, 0),
    carteraPendiente: allPeople.reduce((sum, person) => sum + Math.max(0, person.saldoPendiente), 0),
    personasConSaldoPendiente: allPeople.filter((person) => person.saldoPendiente > 0).length,
    personasAlDia: allPeople.filter((person) => person.saldoPendiente <= 0).length,
    registros: baseSummary.registros - deletedHistoryRecords.length + movements.length,
  }), [allPeople, baseSummary, movements.length, deletedHistoryRecords.length])
  const people = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase()
    if (!needle) return allPeople
    return allPeople.filter((person) => [person.name, person.sheet, ...person.transactions.map((transaction) => transaction.codigo ?? '')]
      .join(' ').toLocaleLowerCase().includes(needle))
  }, [allPeople, search])
  const filteredSummary = useMemo(() => {
    const totals = people.reduce((acc, person) => {
      acc.totalCompras += person.totalCompras
      acc.totalAbonos += person.totalAbonos
      acc.totalDescuentos += person.totalDescuentos
      acc.carteraPendiente += Math.max(0, person.saldoPendiente)
      if (person.saldoPendiente > 0) acc.personasConSaldoPendiente += 1
      if (person.saldoPendiente <= 0) acc.personasAlDia += 1
      return acc
    }, { totalCompras: 0, totalAbonos: 0, totalDescuentos: 0, carteraPendiente: 0, personasConSaldoPendiente: 0, personasAlDia: 0 })
    return {
      ...summary,
      totalPersonas: people.length,
      ...totals,
    }
  }, [people, summary])
  const selectedPerson = allPeople.find((person) => person.sheet === form.personSheet)
  const selectedPersonCreditRows = useMemo(() => {
    if (!selectedPerson) return []
    return data.CREDITOS
      .filter((row) => getValidationClientIdentity(row.NOMBRE) === getValidationClientIdentity(selectedPerson.sheet)
        && isCreditType(row.TIPO)
        && String(row.CODIGO ?? '').trim())
      .slice()
      .sort((a, b) => rowCreatedAtValue(a) - rowCreatedAtValue(b))
  }, [data.CREDITOS, selectedPerson?.sheet])
  const matchingFormPeople = useMemo(() => {
    const needle = personQuery.trim().toLocaleLowerCase('es')
    return allPeople.filter((person) => !needle || `${person.name} ${person.sheet}`.toLocaleLowerCase('es').includes(needle))
  }, [allPeople, personQuery])
  const quantity = Number(form.quantity)
  const unitValue = Number(form.unitValue)
  const discount = Number(form.discount)
  const purchaseTotal = quantity * unitValue - discount
  const balanceAfter = selectedPerson
    ? selectedPerson.saldoPendiente + (form.type === 'CREDITO' ? purchaseTotal : -Number(form.paymentAmount || 0))
    : 0

  useEffect(() => {
    let active = true
    async function loadMovements() {
      if (!supabase) {
        setMovementLoadError('Falta la conexión con Supabase; no se pueden cargar movimientos nuevos.')
        setIsLoadingMovements(false)
        return
      }
      const result = await readAllValidationMovementRows(supabase)
      if (!active) return
      if (result.error) {
        setMovementLoadError('No se pudieron cargar los movimientos nuevos. Verifica que la tabla de validación esté configurada en Supabase. ' + result.error.message)
      } else {
        setMovementLoadError('')
        setMovements((result.data ?? []).map(parseSavedValidationMovement))
      }
      setIsLoadingMovements(false)
    }
    const refresh = () => {
      void loadMovements().catch((error: unknown) => {
        if (!active) return
        setMovementLoadError('No se pudieron cargar los movimientos nuevos. ' + (error instanceof Error ? error.message : 'Error desconocido.'))
        setIsLoadingMovements(false)
      })
    }
    refresh()
    const timer = window.setInterval(refresh, 30_000)
    window.addEventListener('focus', refresh)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  function openMovementForm(personSheet = '') {
    if (!periodPolicy.canRegister) {
      setMovementFormError(periodPolicy.message)
      return
    }
    setMovementNotice('')
    setMovementFormError('')
    setPersonQuery(allPeople.find((person) => person.sheet === personSheet)?.name ?? '')
    setPersonOptionsOpen(false)
    setActivePersonIndex(-1)
    setForm({
      requestId: crypto.randomUUID(),
      personSheet,
      type: 'CREDITO',
      date: localDateInputValue(),
      code: '',
      detail: '',
      quantity: '1',
      unitValue: '',
      discount: '0',
      paymentAmount: '',
      business: '',
      businessDetail: '',
    })
    setShowMovementForm(true)
  }

  async function saveValidationMovement(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMovementFormError('')
    const dateError = validateOperationalDate(form.date, periodPolicy)
    if (dateError) {
      setMovementFormError(dateError)
      return
    }
    const person = allPeople.find((item) => item.sheet === form.personSheet)
    if (!person) {
      setMovementFormError('Selecciona una persona de la lista del Excel.')
      return
    }
    if (!form.business) {
      setMovementFormError('Selecciona la categoría de negocio, como en el formulario del Excel.')
      return
    }
    if (form.business === 'OTRO' && !form.businessDetail.trim()) {
      setMovementFormError('Escribe la categoría del negocio.')
      return
    }
    const quantityValue = Number(form.quantity)
    const unitValueAmount = Number(form.unitValue)
    const discountAmount = Number(form.discount || 0)
    const paymentAmount = Number(form.paymentAmount)
    const total = quantityValue * unitValueAmount - discountAmount
    if (form.type === 'CREDITO') {
      if (!form.code.trim() || !form.detail.trim()) {
        setMovementFormError('El código y la descripción son obligatorios para registrar un crédito.')
        return
      }
      if (!selectedPersonCreditRows.some((credit) => normalizeCode(credit.CODIGO) === normalizeCode(form.code))) {
        setMovementFormError('Este producto no está registrado en CREDITOS para esta persona. Primero registra el crédito en el módulo CREDITOS y luego selecciónalo aquí para verificarlo.')
        return
      }
      if (!Number.isFinite(quantityValue) || quantityValue <= 0 || !Number.isFinite(unitValueAmount) || unitValueAmount <= 0) {
        setMovementFormError('La cantidad y el valor deben ser mayores a cero.')
        return
      }
      if (!Number.isFinite(discountAmount) || discountAmount < 0 || !Number.isFinite(total) || total <= 0) {
        setMovementFormError('El descuento no puede ser negativo ni superar el valor de la compra.')
        return
      }
    } else if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      setMovementFormError('El valor del abono debe ser mayor a cero.')
      return
    }
    if (!supabase) {
      setMovementFormError('No hay conexión con Supabase para guardar el movimiento.')
      return
    }
    const row = {
      request_id: form.requestId,
      person_sheet: person.sheet,
      movement_type: form.type,
      movement_date: form.date,
      code: form.type === 'CREDITO' ? form.code.trim() : null,
      detail: form.type === 'CREDITO' ? form.detail.trim() : 'ABONO',
      quantity: form.type === 'CREDITO' ? quantityValue : 0,
      unit_value: form.type === 'CREDITO' ? unitValueAmount : 0,
      discount: form.type === 'CREDITO' ? discountAmount : 0,
      total: form.type === 'CREDITO' ? total : 0,
      payment_amount: form.type === 'ABONO' ? paymentAmount : 0,
      balance_after: balanceAfter,
      business: form.business === 'OTRO' ? form.businessDetail.trim() : form.business,
    }
    setIsSavingMovement(true)
    try {
      let saved = await supabase.from(validationCreditTable).insert(row).select('*').single()
      if (saved.error?.code === '23505') {
        saved = await supabase.from(validationCreditTable).select('*').eq('request_id', form.requestId).single()
      }
      if (saved.error) throw new Error(saved.error.message)
      const savedMovement = parseSavedValidationMovement(saved.data)
      setMovements((current) => current.some((movement) => movement.request_id === form.requestId) ? current : [...current, savedMovement])
      setShowMovementForm(false)
      setMovementNotice(`${form.type === 'CREDITO' ? 'Crédito' : 'Abono'} registrado para ${person.sheet}.`)
    } catch (error) {
      setMovementFormError('No se pudo guardar el movimiento. ' + (error instanceof Error ? error.message : 'Error desconocido.'))
    } finally {
      setIsSavingMovement(false)
    }
  }

  async function deleteValidationMovement(row: ValidationCreditPerson['transactions'][number], personSheet: string, personName: string) {
    if (!row.savedMovementId || !supabase || deletingMovementId) return
    const description = [
      `Persona: ${personName}`,
      `Fecha: ${row.fecha ?? 'sin fecha'}`,
      `Movimiento: ${row.tipo === 'ABONO' ? 'abono' : 'crédito'}`,
      row.detalle ? `Detalle: ${row.detalle}` : '',
      `Valor: ${currency.format(row.tipo === 'ABONO' ? row.abona : row.total || row.valor)}`,
    ].filter(Boolean).join('\n')
    if (!window.confirm(`¿Eliminar este movimiento de VALIDACION CREDITOS?\n\n${description}\n\nSe actualizarán los totales y el saldo de este módulo. Esta acción no se puede deshacer.`)) return

    setDeletingMovementId(row.savedMovementId)
    setMovementActionError('')
    let deletionConfirmed = false
    try {
      const result = await supabase.from(validationCreditTable).delete().eq('id', row.savedMovementId).select('id')
      if (result.error) throw new Error(result.error.message)
      if (result.data?.length !== 1) throw new Error('No se encontró el movimiento para eliminarlo.')
      deletionConfirmed = true
      const remainingMovements = movements.filter((movement) => movement.id !== row.savedMovementId)
      setMovements(remainingMovements)
      const localBalance = mergeValidationCreditMovements(remainingMovements, registeredClientNames).find((person) => person.sheet === personSheet)?.saldoPendiente ?? 0
      setMovementNotice(`Movimiento eliminado. Saldo actualizado para ${personName}: ${currency.format(localBalance)}.`)
      const refreshed = await readAllValidationMovementRows(supabase)
      if (refreshed.error) throw new Error(refreshed.error.message)
      const currentMovements = (refreshed.data ?? []).map(parseSavedValidationMovement)
      setMovements(currentMovements)
      const updatedBalance = mergeValidationCreditMovements(currentMovements, registeredClientNames).find((person) => person.sheet === personSheet)?.saldoPendiente ?? 0
      setMovementNotice(`Movimiento eliminado. Saldo actualizado para ${personName}: ${currency.format(updatedBalance)}.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido.'
      setMovementActionError(deletionConfirmed
        ? 'El movimiento se eliminó y el saldo ya se recalculó; no se pudo confirmar la recarga desde Supabase. ' + message
        : 'No se pudo eliminar el movimiento. ' + message)
    } finally {
      setDeletingMovementId(null)
    }
  }

  async function deleteImportedValidationMovement(personSheet: string, row: ValidationCreditTransaction, adjustStock: boolean) {
    const transactionKey = row.sourceTransactionKey
    if (!transactionKey || !supabase || deletingMovementId) return
    setDeletingMovementId(transactionKey)
    setMovementActionError('')
    try {
      const result = await supabase.rpc('delete_validation_credit_history_transaction', {
        p_client_identity: normalizeClientName(personSheet),
        p_transaction_key: transactionKey,
        p_adjust_stock: adjustStock,
        p_code: row.codigo,
        p_quantity: row.cantidad,
        p_movement_type: row.tipo,
      })
      if (result.error) throw new Error(result.error.message)
      onDeletedHistoryRecord({ client_identity: normalizeClientName(personSheet), transaction_key: transactionKey, adjust_stock: adjustStock })
      const stockMessage = adjustStock && row.tipo === 'COMPRA' && row.cantidad > 0 && row.codigo
        ? ` Se repusieron ${number.format(row.cantidad)} unidades al inventario.`
        : ' El inventario no cambió.'
      setMovementNotice(`Registro histórico eliminado. El saldo de ${personSheet} se recalculó automáticamente.${stockMessage}`)
      setHistoryDeleteCandidate(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido.'
      const setupHint = message.toLowerCase().includes('function') || message.toLowerCase().includes('schema cache') || message.toLowerCase().includes('does not exist')
        ? ' Ejecuta supabase/migrations/20261110140000_validacion_creditos_borrado_historial.sql en Supabase y vuelve a intentar.'
        : ''
      setMovementActionError('No se pudo eliminar el registro histórico. ' + message + setupHint)
    } finally {
      setDeletingMovementId(null)
    }
  }

  async function deleteValidationPersonRecord(person: ValidationCreditPerson) {
    if (deletingPersonSheet) return
    const savedMovements = movements.filter((movement) => normalizeClientName(movement.person_sheet) === normalizeClientName(person.sheet)).length
    const historyDescription = savedMovements
      ? `${savedMovements} movimiento(s) guardado(s) y todo el historial importado de Excel`
      : 'todo el historial importado de Excel'
    if (!window.confirm(`¿Eliminar completamente a ${person.sheet} de VALIDACION CREDITOS?\n\nSe quitará ${historyDescription} de este módulo. Los registros de CREDITOS y CLIENTES se conservarán.`)) return
    setDeletingPersonSheet(person.sheet)
    setMovementActionError('')
    try {
      await onDeletePerson(person)
      setMovements((current) => current.filter((movement) => normalizeClientName(movement.person_sheet) !== normalizeClientName(person.sheet)))
      setSelected((current) => current === person.sheet ? null : current)
    } catch (error) {
      setMovementActionError('No se pudo eliminar la persona de VALIDACION CREDITOS. ' + (error instanceof Error ? error.message : 'Error desconocido.'))
    } finally {
      setDeletingPersonSheet(null)
    }
  }

  async function generatePersonHistoryPdf() {
    const person = allPeople.find((item) => item.sheet === historyPdfPersonSheet)
    if (!person) {
      setHistoryPdfError('Selecciona una persona para generar su historial.')
      return
    }

    setIsGeneratingHistoryPdf(true)
    setHistoryPdfError('')
    try {
      const { downloadValidationCreditHistory } = await import('./lib/validation-credit-history')
      await downloadValidationCreditHistory(person)
      setShowHistoryPdfModal(false)
    } catch (error) {
      setHistoryPdfError('No se pudo generar el historial PDF. ' + (error instanceof Error ? error.message : 'Error desconocido.'))
    } finally {
      setIsGeneratingHistoryPdf(false)
    }
  }

  function openHistoryPdfModal() {
    setHistoryPdfPersonSheet('')
    setHistoryPdfError('')
    setShowHistoryPdfModal(true)
  }

  const creditProductOptions = [...selectedPersonCreditRows.reduce((options, credit) => {
    const code = String(credit.CODIGO ?? '').trim()
    const key = normalizeCode(code)
    const current = options.get(key)
    const quantity = Number(credit.CANT ?? 0)
    options.set(key, {
      code,
      detail: String(credit.DETALLE ?? '').trim(),
      hint: `${number.format((current?.quantity ?? 0) + quantity)} unidad(es) registradas en CREDITOS`,
      quantity: (current?.quantity ?? 0) + quantity,
    })
    return options
  }, new Map<string, CodeSearchOption & { quantity: number }>()).values()]
    .sort((a, b) => compareProductDetails({ CODIGO: a.code, DETALLE: a.detail }, { CODIGO: b.code, DETALLE: b.detail }))
  function selectValidationPerson(sheet: string) {
    const person = allPeople.find((item) => item.sheet === sheet)
    if (!person) return
    setPersonQuery(person.sheet)
    setPersonOptionsOpen(false)
    setActivePersonIndex(-1)
    setForm((current) => ({ ...current, personSheet: person.sheet, code: '', detail: '', quantity: '1', unitValue: '', discount: '0' }))
  }
  function handleValidationPersonKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' && matchingFormPeople.length) {
      event.preventDefault()
      setPersonOptionsOpen(true)
      setActivePersonIndex((index) => Math.min(index + 1, matchingFormPeople.length - 1))
    } else if (event.key === 'ArrowUp' && matchingFormPeople.length) {
      event.preventDefault()
      setPersonOptionsOpen(true)
      setActivePersonIndex((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter' && personOptionsOpen && matchingFormPeople.length) {
      event.preventDefault()
      selectValidationPerson((matchingFormPeople[activePersonIndex] ?? matchingFormPeople[0]).sheet)
    } else if (event.key === 'Escape') setPersonOptionsOpen(false)
  }
  return <section className="page-content">
      <div className="page-heading"><div><p className="eyebrow">VALIDACIÓN DE CARTERA</p><h1>VALIDACION CREDITOS</h1><p className="page-description">Datos sincronizados desde {validationCreditSourceWorkbook}, guardado el {Number.isFinite(validationCreditSourceAsOf) ? new Date(validationCreditSourceAsOf).toLocaleDateString('es-CO') : 'fecha no disponible'}. Incluye las compras, abonos y saldos registrados por persona.</p></div><div className="validation-credit-heading-actions"><button className="secondary-button" type="button" onClick={openHistoryPdfModal} disabled={isLoadingMovements || Boolean(movementLoadError)} title={isLoadingMovements ? 'Espera a que carguen los movimientos' : 'Descargar el historial completo de una persona'}>Historial PDF</button><button className="primary-button" type="button" onClick={() => openMovementForm()} disabled={!periodPolicy.canRegister} title={periodPolicy.canRegister ? 'Registrar movimiento del mes en curso' : periodPolicy.message}><span className="plus">+</span> Registrar crédito o abono</button></div></div>
    {!periodPolicy.canRegister && <p className="sync-warning" role="alert">{periodPolicy.message}</p>}
    {movementLoadError && <p className="sync-warning" role="alert">{movementLoadError}</p>}
    {hiddenClientRecordsError && <p className="sync-warning" role="alert">El borrado de personas completas necesita la migración supabase/migrations/20261110120000_clientes_eliminados.sql. {hiddenClientRecordsError}</p>}
    {deletedHistoryError && <p className="sync-warning" role="alert">{deletedHistoryError}</p>}
    {movementNotice && <p className="validation-credit-notice" role="status">{movementNotice}</p>}
    {movementActionError && <p className="form-error" role="alert">{movementActionError}</p>}
    {isLoadingMovements && <p className="validation-credit-loading" role="status">Cargando movimientos del módulo...</p>}
    <div className="summary-grid">
      <SummaryCard label="Total personas" value={number.format(filteredSummary.totalPersonas)} note="Personas registradas" tone="blue" />
      <SummaryCard label="Cartera pendiente" value={currency.format(filteredSummary.carteraPendiente)} note="Saldo neto por persona" tone="amber" />
      <SummaryCard label="Total compras" value={currency.format(filteredSummary.totalCompras)} note="Créditos otorgados" tone="green" />
      <SummaryCard label="Total abonos" value={currency.format(filteredSummary.totalAbonos)} note="Pagos y abonos recibidos" tone="rose" />
      <SummaryCard label="Con saldo" value={number.format(filteredSummary.personasConSaldoPendiente)} note="Personas con deuda" tone="red" />
      <SummaryCard label="Al día" value={number.format(filteredSummary.personasAlDia)} note="Personas sin saldo" tone="teal" />
    </div>

    <section className="catalog-card">
      <div className="catalog-header">
        <div><h2>Listado de personas</h2><p>{people.length} resultados de {summary.totalPersonas} clientes y personas de validación.</p></div>
        <label className="search-box"><span>?</span><input aria-label="Buscar persona de validación de créditos" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nombre, código o hoja..." /><kbd>Ctrl K</kbd></label>
      </div>
      <div className="table-wrap"><table className="validation-credit-people-table">
        <thead><tr><th>Persona</th><th>Saldo pendiente</th><th>Total compras</th><th>Total abonado</th><th>Último movimiento</th><th>Estado</th><th>Acciones</th></tr></thead>
        <tbody>
          {people.length === 0 ? <tr><td colSpan={7} className="empty-state"><strong>Sin coincidencias</strong><span>No aparecen personas con ese filtro.</span></td></tr> : people.map((person) => {
            const recentTransactions = person.transactions
            const isSelected = selected === person.sheet
            return <Fragment key={person.sheet}>
              <tr className={`validation-credit-person-row${isSelected ? ' selected-row' : ''}`} onClick={() => setSelected(isSelected ? null : person.sheet)} style={{ cursor: 'pointer' }}>
                <td data-label="Persona">{person.sheet}</td>
                <td data-label="Saldo pendiente">{currency.format(person.saldoPendiente)}</td>
                <td data-label="Total compras">{currency.format(person.totalCompras)}</td>
                <td data-label="Total abonado">{currency.format(person.totalAbonos)}</td>
                <td data-label="Último movimiento">{person.ultimoMovimiento ? new Date(person.ultimoMovimiento + 'T00:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</td>
                <td data-label="Estado"><span className={person.estado === 'PENDIENTE' ? 'status-pill pending' : 'status-pill ok'}>{person.estado === 'PENDIENTE' ? 'Pendiente' : 'Al día'}</span></td>
                <td data-label="Acciones"><button className="delete-button" type="button" disabled={deletingPersonSheet !== null || Boolean(hiddenClientRecordsError)} onClick={(event) => { event.stopPropagation(); void deleteValidationPersonRecord(person) }}>{deletingPersonSheet === person.sheet ? 'Eliminando…' : 'Eliminar persona'}</button></td>
              </tr>
              {isSelected && <tr className="validation-credit-person-details-row"><td className="validation-credit-person-details-cell" colSpan={7}>
                <div className="validation-credit-person-details">
                  <div className="validation-credit-person-heading"><strong>Ficha de {person.sheet}</strong><button className="small-action" type="button" onClick={() => openMovementForm(person.sheet)}>Registrar crédito o abono</button></div>
                  <p className="validation-credit-actions-hint">Puedes eliminar movimientos registrados uno a uno o quitar a la persona completa de VALIDACION CREDITOS, incluido su historial importado.</p>
                  <div className="table-wrap validation-credit-history-wrap"><table className="validation-credit-history-table">
                    <thead><tr><th>Fecha</th><th>Código</th><th>Detalle</th><th>Cantidad</th><th>Valor</th><th>Abono</th><th>Debe</th><th>Tipo</th><th>Negocio</th><th>Acciones</th></tr></thead>
                    <tbody>{recentTransactions.map((row, index) => <tr key={row.savedMovementId ?? row.sourceTransactionKey ?? `${person.sheet}-${index}`}><td>{row.fecha ? new Date(row.fecha + 'T00:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</td><td>{row.codigo ?? '—'}</td><td>{row.detalle ?? '—'}</td><td>{row.cantidad || 0}</td><td>{currency.format(row.total || row.valor || 0)}</td><td>{currency.format(row.abona)}</td><td>{currency.format(row.debe)}</td><td>{row.tipo}</td><td>{row.negocio ?? '—'}</td><td className="validation-credit-actions-cell"><div className="validation-credit-row-actions"><button className="delete-button" type="button" disabled={deletingMovementId !== null} onClick={() => row.savedMovementId ? void deleteValidationMovement(row, person.sheet, person.sheet) : setHistoryDeleteCandidate({ person: person.sheet, transaction: row })} aria-label={`Eliminar ${row.tipo === 'ABONO' ? 'abono' : 'crédito'} de ${person.sheet}`} title="Eliminar movimiento">{deletingMovementId === (row.savedMovementId ?? row.sourceTransactionKey) ? 'Eliminando…' : 'Eliminar'}</button></div></td></tr>)}</tbody>
                  </table></div>
                </div>
              </td></tr>}
            </Fragment>
          })}
        </tbody>
      </table></div>
    </section>
    {showHistoryPdfModal && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !isGeneratingHistoryPdf) setShowHistoryPdfModal(false) }}><section className="modal validation-credit-history-modal" role="dialog" aria-modal="true" aria-labelledby="validation-credit-history-title">
      <div className="modal-heading"><div><p className="eyebrow">REPORTE DE CARTERA</p><h2 id="validation-credit-history-title">Historial completo en PDF</h2><p>Selecciona una persona para incluir todos sus créditos y abonos registrados.</p></div><button className="close-button" type="button" onClick={() => setShowHistoryPdfModal(false)} aria-label="Cerrar" disabled={isGeneratingHistoryPdf}>×</button></div>
      <label className="validation-credit-history-person">Persona<select required value={historyPdfPersonSheet} onChange={(event) => { setHistoryPdfPersonSheet(event.target.value); setHistoryPdfError('') }}><option value="">Selecciona una persona</option>{allPeople.map((person) => <option key={person.sheet} value={person.sheet}>{person.sheet}</option>)}</select></label>
      {historyPdfError && <p className="form-error" role="alert">{historyPdfError}</p>}
      <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setShowHistoryPdfModal(false)} disabled={isGeneratingHistoryPdf}>Cancelar</button><button className="primary-button" type="button" onClick={() => void generatePersonHistoryPdf()} disabled={isGeneratingHistoryPdf || !historyPdfPersonSheet}>{isGeneratingHistoryPdf ? 'Generando PDF...' : 'Descargar historial completo'}</button></div>
    </section></div>}
    {historyDeleteCandidate && <ValidationHistoryDeleteModal person={historyDeleteCandidate.person} row={historyDeleteCandidate.transaction} personBalance={allPeople.find((person) => person.sheet === historyDeleteCandidate.person)?.saldoPendiente ?? 0} busy={deletingMovementId !== null} onClose={() => setHistoryDeleteCandidate(null)} onConfirm={(adjustStock) => void deleteImportedValidationMovement(historyDeleteCandidate.person, historyDeleteCandidate.transaction, adjustStock)} />}
    {showMovementForm && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !isSavingMovement) setShowMovementForm(false) }}><section className="modal validation-credit-modal" role="dialog" aria-modal="true" aria-labelledby="validation-credit-form-title">
      <div className="modal-heading"><div><p className="eyebrow">REGISTRO DE CARTERA</p><h2 id="validation-credit-form-title">Crédito o abono</h2><p>Flujo basado en frmRegistroCredito del Excel.</p></div><button className="close-button" type="button" onClick={() => setShowMovementForm(false)} aria-label="Cerrar" disabled={isSavingMovement}>×</button></div>
      <form onSubmit={(event) => void saveValidationMovement(event)}>
        <div className="validation-credit-form-grid">
          <label>Persona<div className="validation-credit-person-search">
            <input required role="combobox" aria-label="Buscar persona para el movimiento" aria-autocomplete="list" aria-expanded={personOptionsOpen} aria-controls="validation-credit-person-options" aria-activedescendant={personOptionsOpen && activePersonIndex >= 0 ? `validation-credit-person-option-${activePersonIndex}` : undefined} autoComplete="off" placeholder="Escribe el nombre o código de la persona" value={personQuery} onFocus={() => setPersonOptionsOpen(true)} onBlur={() => window.setTimeout(() => setPersonOptionsOpen(false), 150)} onChange={(event) => { setPersonQuery(event.target.value); setPersonOptionsOpen(true); setActivePersonIndex(-1); setForm((current) => ({ ...current, personSheet: '', code: '', detail: '', quantity: '1', unitValue: '', discount: '0' })) }} onKeyDown={handleValidationPersonKeyDown} />
            {personOptionsOpen && <div className="validation-credit-person-options" id="validation-credit-person-options" role="listbox" aria-label="Personas coincidentes">{matchingFormPeople.length ? matchingFormPeople.map((person, index) => <button key={person.sheet} id={`validation-credit-person-option-${index}`} type="button" role="option" aria-selected={person.sheet === form.personSheet} className={index === activePersonIndex ? 'active' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => selectValidationPerson(person.sheet)}><strong>{person.sheet}</strong></button>) : <span className="validation-credit-person-empty">No hay personas coincidentes</span>}</div>}
          </div></label>
          <label>Fecha<input required type="date" min={periodPolicy.firstDate} max={periodPolicy.today} value={form.date} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))} /></label>
        </div>
        <fieldset className="validation-credit-type"><legend>Tipo de movimiento</legend><label><input type="radio" name="validation-credit-type" checked={form.type === 'CREDITO'} onChange={() => setForm((current) => ({ ...current, type: 'CREDITO' }))} /> Crédito</label><label><input type="radio" name="validation-credit-type" checked={form.type === 'ABONO'} onChange={() => setForm((current) => ({ ...current, type: 'ABONO' }))} /> Abono</label></fieldset>
        {form.type === 'CREDITO' ? <div className="validation-credit-form-grid">
          <label>Código o descripción del crédito registrado<SearchableCodeInput value={form.code} options={creditProductOptions} required placeholder={selectedPerson ? 'Busca solo entre los créditos de esta persona' : 'Selecciona primero una persona'} ariaLabel="Buscar producto entre créditos de la persona" onChange={(value) => setForm((current) => ({ ...current, code: value, detail: '', unitValue: '' }))} onSelect={(option) => {
            const matchingCredits = selectedPersonCreditRows.filter((row) => normalizeCode(row.CODIGO) === normalizeCode(option.code))
            const latestCredit = matchingCredits.at(-1)
            const registeredQuantity = matchingCredits.reduce((total, credit) => total + Number(credit.CANT ?? 0), 0)
            const recordedPrice = Number(latestCredit?.PRECIO ?? (Number(latestCredit?.CANT ?? 0) > 0 ? Number(latestCredit?.VALOR ?? 0) / Number(latestCredit?.CANT ?? 1) : 0))
            setForm((current) => ({ ...current, code: option.code, detail: option.detail, quantity: String(registeredQuantity || 1), unitValue: String(recordedPrice || '') }))
          }} /></label>
          {!selectedPerson && <p className="form-hint">Selecciona primero una persona para consultar los productos que ya tiene registrados en CREDITOS.</p>}
          {selectedPerson && creditProductOptions.length === 0 && <p className="form-hint">Esta persona aún no tiene créditos con código en el módulo CREDITOS.</p>}
          <label>Descripción<input required value={form.detail} onChange={(event) => setForm((current) => ({ ...current, detail: event.target.value }))} /></label>
          <label>Cantidad<input required type="number" min="0.01" step="any" value={form.quantity} onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))} /></label>
          <label>Valor unitario<input required type="number" min="1" step="1" value={form.unitValue} onChange={(event) => setForm((current) => ({ ...current, unitValue: event.target.value }))} /></label>
          <label>Descuento<input type="number" min="0" step="1" value={form.discount} onChange={(event) => setForm((current) => ({ ...current, discount: event.target.value }))} /></label>
          <label>Categoría de negocio<select required value={form.business} onChange={(event) => setForm((current) => ({ ...current, business: event.target.value, businessDetail: '' }))}><option value="">Selecciona negocio</option>{validationCreditBusinesses.map((business) => <option key={business} value={business}>{business === 'OTRO' ? 'Otro' : business}</option>)}</select></label>
          {form.business === 'OTRO' && <label>Escribe la categoría<input required value={form.businessDetail} onChange={(event) => setForm((current) => ({ ...current, businessDetail: event.target.value }))} placeholder="Nombre de la categoría" /></label>}
        </div> : <div className="validation-credit-form-grid">
          <label>Valor del abono<input required type="number" min="1" step="1" value={form.paymentAmount} onChange={(event) => setForm((current) => ({ ...current, paymentAmount: event.target.value }))} /></label>
          <label>Categoría de negocio<select required value={form.business} onChange={(event) => setForm((current) => ({ ...current, business: event.target.value, businessDetail: '' }))}><option value="">Selecciona negocio</option>{validationCreditBusinesses.map((business) => <option key={business} value={business}>{business === 'OTRO' ? 'Otro' : business}</option>)}</select></label>
          {form.business === 'OTRO' && <label>Escribe la categoría<input required value={form.businessDetail} onChange={(event) => setForm((current) => ({ ...current, businessDetail: event.target.value }))} placeholder="Nombre de la categoría" /></label>}
        </div>}
        <div className="validation-credit-balance-preview"><span>{form.type === 'CREDITO' ? 'Total de la compra' : 'Saldo después del abono'}</span><strong>{currency.format(form.type === 'CREDITO' ? purchaseTotal : balanceAfter)}</strong><small>Saldo anterior: {currency.format(selectedPerson?.saldoPendiente ?? 0)} · Nuevo saldo: {currency.format(balanceAfter)}</small></div>
        {movementFormError && <p className="form-error" role="alert">{movementFormError}</p>}
        {movementLoadError && <p className="form-error" role="alert">No se puede guardar hasta que la tabla de movimientos esté disponible en Supabase.</p>}
        <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setShowMovementForm(false)} disabled={isSavingMovement}>Cancelar</button><button className="primary-button" type="submit" disabled={isSavingMovement || Boolean(movementLoadError)}>{isSavingMovement ? 'Guardando...' : form.type === 'CREDITO' ? 'Registrar crédito' : 'Registrar abono'}</button></div>
      </form>
    </section></div>}
  </section>
}

function parseSavedValidationMovement(value: unknown): SavedValidationCreditMovement {
  if (typeof value !== 'object' || value === null) throw new Error('Supabase devolvió un movimiento con formato inválido.')
  const row = value as Record<string, unknown>
  const movementType = row.movement_type === 'ABONO' ? 'ABONO' : row.movement_type === 'CREDITO' ? 'CREDITO' : null
  if (!movementType || typeof row.person_sheet !== 'string' || typeof row.movement_date !== 'string') {
    throw new Error('Supabase devolvió un movimiento de validación incompleto.')
  }
  return {
    id: String(row.id),
    request_id: String(row.request_id),
    person_sheet: row.person_sheet,
    movement_type: movementType,
    movement_date: row.movement_date.slice(0, 10),
    code: typeof row.code === 'string' ? row.code : null,
    detail: typeof row.detail === 'string' ? row.detail : null,
    quantity: Number(row.quantity ?? 0),
    unit_value: Number(row.unit_value ?? 0),
    discount: Number(row.discount ?? 0),
    total: Number(row.total ?? 0),
    payment_amount: Number(row.payment_amount ?? 0),
    balance_after: Number(row.balance_after ?? 0),
    business: String(row.business ?? ''),
    created_at: String(row.created_at ?? ''),
  }
}

async function readAllValidationMovementRows(client: NonNullable<typeof supabase>) {
  const pageSize = 1000
  const rows: unknown[] = []
  for (let offset = 0; ; offset += pageSize) {
    const result = await client.from(validationCreditTable).select('*').order('created_at', { ascending: true }).order('id', { ascending: true }).range(offset, offset + pageSize - 1)
    if (result.error) return { data: null, error: result.error }
    const page = result.data ?? []
    rows.push(...page)
    if (page.length < pageSize) return { data: rows, error: null }
  }
}

async function readHiddenClientRecords(client: NonNullable<typeof supabase>) {
  const pageSize = 1000
  const records: HiddenClientRecord[] = []
  for (let offset = 0; ; offset += pageSize) {
    const result = await client.from(hiddenClientTable).select('*').order('client_identity', { ascending: true }).range(offset, offset + pageSize - 1)
    if (result.error) return { data: records, error: result.error }
    const page = (result.data ?? []) as HiddenClientRecord[]
    records.push(...page)
    if (page.length < pageSize) return { data: records, error: null }
  }
}

async function readAllDeletedValidationHistoryRecords(client: NonNullable<typeof supabase>) {
  const pageSize = 1000
  const records: DeletedValidationHistoryRecord[] = []
  for (let offset = 0; ; offset += pageSize) {
    const result = await client.from(deletedValidationHistoryTable).select('*').order('client_identity', { ascending: true }).range(offset, offset + pageSize - 1)
    if (result.error) return { data: records, error: result.error }
    const page = (result.data ?? []) as DeletedValidationHistoryRecord[]
    records.push(...page)
    if (page.length < pageSize) return { data: records, error: null }
  }
}

function Menu({ data, balances, physicalCounts, onNavigate }: { data: Record<ModuleKey, WorkbookRow[]>; balances: MonthlyBalance[]; physicalCounts: PhysicalInventoryCount[]; onNavigate: (module: ModuleKey | 'MENU') => void }) {
  const metrics = getMetrics(data, physicalCounts)
  return <section className="page-content home-page">
    <div className="page-heading"><div><p className="eyebrow">HOJA PRINCIPAL</p><h1>MENU</h1><p className="page-description">Vista de control del libro Sportivos: inventarios, ventas, cartera y reportes.</p></div><span className="reference-badge">Fuente: SPORTIVOS (1) (1).xlsm</span></div>
    <div className="summary-grid">
      <SummaryCard label="Productos terminados" value={number.format(metrics.products)} note="Registros en INVENTARIO_PT" tone="green" />
      <SummaryCard label="Stock disponible" value={number.format(metrics.stock)} note="ENTRADAS menos SALIDAS" tone="blue" />
      <SummaryCard label="Valor del stock" value={currency.format(metrics.stockValue)} note="Existencias actuales × costo unitario" tone="amber" />
      <SummaryCard label="Gastos registrados" value={currency.format(metrics.expenses)} note="Suma de VALOR en GASTOS" tone="rose" />
    </div>
    <UtilityTrend balances={balances} />
    <BalanceTrend balances={balances} />
    <section className="menu-card home-module-menu"><div className="section-heading"><div><h2>HOJAS Y FORMULARIOS</h2><p>Acceso directo a cada modulo visible del archivo original.</p></div></div>
      <div className="module-grid">{menuItems.filter((item) => item.key !== 'MENU').map((item) => <button key={item.key} className="module-tile" type="button" onClick={() => onNavigate(item.key)}><span className="tile-icon">{item.icon}</span><span><strong>{item.label}</strong><small>{item.key === 'BALANCE' ? 'Historial mensual' : item.key === 'VALIDACION_CREDITOS' ? `${getValidationCreditSummary().totalPersonas} personas` : `${data[item.key as ModuleKey].length} registros`}</small></span><span className="tile-arrow">-&gt;</span></button>)}</div>
    </section>
    <BalanceRecommendation balances={balances} />
  </section>
}

function BalanceTrend({ balances }: { balances: MonthlyBalance[] }) {
  const latest = balances.slice(-3)
  const series = [
    { key: 'recaudo', label: 'Dinero recaudado', color: '#347653', value: (item: MonthlyBalance) => item.totalCollections },
    { key: 'gastos', label: 'Gastos', color: '#d17b57', value: (item: MonthlyBalance) => item.totalExpenses },
    { key: 'utilidad', label: 'Utilidad neta', color: '#477a9f', value: (item: MonthlyBalance) => item.totalCollections - item.totalExpenses },
    { key: 'retiro', label: 'Retiro sugerido', color: '#9a74b5', value: (item: MonthlyBalance) => item.suggestedWithdrawal },
  ]
  const values = latest.flatMap((item) => series.map((metric) => metric.value(item)))
  const maxMagnitude = Math.max(100000, ...values.map(Math.abs))
  const step = Math.ceil(maxMagnitude / 4 / 100000) * 100000
  const chartMin = Math.floor(Math.min(0, ...values) / step) * step
  const chartMax = Math.ceil(Math.max(0, ...values) / step) * step || step
  const plotTop = 22
  const plotBottom = 210
  const plotHeight = plotBottom - plotTop
  const chartRange = chartMax - chartMin || 1
  const yForValue = (value: number) => plotBottom - (value - chartMin) / chartRange * plotHeight
  const zeroY = yForValue(0)
  const chartWidth = 780
  const left = 82
  const right = 18
  const groupWidth = (chartWidth - left - right) / Math.max(latest.length, 1)
  const barWidth = Math.min(25, groupWidth / 7)
  const barGap = 5
  const barsWidth = series.length * barWidth + (series.length - 1) * barGap
  const axisLabel = (value: number) => value === 0 ? '$0' : `$${number.format(value / 1000000)} M`
  return <section className="balance-trend" aria-label="Comparación de balances mensuales">
    <div className="section-heading"><div><h2>Balances de los últimos meses</h2><p>Comparación de los últimos 3 balances guardados</p></div></div>
    {latest.length === 0 ? <div className="balance-trend-empty">Cuando guardes un balance mensual, aquí verás la comparación del recaudo, los gastos, la utilidad neta y el retiro sugerido.</div> : <>
      <div className="balance-chart-wrap"><svg className="balance-chart" viewBox={`0 0 ${chartWidth} 254`} role="img" aria-label="Gráfica de recaudo, gastos, utilidad neta y retiro sugerido por mes">
        {[0, 1, 2, 3, 4].map((step) => {
          const value = chartMin + chartRange * step / 4
          const y = yForValue(value)
          return <g key={step}><line x1={left} x2={chartWidth - right} y1={y} y2={y} className="balance-chart-gridline" /><text x={left - 9} y={y + 4} textAnchor="end" className="balance-chart-axis">{axisLabel(value)}</text></g>
        })}
        <line x1={left} x2={chartWidth - right} y1={zeroY} y2={zeroY} className="balance-chart-baseline" />
        {latest.map((item, monthIndex) => {
          const center = left + groupWidth * (monthIndex + 0.5)
          const label = `${monthLabels[item.month - 1]} ${item.year}`
          return <g key={`${item.year}-${item.month}`}>
            {series.map((metric, seriesIndex) => {
              const value = metric.value(item)
              const valueY = yForValue(value)
              const y = Math.min(zeroY, valueY)
              const height = Math.abs(zeroY - valueY)
              const x = center - barsWidth / 2 + seriesIndex * (barWidth + barGap)
              return <g key={metric.key}><rect x={x} y={y} width={barWidth} height={height} rx="3" fill={metric.color}><title>{`${metric.label} · ${label}: ${currency.format(value)}`}</title></rect></g>
            })}
            <text x={center} y="236" textAnchor="middle" className="balance-chart-month">{monthLabels[item.month - 1]}</text>
            <text x={center} y="250" textAnchor="middle" className="balance-chart-year">{item.year}</text>
          </g>
        })}
      </svg></div>
      <div className="balance-chart-legend">{series.map((metric) => <span key={metric.key}><i style={{ backgroundColor: metric.color }} />{metric.label}</span>)}</div>
      <div className="balance-trend-table-wrap"><table className="balance-trend-table"><thead><tr><th>Indicador</th>{latest.map((item) => <th key={`${item.year}-${item.month}`}>{monthLabels[item.month - 1]} {item.year}</th>)}</tr></thead><tbody>{series.map((metric) => <tr key={metric.key}><th scope="row"><i style={{ backgroundColor: metric.color }} />{metric.label}</th>{latest.map((item) => <td key={`${metric.key}-${item.year}-${item.month}`}>{currency.format(metric.value(item))}</td>)}</tr>)}</tbody></table></div>
    </>}
  </section>
}

function UtilityTrend({ balances }: { balances: MonthlyBalance[] }) {
  const [isCompact, setIsCompact] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 560px)').matches)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 560px)')
    const update = () => setIsCompact(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  const latest = balances.slice(-6)
  const utilityValues = latest.map((item) => item.totalCollections - item.totalExpenses)
  const expenseValues = latest.map((item) => item.totalExpenses)
  const min = Math.min(0, ...utilityValues)
  const max = Math.max(0, ...utilityValues, ...expenseValues)
  const range = max - min || 1
  const padding = range * 0.12
  const chartMin = min - padding
  const chartMax = max + padding
  const chartWidth = isCompact ? 420 : 780
  const chartHeight = 220
  const left = isCompact ? 60 : 96
  const right = isCompact ? 20 : 28
  const top = 36
  const bottom = 178
  const plotHeight = bottom - top
  const monthSpacing = isCompact ? 67 : 108
  const firstMonth = latest.length ? latest[0].year * 12 + latest[0].month : 0
  const lastMonth = latest.length ? latest[latest.length - 1].year * 12 + latest[latest.length - 1].month : 0
  const monthSpan = lastMonth - firstMonth
  const plotCenter = (left + chartWidth - right) / 2
  const xForMonth = (item: MonthlyBalance) => plotCenter + (item.year * 12 + item.month - (firstMonth + monthSpan / 2)) * monthSpacing
  const yForValue = (value: number) => bottom - (value - chartMin) / (chartMax - chartMin) * plotHeight
  const points = latest.map((item) => ({ item, utility: item.totalCollections - item.totalExpenses, expenses: item.totalExpenses, x: xForMonth(item), utilityY: yForValue(item.totalCollections - item.totalExpenses), expensesY: yForValue(item.totalExpenses) }))
  const utilityLine = points.map((point) => `${point.x},${point.utilityY}`).join(' ')
  const expenseLine = points.map((point) => `${point.x},${point.expensesY}`).join(' ')
  const axisLabel = (value: number) => value === 0 ? '$0' : `$${number.format(Math.round(value / 100000) / 10)} M`
  const valueLabel = (value: number) => isCompact
    ? Math.abs(value) >= 1000000
      ? `$${number.format(value / 1000000)} M`
      : Math.abs(value) >= 1000
        ? `$${number.format(value / 1000)} mil`
        : currency.format(value)
    : currency.format(value)

  return <section className="utility-trend" aria-label="Utilidad y gastos mensuales">
    <div className="section-heading"><div><h2>Utilidad y gastos mensuales</h2><p>Comparación mensual del resultado neto y los egresos</p></div></div>
    {latest.length === 0 ? <div className="balance-trend-empty">Cuando guardes un balance mensual, aquí verás la utilidad de cada mes.</div> : <div className="utility-chart-wrap">
      <svg className="utility-chart" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label="Líneas de utilidad neta y gastos mensuales">
        {[0, 0.5, 1].map((fraction) => {
          const value = chartMin + (chartMax - chartMin) * fraction
          const y = yForValue(value)
          return <g key={fraction}><line x1={left} x2={chartWidth - right} y1={y} y2={y} className="utility-chart-gridline" /><text x={left - 12} y={y + 4} textAnchor="end" className="utility-chart-axis">{axisLabel(value)}</text></g>
        })}
        <polyline points={utilityLine} className="utility-chart-line" />
        <polyline points={expenseLine} className="utility-chart-expense-line" />
        {points.map(({ item, utility, expenses, x, utilityY, expensesY }) => {
          const monthName = monthLabels[item.month - 1]
          const label = `${monthName} ${item.year}`
          const displayMonth = isCompact ? `${monthName.slice(0, 3)} '${String(item.year).slice(-2)}` : label
          const labelsNeedSeparation = Math.abs(utilityY - expensesY) < (isCompact ? 25 : 30)
          const labelOffset = isCompact ? 25 : 39
          const utilityLabelX = labelsNeedSeparation ? x - labelOffset : x
          const expenseLabelX = labelsNeedSeparation ? x + labelOffset : x
          const utilityLabelY = utilityY < top + 28 ? utilityY + 29 : utilityY - 13
          const expenseLabelY = expensesY < top + 28 ? expensesY + 29 : expensesY + 20
          return <g key={`${item.year}-${item.month}`}>
            <circle cx={x} cy={utilityY} r="4.5" className="utility-chart-point"><title>{`Utilidad · ${label}: ${currency.format(utility)}`}</title></circle>
            <circle cx={x} cy={expensesY} r="4.5" className="utility-chart-expense-point"><title>{`Gastos · ${label}: ${currency.format(expenses)}`}</title></circle>
            <text x={utilityLabelX} y={utilityLabelY} textAnchor="middle" className="utility-chart-value">{valueLabel(utility)}</text>
            <text x={expenseLabelX} y={expenseLabelY} textAnchor="middle" className="utility-chart-expense-value">{valueLabel(expenses)}</text>
            <text x={x} y="202" textAnchor="middle" className="utility-chart-month">{displayMonth}</text>
          </g>
        })}
      </svg>
      <div className="utility-chart-legend"><span><i className="utility-legend-profit" />Utilidad neta</span><span><i className="utility-legend-expense" />Gastos</span></div>
    </div>}
  </section>
}

function BalanceRecommendation({ balances }: { balances: MonthlyBalance[] }) {
  const report = balances[balances.length - 1]
  if (!report) return null

  const profit = report.totalCollections - report.totalExpenses
  const margin = report.totalCollections > 0 ? profit / report.totalCollections * 100 : null
  const expenseBreakdown = [
    { label: 'costos de producción', amount: report.productionCosts, action: 'cotiza insumos con varios proveedores y registra la merma para evitar compras más caras de lo necesario' },
    { label: 'compras y costos no producidos', amount: report.nonProducedCosts, action: 'revisa la rotación del inventario y compra solo lo que el movimiento de ventas justifique' },
    { label: 'gastos operativos', amount: report.operatingExpenses, action: 'define un tope semanal y separa los gastos indispensables de los que pueden esperar' },
    { label: 'reembolsos por devoluciones', amount: report.refunds, action: 'identifica los motivos de devolución y corrige primero los productos o procesos que más se repiten' },
  ]
  const largestExpense = expenseBreakdown.reduce((largest, item) => item.amount > largest.amount ? item : largest, { label: '', amount: 0, action: '' })
  const expenseShare = report.totalExpenses > 0 ? largestExpense.amount / report.totalExpenses * 100 : 0
  const status = profit > 0 ? 'Utilidad' : profit < 0 ? 'Pérdida' : report.totalCollections > 0 ? 'Punto de equilibrio' : 'Sin resultado registrado'
  const summary = profit > 0
    ? `El negocio sí dejó utilidad: el recaudo fue ${currency.format(report.totalCollections)} y los egresos ${currency.format(report.totalExpenses)}. Quedaron ${currency.format(profit)} (${margin === null ? '0' : number.format(margin)}% del recaudo).`
    : profit < 0
      ? `El mes cerró con pérdida de ${currency.format(Math.abs(profit))}: los egresos (${currency.format(report.totalExpenses)}) superaron el recaudo (${currency.format(report.totalCollections)}).`
      : report.totalCollections > 0
        ? `El mes quedó en punto de equilibrio: el recaudo de ${currency.format(report.totalCollections)} apenas cubrió los egresos. No se registró utilidad para reinvertir.`
        : 'No hay recaudo ni egresos registrados en este balance; verifica que las ventas y los gastos del período estén completos.'
  const reason = largestExpense.amount > 0
    ? `El rubro más alto fue ${largestExpense.label}: ${currency.format(largestExpense.amount)}, equivalente al ${number.format(expenseShare)}% de los egresos.`
    : report.totalCollections === 0 && report.totalExpenses > 0
      ? 'La pérdida se explica por egresos registrados sin recaudo en el período.'
      : 'No hay un rubro de egreso dominante en los datos guardados.'
  const nextStep = profit < 0
    ? largestExpense.amount > 0
      ? `Para el próximo mes, ${largestExpense.action}. Revisa también la cartera pendiente (${currency.format(report.receivables)}) y programa seguimiento de cobros cada semana.`
      : `Para el próximo mes, registra todo el recaudo y cada gasto; antes de asumir nuevos costos, revisa la cartera pendiente (${currency.format(report.receivables)}) y programa cobros semanales.`
    : profit === 0
      ? `Para el próximo mes, busca que el recaudo supere los egresos: ${largestExpense.amount > 0 ? largestExpense.action : 'confirma que todos los movimientos estén registrados'} y revisa el resultado semanalmente.`
      : `Para mejorar la utilidad sin frenar las ventas, ${largestExpense.amount > 0 ? largestExpense.action : 'mantén control semanal de gastos'}. Conserva el fondo para el siguiente mes (${currency.format(report.nextFund)}) antes de definir retiros adicionales.`

  return <section className={`balance-recommendation ${profit < 0 ? 'is-loss' : profit > 0 ? 'is-profit' : 'is-neutral'}`} aria-label="Recomendación del balance mensual">
    <div className="section-heading"><div><p className="eyebrow">LECTURA DEL BALANCE · {monthLabels[report.month - 1]} {report.year}</p><h2>Recomendación para el negocio</h2></div><span className="recommendation-status">{status}</span></div>
    <p className="recommendation-summary">{summary}</p>
    <p className="recommendation-reason"><strong>¿Qué influyó?</strong> {reason}</p>
    <p className="recommendation-action"><strong>Qué hacer el próximo mes:</strong> {nextStep}</p>
    <p className="recommendation-footnote">Lectura automática basada en el balance guardado y en los movimientos registrados.</p>
  </section>
}

function SummaryCard({ label, value, note, tone }: { label: string; value: string; note: string; tone: string }) {
  return <article className="summary-card"><div className="summary-top"><span>{label}</span><span className={'summary-icon ' + tone}>*</span></div><strong>{value}</strong><small>{note}</small></article>
}

function ModuleView({ module, data, rows, totalRows, search, onSearch, creditFilters, onCreditFiltersChange, onNew, onPhysicalCount, onDelete, onDeleteClient, deletingRecord, hiddenClientRecordsError, deletedHistoryRecords, onNotice, physicalCountsError }: { module: ModuleKey; data: Record<ModuleKey, WorkbookRow[]>; rows: WorkbookRow[]; totalRows: number; search: string; onSearch: (value: string) => void; creditFilters: CreditFilters; onCreditFiltersChange: (filters: CreditFilters) => void; onNew: () => void; onPhysicalCount: () => void; onDelete: (module: ModuleKey, row: WorkbookRow, adjustStock?: boolean) => void; onDeleteClient: (row: WorkbookRow) => void; deletingRecord: string | null; hiddenClientRecordsError: string; deletedHistoryRecords: DeletedValidationHistoryRecord[]; onNotice: (message: string) => void; physicalCountsError: string }) {
  const columns = useMemo(() => moduleColumns[module].filter((column) => column.key !== 'Columna1' && !(module === 'CREDITOS' && column.key === 'DETALLE') && !(module === 'INVENTARIO_PT' && normalizeExpenseText(column.key).replace(/[^a-z]/g, '') === 'conteofisico') && !(module === 'INVENTARIO_PT' && ['PRECIO_AL_POR_MAYOR', 'COSTO MO', 'CONSIGNACION'].includes(normalizeExpenseText(column.key).toUpperCase()))), [module])
  const displayRows = useMemo(() => module === 'CLIENTES'
    ? [...rows].sort((a, b) => compareClientNames(a.NOMBRE, b.NOMBRE))
    : module === 'INVENTARIO_PT' || module === 'COSTOS_NO_PRODUCIDOS'
      ? [...rows].sort(compareProductDetails)
      : rows, [module, rows])
  const [page, setPage] = useState(0)
  const pageSize = 100
  const pageCount = Math.max(1, Math.ceil(displayRows.length / pageSize))
  const pageRows = displayRows.slice(page * pageSize, (page + 1) * pageSize)
  useEffect(() => { setPage(0) }, [module, rows])
  const clientSnapshots = useMemo(() => {
    const snapshots = new Map<string, { balance: number; asOf: number; movementCutoff: number }>()
    data.CLIENTES.forEach((client) => {
      const key = getValidationClientIdentity(client.NOMBRE)
      const balance = Number(client.saldo_base)
      const asOf = Date.parse(String(client.saldo_base_fecha ?? ''))
      if (key && client.saldo_base !== null && client.saldo_base !== undefined && client.saldo_base !== '' && Number.isFinite(balance) && Number.isFinite(asOf)) snapshots.set(key, { balance, asOf, movementCutoff: asOf })
    })
    mergeValidationCreditMovements([], [], new Set(deletedHistoryRecords.map((record) => record.transaction_key))).forEach((person) => snapshots.set(getValidationClientIdentity(person.sheet), {
      balance: person.saldoPendiente,
      asOf: validationCreditSourceAsOf,
      movementCutoff: importedCreditHistoryCutoff,
    }))
    return snapshots
  }, [data.CLIENTES, deletedHistoryRecords])
  const clientTransactions = useMemo(() => {
    const transactions = new Map<string, WorkbookRow[]>()
    const workbookDuplicateCreditIds = getWorkbookDuplicateCreditIds(data.CREDITOS)
    data.CREDITOS.forEach((row) => {
      const key = getValidationClientIdentity(row.NOMBRE)
      const snapshot = clientSnapshots.get(key)
      if (!key || (snapshot && rowCreatedAtValue(row) <= snapshot.movementCutoff) || workbookDuplicateCreditIds.has(String(row.id ?? ''))) return
      const group = transactions.get(key) ?? []
      group.push(row)
      transactions.set(key, group)
    })
    transactions.forEach((items) => items.sort((a, b) => rowDateValue(a.FECHA) - rowDateValue(b.FECHA)))
    return transactions
  }, [clientSnapshots, data.CREDITOS])
  const isReport = module === 'BALANCE'
  const canDelete = editableModules.has(module)
  return <section className="page-content">
    {module === 'CLIENTES' && hiddenClientRecordsError && <p className="sync-warning" role="alert">El borrado de clientes necesita la migración supabase/migrations/20261110120000_clientes_eliminados.sql. {hiddenClientRecordsError}</p>}
    <div className="page-heading"><div><p className="eyebrow">HOJA DEL LIBRO</p><h1>{module}</h1><p className="page-description">{moduleDescription(module)}</p></div>{editableModules.has(module) && <div className="heading-actions">{module === 'INVENTARIO_PT' && <button className="secondary-button" type="button" onClick={onPhysicalCount}>Conteo físico</button>}<button className="primary-button" type="button" onClick={onNew}><span className="plus">+</span> Nuevo registro</button></div>}</div>
    {module === 'INVENTARIO_PT' && physicalCountsError && <p className="form-error inventory-count-setup-warning">El botón de conteo físico necesita la tabla de Supabase. Ejecuta la migración indicada en el proyecto antes de guardar conteos.</p>}
    {isReport ? <ReportView data={data} /> : <section className={`catalog-card${module === 'CREDITOS' ? ' credit-catalog-card' : ''}`}>
      <div className={`catalog-header${module === 'CREDITOS' ? ' credit-catalog-header' : ''}`}>
        <div><h2>{module}</h2><p>{columns.length} columnas - {rows.length} de {totalRows} registros{module === 'CREDITOS' ? ' - orden cronológico según los filtros' : ' - busqueda en todos los campos'}</p></div>
        {module === 'CREDITOS' ? <CreditFilterControls rows={data.CREDITOS} filters={creditFilters} onChange={onCreditFiltersChange} /> : <label className="search-box"><span>?</span><input aria-label={'Buscar en ' + module} value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Buscar en la hoja..." /><kbd>Ctrl K</kbd></label>}
      </div>
      <div className="table-wrap"><table className={module === 'CREDITOS' ? 'credits-table' : undefined}>
        <thead><tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}{module === 'CLIENTES' && <><th>SALDO PENDIENTE</th><th>ESTADO DE CUENTA</th></>}{canDelete && <th>ACCIONES</th>}</tr></thead>
        <tbody>{rows.length === 0 ? <tr><td colSpan={columns.length + (module === 'CLIENTES' ? 2 : 0) + (canDelete ? 1 : 0)} className="empty-state"><strong>{module === 'CREDITOS' && totalRows > 0 ? 'No hay movimientos con esos filtros' : 'Sin registros'}</strong><span>{module === 'CREDITOS' && totalRows > 0 ? 'Prueba con otro nombre, tipo o rango de fechas.' : 'Usa Nuevo registro para capturar un dato.'}</span></td></tr> : pageRows.map((row, index) => {
          const clientName = String(row.NOMBRE ?? '').trim()
          const clientIdentity = getValidationClientIdentity(clientName)
          const clientSnapshot = clientSnapshots.get(clientIdentity)
          const statementRows = clientTransactions.get(clientIdentity) ?? []
          const recordKey = `${module}:${row.id ?? index}`
          return <tr key={module === 'CLIENTES' ? `CLIENTES-${normalizeClientName(row.NOMBRE)}` : module + '-' + String(row.id ?? index)} className={module === 'CREDITOS' ? 'credit-record-row' : undefined}>
            {columns.map((column) => {
              const value = module === 'GASTOS' && column.key === 'DETALLE'
                ? String(row.DETALLE ?? '').trim() || String(row.COMENTARIOS ?? '').trim() || row.CODIGO_MP
                : row[column.key]
              const displayValue = module === 'CREDITOS' && column.key === 'NOMBRE' ? getValidationClientSheet(value) ?? value : value
              return <td key={column.key} data-credit-label={module === 'CREDITOS' ? column.label : undefined} data-credit-field={module === 'CREDITOS' ? column.key : undefined}>{formatCell(displayValue, column.key)}</td>
            })}
            {module === 'CLIENTES' && <><td className="client-balance">{currency.format(Number(row.Columna1 ?? 0))}</td><td><div className="client-actions"><button type="button" className="small-action" onClick={() => { void import('./lib/client-statement').then(({ downloadClientStatement }) => downloadClientStatement(clientName, statementRows, clientSnapshot ? { openingBalance: clientSnapshot.balance, openingDate: clientSnapshot.asOf } : undefined)).catch((error: unknown) => onNotice('No se pudo generar el estado de cuenta. ' + (error instanceof Error ? error.message : 'Error desconocido.'))) }}>Descargar PDF</button><button type="button" className="small-action" onClick={() => { void import('./lib/client-statement').then(({ shareClientStatement }) => shareClientStatement(clientName, statementRows, onNotice, clientSnapshot ? { openingBalance: clientSnapshot.balance, openingDate: clientSnapshot.asOf } : undefined)).catch((error: unknown) => onNotice('No se pudo compartir el estado de cuenta. ' + (error instanceof Error ? error.message : 'Error desconocido.'))) }}>Compartir</button></div></td></>}
            {canDelete && <td className={`row-actions${module === 'CREDITOS' ? ' credit-action-cell' : ''}`} data-credit-label={module === 'CREDITOS' ? 'Acciones' : undefined} data-credit-field={module === 'CREDITOS' ? 'ACCIONES' : undefined}><button type="button" className="delete-button" disabled={deletingRecord !== null || (module === 'CLIENTES' && Boolean(hiddenClientRecordsError))} onClick={() => module === 'CLIENTES' ? onDeleteClient(row) : onDelete(module, row)} aria-label={module === 'CLIENTES' ? 'Eliminar cliente' : `Borrar registro de ${module}`} title={module === 'CLIENTES' ? 'Eliminar cliente' : 'Borrar registro'}>{deletingRecord === recordKey ? 'Borrando…' : module === 'CLIENTES' ? 'Eliminar cliente' : 'Borrar'}</button></td>}
          </tr>
        })}</tbody>
      </table></div>
      <footer className="table-footer"><span>Mostrando <strong>{displayRows.length ? page * pageSize + 1 : 0}–{Math.min((page + 1) * pageSize, displayRows.length)}</strong> de <strong>{displayRows.length}</strong> filtrados{displayRows.length !== totalRows ? <> (total: <strong>{totalRows}</strong>)</> : null}</span>{pageCount > 1 && <div className="table-pagination"><button className="small-action" type="button" disabled={page === 0} onClick={() => setPage((current) => current - 1)}>Anterior</button><span>Página {page + 1} de {pageCount}</span><button className="small-action" type="button" disabled={page + 1 >= pageCount} onClick={() => setPage((current) => current + 1)}>Siguiente</button></div>}{module === 'CLIENTES' && <span className="footer-note">Para clientes del Excel, saldo al 04/11/2026 más movimientos posteriores; los demás se calculan desde CREDITOS.</span>}</footer>
    </section>}
  </section>
}

function CreditStockDeleteModal({ row, busy, onClose, onConfirm }: { row: WorkbookRow; busy: boolean; onClose: () => void; onConfirm: (adjustStock: boolean) => void }) {
  const quantity = Number(row.CANT ?? row.CANTIDAD ?? 0)
  const isReturn = isReturnType(row.TIPO)
  const movementDate = rowDateValue(row.FECHA)
  const movement = movementDate ? new Date(movementDate) : null
  const currentMonth = movement !== null && movement.getMonth() === new Date().getMonth() && movement.getFullYear() === new Date().getFullYear()
  const adjustLabel = isReturn ? `Ajustar stock (descontar ${number.format(quantity)} devueltas)` : `Ajustar stock (reponer ${number.format(quantity)} unidades)`
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <section className="modal stock-delete-modal" role="dialog" aria-modal="true" aria-labelledby="credit-stock-delete-title">
      <div className="modal-heading"><div><p className="eyebrow">ELIMINAR CRÉDITO</p><h2 id="credit-stock-delete-title">¿Qué hacemos con el stock?</h2><p>{String(row.NOMBRE ?? '')} · {String(row.CODIGO ?? '')} · {movement ? movement.toLocaleDateString('es-CO') : 'Sin fecha'}</p></div><button className="close-button" type="button" onClick={onClose} disabled={busy} aria-label="Cancelar">×</button></div>
      <p className="form-hint">Al eliminar, el saldo del cliente se recalcula y se refleja en CLIENTES. {currentMonth ? 'El movimiento es de este mes.' : 'El movimiento es de un mes anterior.'} Elige si también debe cambiar el inventario.</p>
      <div className="modal-actions stock-delete-actions"><button className="secondary-button" type="button" onClick={onClose} disabled={busy}>Cancelar</button><button className="secondary-button" type="button" onClick={() => onConfirm(false)} disabled={busy}>Eliminar sin ajustar stock</button><button className="delete-button" type="button" onClick={() => onConfirm(true)} disabled={busy}>{adjustLabel}</button></div>
    </section>
  </div>
}

function ValidationHistoryDeleteModal({ person, row, personBalance, busy, onClose, onConfirm }: { person: string; row: ValidationCreditTransaction; personBalance: number; busy: boolean; onClose: () => void; onConfirm: (adjustStock: boolean) => void }) {
  const canAdjustStock = row.tipo === 'COMPRA' && Number(row.cantidad) > 0 && Boolean(row.codigo?.trim())
  const movementValue = row.tipo === 'ABONO' ? row.abona : row.total || row.valor
  const adjustedBalance = personBalance + (row.tipo === 'ABONO' ? row.abona : -movementValue)
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <section className="modal stock-delete-modal" role="dialog" aria-modal="true" aria-labelledby="validation-history-delete-title">
      <div className="modal-heading"><div><p className="eyebrow">VALIDACION CREDITOS</p><h2 id="validation-history-delete-title">Eliminar registro histórico</h2><p>{person} · {row.fecha ?? 'Sin fecha'} · {row.detalle ?? row.tipo}</p></div><button className="close-button" type="button" onClick={onClose} disabled={busy} aria-label="Cancelar">×</button></div>
      <p className="form-hint">Saldo actual: {currency.format(personBalance)}. Saldo después de eliminar: {currency.format(adjustedBalance)}. El saldo se recalculará y se reflejará en la ficha del cliente.</p>
      {canAdjustStock ? <p className="form-hint">Este registro tiene código {row.codigo} y {number.format(row.cantidad)} unidades. Elige si quieres reponerlas al inventario.</p> : <p className="form-hint">Este registro no tiene código y cantidad válidos para ajustar inventario; al eliminarlo, el stock no cambiará.</p>}
      <div className="modal-actions stock-delete-actions"><button className="secondary-button" type="button" onClick={onClose} disabled={busy}>Cancelar</button><button className="secondary-button" type="button" onClick={() => onConfirm(false)} disabled={busy}>Eliminar sin aumentar stock</button>{canAdjustStock && <button className="delete-button" type="button" onClick={() => onConfirm(true)} disabled={busy}>Eliminar y reponer {number.format(row.cantidad)} unidades</button>}</div>
    </section>
  </div>
}

type CodeSearchOption = { code: string; detail: string; hint?: string; disabled?: boolean }

function SearchableClientInput({ value, options, required, onChange, onSelect }: { value: string; options: string[]; required?: boolean; onChange: (value: string) => void; onSelect: (value: string) => void }) {
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const needle = normalizeClientName(value)
  const matchingOptions = options.filter((name) => !needle || normalizeClientName(name).includes(needle)).sort(compareClientNames)
  const choose = (name: string) => {
    setIsOpen(false)
    setActiveIndex(-1)
    onSelect(name)
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && matchingOptions.length) {
      event.preventDefault()
      setIsOpen(true)
      setActiveIndex((index) => Math.min(index + 1, matchingOptions.length - 1))
    } else if (event.key === 'ArrowUp' && matchingOptions.length) {
      event.preventDefault()
      setIsOpen(true)
      setActiveIndex((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter' && isOpen && matchingOptions.length) {
      event.preventDefault()
      choose(matchingOptions[activeIndex] ?? matchingOptions[0])
    } else if (event.key === 'Escape') {
      setIsOpen(false)
    }
  }
  return <div className="credit-client-picker">
    <input type="text" role="combobox" aria-label="Buscar persona por nombre" aria-autocomplete="list" aria-expanded={isOpen} aria-controls="credit-client-picker-options" aria-activedescendant={isOpen && activeIndex >= 0 ? `credit-client-picker-option-${activeIndex}` : undefined} autoComplete="off" required={required} value={value} placeholder="Escribe o pega el nombre de la persona" onFocus={() => setIsOpen(true)} onBlur={() => window.setTimeout(() => setIsOpen(false), 140)} onChange={(event) => { setActiveIndex(-1); setIsOpen(true); onChange(event.target.value) }} onKeyDown={handleKeyDown} />
    {isOpen && <div className="credit-client-picker-options" id="credit-client-picker-options" role="listbox" aria-label="Personas en orden alfabético">
      {matchingOptions.length ? matchingOptions.map((name, index) => <button key={name} id={`credit-client-picker-option-${index}`} type="button" role="option" aria-selected={value === name} className={index === activeIndex ? 'active' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(name)}>{name}</button>) : <span className="client-name-empty">No hay personas coincidentes</span>}
    </div>}
  </div>
}

function SearchableCodeInput({ value, options, onChange, onSelect, allowCustom, required, disabled, placeholder, ariaLabel }: { value: string; options: CodeSearchOption[]; onChange: (value: string) => void; onSelect: (option: CodeSearchOption) => void; allowCustom?: boolean; required?: boolean; disabled?: boolean; placeholder: string; ariaLabel: string }) {
  const [query, setQuery] = useState(value)
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  useEffect(() => setQuery(value), [value])
  const needle = query.trim().toLocaleLowerCase('es')
  const matchingOptions = options.filter((option) => !needle || `${option.code} ${option.detail}`.toLocaleLowerCase('es').includes(needle)).slice(0, 40)
  const choose = (option: CodeSearchOption) => {
    if (option.disabled) return
    setQuery(option.code)
    setIsOpen(false)
    setActiveIndex(-1)
    onSelect(option)
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && matchingOptions.length) {
      event.preventDefault()
      setIsOpen(true)
      setActiveIndex((index) => Math.min(index + 1, matchingOptions.length - 1))
    } else if (event.key === 'ArrowUp' && matchingOptions.length) {
      event.preventDefault()
      setIsOpen(true)
      setActiveIndex((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter' && isOpen && matchingOptions.length) {
      event.preventDefault()
      choose(matchingOptions[activeIndex] ?? matchingOptions[0])
    } else if (event.key === 'Escape') setIsOpen(false)
  }
  return <div className="code-search-field">
    <input type="text" role="combobox" aria-label={ariaLabel} aria-autocomplete="list" aria-expanded={isOpen} aria-controls="code-search-options" aria-activedescendant={isOpen && activeIndex >= 0 ? `code-search-option-${activeIndex}` : undefined} autoComplete="off" required={required} disabled={disabled} value={query} placeholder={placeholder} onFocus={() => setIsOpen(true)} onBlur={() => window.setTimeout(() => setIsOpen(false), 140)} onChange={(event) => { const next = event.target.value; setQuery(next); setActiveIndex(-1); setIsOpen(true); onChange(next) }} onKeyDown={handleKeyDown} />
    {isOpen && (matchingOptions.length > 0 || !allowCustom) && <div className="code-search-options" id="code-search-options" role="listbox" aria-label="Códigos y detalles">
      {matchingOptions.length ? matchingOptions.map((option, index) => <button key={`${option.code}-${index}`} id={`code-search-option-${index}`} type="button" role="option" aria-selected={index === activeIndex} disabled={option.disabled} className={index === activeIndex ? 'active' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(option)}><strong>{option.code}</strong><span>{option.detail}</span>{option.hint && <small>{option.hint}</small>}</button>) : <span className="code-search-empty">No hay coincidencias para esta búsqueda</span>}
    </div>}
  </div>
}

function CreditFilterControls({ rows, filters, onChange }: { rows: WorkbookRow[]; filters: CreditFilters; onChange: (filters: CreditFilters) => void }) {
  const [isNameOptionsOpen, setIsNameOptionsOpen] = useState(false)
  const [activeNameIndex, setActiveNameIndex] = useState(-1)
  const names = Array.from(new Set(rows.map((row) => String(row.NOMBRE ?? '').trim()).filter(Boolean))).sort(compareClientNames)
  const matchingNames = names.filter((name) => name.toLocaleLowerCase('es').includes(filters.name.trim().toLocaleLowerCase('es')))
  const types = Array.from(new Set(rows.map((row) => String(row.TIPO ?? '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'es'))
  const update = (key: keyof CreditFilters, value: string) => onChange({ ...filters, [key]: value })
  const hasFilters = Object.values(filters).some(Boolean)
  const handleNameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && matchingNames.length) {
      event.preventDefault()
      setIsNameOptionsOpen(true)
      setActiveNameIndex((index) => Math.min(index + 1, matchingNames.length - 1))
    } else if (event.key === 'ArrowUp' && matchingNames.length) {
      event.preventDefault()
      setIsNameOptionsOpen(true)
      setActiveNameIndex((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter' && isNameOptionsOpen && matchingNames.length) {
      event.preventDefault()
      update('name', matchingNames[activeNameIndex] ?? matchingNames[0])
      setIsNameOptionsOpen(false)
    } else if (event.key === 'Escape') {
      setIsNameOptionsOpen(false)
    }
  }
  const setDateRange = (range: 'month' | '30days') => {
    const today = new Date()
    const start = range === 'month' ? new Date(today.getFullYear(), today.getMonth(), 1) : new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29)
    const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    onChange({ ...filters, from: localDate(start), to: localDate(today) })
  }
  return <div className="credit-filters" aria-label="Filtros de créditos">
    <label>Nombre<div className="client-name-field">
      <input className="client-name-search" aria-label="Buscar movimientos por nombre" role="combobox" aria-autocomplete="list" aria-expanded={isNameOptionsOpen} aria-controls="credit-client-name-options" aria-activedescendant={isNameOptionsOpen && matchingNames.length && activeNameIndex >= 0 ? `credit-client-option-${activeNameIndex}` : undefined} placeholder="Escribe o elige una persona" value={filters.name} onFocus={() => setIsNameOptionsOpen(true)} onBlur={() => window.setTimeout(() => setIsNameOptionsOpen(false), 150)} onChange={(event) => { update('name', event.target.value); setActiveNameIndex(-1); setIsNameOptionsOpen(true) }} onKeyDown={handleNameKeyDown} />
      <select className="client-name-mobile" aria-label="Filtrar créditos por cliente" value={names.includes(filters.name) ? filters.name : ''} onChange={(event) => update('name', event.target.value)}>
        <option value="">Todos los clientes</option>
        {names.map((name) => <option key={name} value={name}>{name}</option>)}
      </select>
      {isNameOptionsOpen && <div className="client-name-options" id="credit-client-name-options" role="listbox" aria-label="Nombres de clientes">
        {matchingNames.length ? matchingNames.map((name, index) => <button key={name} id={`credit-client-option-${index}`} type="button" role="option" aria-selected={filters.name === name} className={index === activeNameIndex ? 'active' : ''} onPointerDown={(event) => event.preventDefault()} onMouseDown={(event) => event.preventDefault()} onClick={() => { update('name', name); setIsNameOptionsOpen(false) }}>{name}</button>) : <span className="client-name-empty">No hay clientes coincidentes</span>}
      </div>}
    </div></label>
    <label>Código o detalle<input aria-label="Buscar créditos por código o detalle" type="search" placeholder="Ej. JGT o juguete" value={filters.product} onChange={(event) => update('product', event.target.value)} /></label>
    <label>Tipo<select aria-label="Filtrar créditos por tipo" value={filters.type} onChange={(event) => update('type', event.target.value)}><option value="">Todos los tipos</option>{types.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
    <label>Desde<input aria-label="Fecha desde" type="date" value={filters.from} onChange={(event) => update('from', event.target.value)} /></label>
    <label>Hasta<input aria-label="Fecha hasta" type="date" value={filters.to} onChange={(event) => update('to', event.target.value)} /></label>
    <div className="credit-filter-actions"><div className="credit-date-presets"><button type="button" onClick={() => setDateRange('month')}>Este mes</button><button type="button" onClick={() => setDateRange('30days')}>Últimos 30 días</button></div>{hasFilters && <button type="button" className="clear-credit-filters" onClick={() => onChange({ name: '', product: '', type: '', from: '', to: '' })}>Limpiar filtros</button>}</div>
  </div>
}

type MonthlyBalance = { month: number; year: number; openingFund: number; cashSales: number; transferSales: number; otherCollections: number; totalCollections: number; availableCash: number; creditsGranted: number; payments: number; returns: number; refunds: number; receivables: number; productionCosts: number; nonProducedCosts: number; fixedCosts: number; operatingExpenses: number; totalExpenses: number; remainingCash: number; withdrawalRate: number; suggestedWithdrawal: number; nextFund: number }
const monthLabels = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const septemberBalance: MonthlyBalance = { month: 9, year: 2026, openingFund: 1000000, cashSales: 543000, transferSales: 1989000, otherCollections: 0, totalCollections: 2532000, availableCash: 3532000, creditsGranted: 1198000, payments: 2532000, returns: 0, refunds: 0, receivables: 5181000, productionCosts: 0, nonProducedCosts: 985000, fixedCosts: 9500, operatingExpenses: 108000, totalExpenses: 1093000, remainingCash: 2439000, withdrawalRate: 0.2, suggestedWithdrawal: 506400, nextFund: 1932600 }
function parseBalanceSnapshot(value: unknown): MonthlyBalance | null {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    if (parsed && typeof parsed === 'object' && 'month' in parsed && 'year' in parsed && 'nextFund' in parsed) return { refunds: 0, otherCollections: 0, ...parsed } as MonthlyBalance
  } catch { }
  return null
}
function returnMarker(value: CellValue): { refund: number; returned: number } {
  const text = String(value ?? '')
  const refund = Number(text.match(/REEMBOLSO:(\d+(?:\.\d+)?)/i)?.[1] ?? 0)
  const returned = Number(text.match(/DEVUELTO:(\d+(?:\.\d+)?)/i)?.[1] ?? 0)
  return { refund, returned }
}
function toRemoteBalance(report: MonthlyBalance) {
  return {
    'Mes a consultar (1-12)': report.month,
    'Año a consultar': report.year,
    'Retiro sugerido': report.withdrawalRate * 100,
    'Período seleccionado': `${monthLabels[report.month - 1]} ${report.year}`,
    'Estado del período': JSON.stringify(report),
    'Fondo del mes anterior': report.openingFund,
    'Caja disponible incluyendo fondo anterior': report.availableCash,
    'Ventas registradas - efectivo': report.cashSales,
    'Ventas registradas - transferencias': report.transferSales,
    'Ventas registradas - otros medios': report.otherCollections,
    'Total ventas registradas': report.totalCollections,
    'Créditos otorgados en el mes': report.creditsGranted,
    'Abonos cobrados en el mes': report.payments,
    'Total salidas de caja del mes': report.totalExpenses,
    'Resultado después de gastos': report.remainingCash,
    'Fondo / capital que queda en el negocio': report.nextFund,
  }
}
async function persistRemoteBalance(report: MonthlyBalance) {
  if (!supabase) return
  const monthColumn = 'Mes a consultar (1-12)'
  const yearColumn = 'Año a consultar'
  const existing = await supabase.from('balance').select('*')
  if (existing.error) throw new Error(existing.error.message)
  const matches = (existing.data ?? []).filter((row) => Number(row[monthColumn]) === report.month && Number(row[yearColumn]) === report.year)
  const payload = toRemoteBalance(report)
  if (matches.length) {
    const update = await supabase.from('balance').update(payload).eq('id', matches[0].id)
    if (update.error) throw new Error(update.error.message)
    for (const duplicate of matches.slice(1)) {
      const remove = await supabase.from('balance').delete().eq('id', duplicate.id)
      if (remove.error) throw new Error(remove.error.message)
    }
    return
  }
  const insert = await supabase.from('balance').insert(payload)
  if (insert.error) throw new Error(insert.error.message)
}
function reportWriteStatus(success: boolean, message?: string) {
  window.dispatchEvent(new CustomEvent('sportivos:write-status', { detail: { success, message } }))
}
function calculateBalance(data: Record<ModuleKey, WorkbookRow[]>, month: number, year: number, openingFund: number, withdrawalRate: number): MonthlyBalance {
  const sales = data.VENTAS.filter((row) => matchesPeriod(row, month, year))
  const credits = data.CREDITOS.filter((row) => matchesPeriod(row, month, year))
  const expenses = data.GASTOS.filter((row) => matchesPeriod(row, month, year))
  const entries = data.ENTRADAS.filter((row) => matchesPeriod(row, month, year))
  const sum = (items: WorkbookRow[], key: string) => items.reduce((total, row) => total + Number(row[key] ?? 0), 0)
  const paymentRows = [...sales.map((row) => ({ row, method: row.MEDIO_DE_PAGO, amountKey: 'TOTAL' })), ...credits.filter((row) => isAbonoType(row.TIPO)).map((row) => ({ row, method: row['MEDIO PAGO'], amountKey: 'VALOR' }))]
  const cashSales = paymentRows.filter((item) => paymentCategory(item.method) === 'cash').reduce((total, item) => total + Number(item.row[item.amountKey] ?? 0), 0)
  const transferSales = paymentRows.filter((item) => paymentCategory(item.method) === 'transfer').reduce((total, item) => total + Number(item.row[item.amountKey] ?? 0), 0)
  const otherCollections = paymentRows.filter((item) => paymentCategory(item.method) === 'other').reduce((total, item) => total + Number(item.row[item.amountKey] ?? 0), 0)
  const totalCollections = cashSales + transferSales + otherCollections
  const creditsGranted = sum(credits.filter((row) => isCreditType(row.TIPO)), 'VALOR')
  const payments = sum(credits.filter((row) => row.TIPO === 'Abono'), 'VALOR')
  const receivables = Math.max(0, data.CREDITOS.reduce((total, row) => total + (isCreditType(row.TIPO) ? Number(row.VALOR ?? 0) : isAbonoType(row.TIPO) || isReturnType(row.TIPO) ? -Number(row.VALOR ?? 0) : 0), 0))
  const nonProducedCodes = new Set(data.COSTOS_NO_PRODUCIDOS.map((row) => String(row.CODIGO ?? '').trim().toLowerCase()).filter(Boolean))
  const nonProducedEntries = entries.filter((row) => nonProducedCodes.has(String(row.CODIGO ?? '').trim().toLowerCase()))
  const codedExpenses = expenses.filter((row) => Boolean(getExpenseCode(row, data)))
  const nonProducedExpenseRows = codedExpenses.filter((row) => nonProducedCodes.has(getExpenseCode(row, data).toLowerCase()))
  const productionExpenseRows = codedExpenses.filter((row) => !nonProducedCodes.has(getExpenseCode(row, data).toLowerCase()))
  const nonProducedCosts = entries.reduce((total, row) => total + (Number(row.Columna1 ?? 0) || Number(row.CANTIDAD ?? 0) * Number(row.PRECIO ?? 0)), 0) + sum(nonProducedExpenseRows, 'VALOR')
  const operatingExpenses = sum(expenses.filter((row) => !getExpenseCode(row, data)), 'VALOR')
  const productionCosts = sum(productionExpenseRows, 'VALOR')
  const fixedCosts = nonProducedEntries.reduce((total, row) => {
    const catalog = data.COSTOS_NO_PRODUCIDOS.find((item) => String(item.CODIGO ?? '').trim().toLowerCase() === String(row.CODIGO ?? '').trim().toLowerCase())
    return total + Number(row.CANTIDAD ?? 0) * Number(catalog?.['COSTO FIJO'] ?? 0)
  }, 0) + nonProducedExpenseRows.reduce((total, row) => {
    const expenseCode = getExpenseCode(row, data).toLowerCase()
    const catalog = data.COSTOS_NO_PRODUCIDOS.find((item) => String(item.CODIGO ?? '').trim().toLowerCase() === expenseCode)
    return total + Number(row.CANTIDAD ?? 0) * Number(catalog?.['COSTO FIJO'] ?? 0)
  }, 0)
  const refunds = credits.filter((row) => isReturnType(row.TIPO)).reduce((total, row) => total + returnMarker(row.COMENTARIO).refund, 0)
  const totalExpenses = productionCosts + nonProducedCosts + operatingExpenses + refunds
  const suggestedWithdrawal = Math.round(totalCollections * withdrawalRate)
  const returns = credits.filter((row) => isReturnType(row.TIPO)).reduce((total, row) => total + Number(row.VALOR ?? 0) + returnMarker(row.COMENTARIO).refund, 0)
  const remainingCash = openingFund + totalCollections - totalExpenses
  return { month, year, openingFund, cashSales, transferSales, otherCollections, totalCollections, availableCash: openingFund + totalCollections, creditsGranted, payments, returns, refunds, receivables, productionCosts, nonProducedCosts, fixedCosts, operatingExpenses, totalExpenses, remainingCash, withdrawalRate, suggestedWithdrawal, nextFund: remainingCash - suggestedWithdrawal }
}
function paymentCategory(value: CellValue | undefined): 'cash' | 'transfer' | 'other' | null {
  const method = String(value ?? '').trim().toLocaleLowerCase()
  if (!method) return null
  if (method.includes('efectivo')) return 'cash'
  if (method.includes('transfer')) return 'transfer'
  return 'other'
}
function ReportView({ data }: { data: Record<ModuleKey, WorkbookRow[]> }) {
  const [month, setMonth] = useState(() => currentPeriod().month)
  const [year, setYear] = useState(() => currentPeriod().year)
  const [openingFund, setOpeningFund] = useState(() => septemberBalance.nextFund)
  const [withdrawalPercent, setWithdrawalPercent] = useState(20)
  const [history, setHistory] = useState<MonthlyBalance[]>([])
  const [generated, setGenerated] = useState<MonthlyBalance | null>(null)
  const [viewing, setViewing] = useState<MonthlyBalance | null>(null)
  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    void (async () => {
      const result = await supabase.from('balance').select('*')
      if (result.error) throw new Error(result.error.message)
      if (cancelled) return
      const remoteHistory = (result.data ?? []).map((row) => parseBalanceSnapshot(row['Estado del período'])).filter((item): item is MonthlyBalance => item !== null)
      const historyByPeriod = new Map<string, MonthlyBalance>()
      const duplicatePeriods = new Set<string>()
      for (const item of remoteHistory) {
        const key = `${item.year}-${item.month}`
        if (historyByPeriod.has(key)) duplicatePeriods.add(key)
        historyByPeriod.set(key, item)
      }
      const uniqueRemoteHistory = [...historyByPeriod.values()]
      for (const item of uniqueRemoteHistory) if (duplicatePeriods.has(`${item.year}-${item.month}`)) await persistRemoteBalance(item)
      const sortedHistory = uniqueRemoteHistory.sort((a, b) => a.year - b.year || a.month - b.month)
      if (!cancelled) {
        setHistory(sortedHistory)
      }
    })().catch((error) => {
      if (!cancelled) window.dispatchEvent(new CustomEvent('sportivos:notice', { detail: 'No se pudo sincronizar el historial de balances: ' + (error instanceof Error ? error.message : 'error de conexión') }))
    })
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    const current = currentPeriod()
    if (month !== current.month || year !== current.year) return
    const prior = history.find((item) => {
      const previous = previousPeriod(current.month, current.year)
      return item.month === previous.month && item.year === previous.year
    })
    if (prior) setOpeningFund(prior.nextFund)
  }, [history, month, year])
  const report = generated?.month === month && generated.year === year ? generated : calculateBalance(data, month, year, openingFund, withdrawalPercent / 100)
  const hasCurrentReport = generated?.month === month && generated.year === year
  const title = `ESTADO DE RESULTADOS Y FLUJO DE CAJA: ${monthLabels[month - 1]?.toUpperCase()} ${year}`
  function balanceInputError() {
    if (!Number.isInteger(month) || month < 1 || month > 12) return 'Selecciona un mes válido.'
    if (!Number.isInteger(year) || year < 2000 || year > 2200) return 'El año debe estar entre 2000 y 2200.'
    if (!Number.isFinite(openingFund) || openingFund < 0) return 'El fondo inicial no puede ser negativo.'
    if (!Number.isFinite(withdrawalPercent) || withdrawalPercent < 0 || withdrawalPercent > 100) return 'El porcentaje de retiro debe estar entre 0 y 100.'
    return ''
  }
  function updatePeriod(nextMonth: number, nextYear: number) {
    setMonth(nextMonth); setYear(nextYear); setGenerated(null)
    const priorMonth = nextMonth === 1 ? 12 : nextMonth - 1; const priorYear = nextMonth === 1 ? nextYear - 1 : nextYear
    const prior = history.find((item) => item.month === priorMonth && item.year === priorYear)
    if (prior) setOpeningFund(prior.nextFund)
  }
  function generate() {
    const error = balanceInputError()
    if (error) { window.dispatchEvent(new CustomEvent('sportivos:notice', { detail: error })); return }
    setGenerated(calculateBalance(data, month, year, openingFund, withdrawalPercent / 100))
  }
  async function save() {
    const inputError = balanceInputError()
    if (inputError) {
      window.dispatchEvent(new CustomEvent('sportivos:notice', { detail: inputError }))
      return
    }
    if (!supabase) {
      reportWriteStatus(false, 'No hay conexión con la base compartida para guardar el balance.')
      window.dispatchEvent(new CustomEvent('sportivos:notice', { detail: 'No se guardó: falta conexión con la base compartida.' }))
      return
    }
    const current = calculateBalance(data, month, year, openingFund, withdrawalPercent / 100)
    const next = [...history.filter((item) => item.month !== month || item.year !== year), current].sort((a, b) => a.year - b.year || a.month - b.month)
    try {
      await persistRemoteBalance(current)
      reportWriteStatus(true)
      setHistory(next); setGenerated(current)
      window.dispatchEvent(new CustomEvent('sportivos:balance-updated'))
      window.dispatchEvent(new CustomEvent('sportivos:notice', { detail: 'Balance guardado en la base compartida para todos tus dispositivos.' }))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'error de conexión'
      reportWriteStatus(false, 'La base está en línea, pero no se pudo guardar el balance. ' + message)
      window.dispatchEvent(new CustomEvent('sportivos:notice', { detail: 'No se pudo guardar en la base compartida: ' + message }))
    }
  }
  function viewSaved(item: MonthlyBalance) { setViewing(item) }
  async function deleteSaved(item: MonthlyBalance) {
    if (!window.confirm(`¿Eliminar el balance de ${monthLabels[item.month - 1]} ${item.year}? Esta acción no se puede deshacer.`)) return
    try {
      if (!supabase) throw new Error('No hay conexión con la base compartida.')
      const payload = toRemoteBalance(item)
      const yearColumn = Object.keys(payload).find((key) => key.toLowerCase().includes('consultar') && key !== 'Mes a consultar (1-12)')
      if (!yearColumn) throw new Error('No se encontró la columna del año en el balance.')
      const monthColumn = Object.keys(payload).find((key) => key.startsWith('Mes a consultar'))
      if (!monthColumn) throw new Error('No se encontró la columna del mes en el balance.')
      const result = await supabase.from('balance').select('*')
      if (result.error) throw new Error(result.error.message)
      const matches = (result.data ?? []).filter((row) => Number(row[monthColumn]) === item.month && Number(row[yearColumn]) === item.year)
      for (const match of matches) {
        const remove = await supabase.from('balance').delete().eq('id', match.id)
        if (remove.error) throw new Error(remove.error.message)
      }
      reportWriteStatus(true)
      const next = history.filter((saved) => saved.month !== item.month || saved.year !== item.year)
      setHistory(next)
      if (generated?.month === item.month && generated.year === item.year) setGenerated(null)
      window.dispatchEvent(new CustomEvent('sportivos:balance-updated'))
      window.dispatchEvent(new CustomEvent('sportivos:notice', { detail: 'Balance eliminado.' }))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'error'
      reportWriteStatus(false, 'La base está en línea, pero no se pudo eliminar el balance. ' + message)
      window.dispatchEvent(new CustomEvent('sportivos:notice', { detail: 'No se pudo eliminar el balance: ' + message }))
    }
  }
  return <div className="balance-workspace"><section className="balance-controls"><label>Mes<select value={month} onChange={(event) => updatePeriod(Number(event.target.value), year)}>{monthLabels.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}</select></label><label>Año<input type="number" min="2000" max="2200" value={year} onChange={(event) => updatePeriod(month, Number(event.target.value))} /></label><label>Fondo mes anterior<input type="number" min="0" value={openingFund} onChange={(event) => { setOpeningFund(Number(event.target.value)); setGenerated(null) }} /></label><label>% retiro sugerido<input type="number" min="0" max="100" step="0.1" value={withdrawalPercent} onChange={(event) => { setWithdrawalPercent(Number(event.target.value)); setGenerated(null) }} /></label><div className="balance-actions"><button className="secondary-button" type="button" onClick={generate}>Generar balance</button><button className="primary-button" type="button" onClick={save}>Guardar balance</button></div></section>
    {hasCurrentReport ? <section className="excel-balance" aria-label="Balance mensual con formato del Excel"><div className="balance-sheet-top"><span><b>% Retiro Sugerido:</b> {number.format(report.withdrawalRate * 100)}%</span><span><b>Fondo Mes Anterior:</b> {currency.format(report.openingFund)}</span></div><h2 className="balance-sheet-title">{title}</h2>
      <BalanceSection title="1. FLUJO DE CAJA Y DISPONIBILIDAD" rows={[["(+) Saldo / Fondo de Reserva Mes Anterior", report.openingFund], ["(+) Recaudo en Efectivo (Ventas + Abonos)", report.cashSales], ["(+) Recaudo en Transferencias (Ventas + Abonos)", report.transferSales], ["(+) Recaudo en Otros medios (Ventas + Abonos)", report.otherCollections], ["(=) Total Recaudo Generado Este Mes", report.totalCollections, 'gray'], ["(=) TOTAL CAJA DISPONIBLE", report.availableCash, 'blue']]} />
      <BalanceSection title="2. CUENTAS POR COBRAR (CxC) - [INFORMATIVO]" rows={[["(+) Créditos Otorgados (Solo en este mes)", report.creditsGranted], ["(-) Abonos Recibidos (Solo en este mes)", report.payments], ["(-) Devoluciones Realizadas (Solo en este mes)", report.returns], ["(=) Saldo Total Pendiente de Cobro (Histórico)", report.receivables, 'gray']]} />
      <BalanceSection title="3. COSTOS Y GASTOS OPERATIVOS" rows={[["(-) Costos de Producción (Materia Prima)", report.productionCosts], ["(-) Costos No Producidos (Total Compras)", report.nonProducedCosts], ["    + De los cuales: Costos Fijos", report.fixedCosts], ["(-) Gastos Operativos (Viáticos)", report.operatingExpenses], ["(-) Reembolsos entregados por devoluciones", report.refunds], ["(=) TOTAL EGRESOS DEL MES", report.totalExpenses, 'peach'], ["(=) CAJA RESTANTE TRAS PAGAR EGRESOS", report.remainingCash, 'blue']]} />
      <BalanceSection title="4. RESULTADO FINANCIERO Y DISTRIBUCIÓN" rows={[["(+) Total Recaudo Generado Este Mes", report.totalCollections], [`(-) Retiro Sugerido (${number.format(report.withdrawalRate * 100)}% del Recaudo)`, report.suggestedWithdrawal, 'yellow'], ["(=) NUEVO FONDO / CAPITAL PRÓXIMO MES", report.nextFund, 'blue']]} />
      <p className="balance-before-withdrawal"><span>Dinero que debo tener antes del retiro:</span><strong>{currency.format(report.remainingCash)}</strong></p>
      <p className="balance-note">El balance incluye las compras registradas en ENTRADAS del mes. GASTOS se separa entre materia prima codificada y gastos operativos sin código.</p></section> : <section className="balance-empty"><strong>Balance sin generar</strong><span>Elige el mes y presiona “Generar balance” para ver el resumen; después puedes guardarlo.</span></section>}
    <section className="balance-history"><div className="section-heading"><div><h2>Balances guardados</h2><p>Los cierres quedan dentro de este mismo módulo, uno por mes.</p></div></div><div className="table-wrap"><table><thead><tr><th>PERIODO</th><th>FONDO INICIAL</th><th>TOTAL RECAUDO</th><th>RETIRO SUGERIDO</th><th>FONDO PRÓXIMO MES</th><th>ACCIONES</th></tr></thead><tbody>{history.map((item) => <tr key={`${item.year}-${item.month}`}><td>{monthLabels[item.month - 1]} {item.year}</td><td>{currency.format(item.openingFund)}</td><td>{currency.format(item.totalCollections)}</td><td>{currency.format(item.suggestedWithdrawal)}</td><td>{currency.format(item.nextFund)}</td><td><div className="client-actions"><button type="button" className="small-action" onClick={() => viewSaved(item)}>Ver balance</button><button type="button" className="small-action danger-action" onClick={() => void deleteSaved(item)}>Eliminar</button></div></td></tr>)}</tbody></table></div></section>
    {viewing && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setViewing(null) }}><section className="modal balance-summary-modal" role="dialog" aria-modal="true" aria-labelledby="saved-balance-title"><div className="modal-heading"><div><p className="eyebrow">RESUMEN GUARDADO</p><h2 id="saved-balance-title">{monthLabels[viewing.month - 1]} {viewing.year}</h2></div><button className="close-button" type="button" onClick={() => setViewing(null)} aria-label="Cerrar">×</button></div><div className="saved-balance-grid"><div><span>Recaudo del mes</span><strong>{currency.format(viewing.totalCollections)}</strong></div><div><span>En efectivo</span><strong>{currency.format(viewing.cashSales)}</strong></div><div><span>En transferencias</span><strong>{currency.format(viewing.transferSales)}</strong></div><div><span>En otros medios</span><strong>{currency.format(viewing.otherCollections)}</strong></div><div><span>Compras y gastos</span><strong>{currency.format(viewing.totalExpenses)}</strong></div><div><span>Saldo de caja tras gastos</span><strong>{currency.format(viewing.remainingCash)}</strong></div><div><span>Retiro sugerido</span><strong>{currency.format(viewing.suggestedWithdrawal)}</strong></div><div><span>Fondo con que inició</span><strong>{currency.format(viewing.openingFund)}</strong></div><div><span>Fondo para el siguiente mes</span><strong>{currency.format(viewing.nextFund)}</strong></div><div><span>Créditos otorgados</span><strong>{currency.format(viewing.creditsGranted)}</strong></div><div><span>Saldo por cobrar histórico</span><strong>{currency.format(viewing.receivables)}</strong></div></div><div className="modal-actions"><button className="primary-button" type="button" onClick={() => setViewing(null)}>Cerrar resumen</button></div></section></div>}
  </div>
}

function BalanceSection({ title, rows }: { title: string; rows: Array<[string, number, string?]> }) { return <section className="balance-section"><h3>{title}</h3>{rows.map(([label, amount, tone]) => <div key={label} className={`balance-row ${tone ? `balance-${tone}` : ''}`}><span>{label}</span><strong>{currency.format(amount)}</strong></div>)}</section> }

function RecordForm({ module, data: sourceData, physicalCounts, periodPolicy, hiddenClientRecords, deletedHistoryRecords, onClose, onSave }: { module: ModuleKey; data: Record<ModuleKey, WorkbookRow[]>; physicalCounts: PhysicalInventoryCount[]; periodPolicy: PeriodPolicy; hiddenClientRecords: HiddenClientRecord[]; deletedHistoryRecords: DeletedValidationHistoryRecord[]; onClose: () => void; onSave: (row: WorkbookRow) => Promise<void> | void }) {
  const isCreditForm = module === 'CREDITOS'
  const data = useMemo(() => ({ ...sourceData, INVENTARIO_PT: getRows('INVENTARIO_PT', sourceData, physicalCounts) }), [sourceData, physicalCounts])
  const columns = useMemo(() => moduleColumns[module].filter((column) => !['ENTRADAS', 'SALIDAS', 'STOCK', 'CONTEO_FISICO', 'CONTEO FISICO', 'GANANCIA', 'TOTAL', 'DEUDA', 'Columna1', 'VALOR_PRODUCTO', 'COSTO TOTAL', 'CONSIGNACION'].includes(column.key) && !(module === 'INVENTARIO_PT' && normalizeExpenseText(column.key).replace(/[^a-z]/g, '') === 'conteofisico') && !(module === 'INVENTARIO_PT' && ['PRECIO', 'PRECIO_AL_POR_MAYOR', 'COSTO', 'Costo fijo', 'Costo MO'].includes(column.key)) && (column.key !== 'VALOR' || module === 'CREDITOS' || module === 'GASTOS') && (column.key !== 'MES' || module === 'GASTOS')), [module])
  const clientNames = useMemo(() => {
    const hidden = new Set(hiddenClientRecords.filter((record) => record.hidden_from_clients).map((record) => record.client_identity))
    const names = new Map(validationCreditPortfolio.map((person) => [normalizeClientName(person.sheet), person.sheet]))
    ;[...data.CLIENTES, ...data.CREDITOS].forEach((row) => {
      const name = String(row.NOMBRE ?? '').trim()
      const key = normalizeClientName(name)
      const identity = getValidationClientIdentity(name)
      if (key && !names.has(identity)) names.set(identity, getValidationClientSheet(name) ?? name)
    })
    return [...names.values()].filter((name) => !hidden.has(normalizeClientName(name))).sort(compareClientNames)
  }, [data.CLIENTES, data.CREDITOS, hiddenClientRecords])
  const creditKeys = ['TIPO', 'FECHA', 'NOMBRE', 'CODIGO', 'DETALLE', 'CANT', 'DESCUENTO', 'PRECIO', 'VALOR', 'COMENTARIO', 'MEDIO PAGO']
  const [values, setValues] = useState<WorkbookRow>(() => Object.fromEntries(columns.map((column) => [column.key, column.type === 'date' ? localDateInputValue() : column.key === 'TIPO' ? CREDIT_TYPE : column.key === 'MES' && module === 'GASTOS' ? 'Otro' : column.key === 'COSTO FIJO' ? 500 : column.type === 'number' ? '' : ''])) as WorkbookRow)
  const [error, setError] = useState('')
  const isAbono = isAbonoType(values.TIPO)
  const isReturn = isCreditForm && isReturnType(values.TIPO)
  const isReduction = isCreditForm && (isAbono || isReturn)
  const formColumns = useMemo(() => isCreditForm ? creditKeys.map((key) => columns.find((column) => column.key === key)).filter((column): column is Column => column !== undefined && !(isAbono && ['CODIGO', 'CANT', 'DESCUENTO', 'PRECIO'].includes(column.key)) && !(column.key === 'DETALLE' && !isAbono) && !(isReturn && column.key === 'VALOR') && !(column.key === 'VALOR' && !isAbono) && !(column.key === 'MEDIO PAGO' && !isAbono && !isReturn)) : columns, [columns, isAbono, isCreditForm, isReturn])
  const selectedClient = String(values.NOMBRE ?? '').trim()
  const deletedHistoryKeys = useMemo(() => new Set(deletedHistoryRecords.map((record) => record.transaction_key)), [deletedHistoryRecords])
  const currentDebt = useMemo(() => isCreditForm ? getClientDebt(data.CREDITOS, selectedClient, data.CLIENTES, deletedHistoryKeys) : 0, [data.CLIENTES, data.CREDITOS, deletedHistoryKeys, isCreditForm, selectedClient])
  const returnValue = Math.max(0, calculateLineTotal(values.CANT, values.PRECIO, values.DESCUENTO))
  const quantityKey = module === 'ENTRADAS' ? 'CANTIDAD' : 'CANT'
  const lineQuantity = Number(values[quantityKey] ?? 0)
  const lineUnitPrice = Number(values.PRECIO ?? 0)
  const lineDiscount = module === 'ENTRADAS' ? 0 : Number(values.DESCUENTO ?? 0)
  const lineTotal = calculateLineTotal(lineQuantity, lineUnitPrice, lineDiscount)
  const costPurchaseValue = Number(values.COSTO ?? 0)
  const costFixedValue = Number(values['COSTO FIJO'] ?? 0)
  const costTotalValue = costPurchaseValue + costFixedValue
  const costMarginValue = Number(values['PRECIO AL PUBLICO'] ?? 0) - costTotalValue
  const returnOptions = useMemo(() => isReturn
    ? refundableProducts(data.CREDITOS, selectedClient).sort((a, b) => String(a.detail ?? '').localeCompare(String(b.detail ?? ''), 'es', { sensitivity: 'base' }) || String(a.code).localeCompare(String(b.code), 'es', { sensitivity: 'base' }))
    : [], [data.CREDITOS, isReturn, selectedClient])
  const selectedReturnOption = returnOptions.find((item) => normalizeCode(item.code) === normalizeCode(values.CODIGO))
  const proportionalUnpaid = selectedReturnOption ? selectedReturnOption.outstandingValue * Number(values.CANT ?? 0) / Math.max(1, selectedReturnOption.available) : 0
  const returnDebtPart = isReturn ? Math.min(currentDebt, returnValue, proportionalUnpaid) : 0
  const refundValue = Math.max(0, returnValue - returnDebtPart)
  const transactionValue = isReturn ? returnValue : isCreditForm && isAbono ? Number(values.VALOR ?? 0) : Number(values.VALOR ?? 0) || calculateLineTotal(values.CANT, values.PRECIO, values.DESCUENTO)
  const projectedDebt = currentDebt + (isReturn ? -returnDebtPart : isAbono ? -transactionValue : transactionValue)
  const productRows = useMemo(() => module === 'VENTAS' || module === 'ENTRADAS' || isCreditForm
    ? getRows('INVENTARIO_PT', data, physicalCounts).slice().sort(compareProductDetails)
    : [], [data, isCreditForm, module, physicalCounts])
  const inventoryCodeOptions: CodeSearchOption[] = useMemo(() => data.INVENTARIO_PT
    .filter((row) => String(row.CODIGO ?? '').trim())
    .slice()
    .sort(compareProductDetails)
    .map((row) => ({ code: String(row.CODIGO).trim(), detail: String(row.DETALLE ?? '') })), [data.INVENTARIO_PT])
  const costCatalogOptions: CodeSearchOption[] = useMemo(() => module === 'COSTOS_NO_PRODUCIDOS'
    ? (() => {
      const options = new Map<string, CodeSearchOption>()
      data.INVENTARIO_PT.filter((row) => String(row.CODIGO ?? '').trim()).forEach((product) => {
        const code = String(product.CODIGO).trim()
        const currentCost = getLatestProductCost(data.COSTOS_NO_PRODUCIDOS, code)
        options.set(normalizeCode(code), { code, detail: String(product.DETALLE ?? ''), hint: currentCost ? `Costo actual ${currency.format(Number(currentCost.COSTO ?? 0))}` : 'Producto de INVENTARIO_PT' })
      })
      data.COSTOS_NO_PRODUCIDOS.filter((row) => String(row.CODIGO ?? '').trim()).forEach((cost) => {
        const code = String(cost.CODIGO).trim()
        if (!options.has(normalizeCode(code))) options.set(normalizeCode(code), { code, detail: String(cost.DETALLE ?? ''), hint: 'No existe en INVENTARIO_PT', disabled: true })
      })
      return [...options.values()].sort((a, b) => compareProductDetails({ DETALLE: a.detail, CODIGO: a.code }, { DETALLE: b.detail, CODIGO: b.code }))
    })()
    : [], [data.COSTOS_NO_PRODUCIDOS, data.INVENTARIO_PT, module])
  const selectedProduct = productRows.find((row) => normalizeCode(row.CODIGO) === normalizeCode(values.CODIGO))
  const currentStock = Number(selectedProduct?.STOCK ?? 0)
  const projectedStock = module === 'ENTRADAS' || isReturn ? currentStock + lineQuantity : currentStock - lineQuantity

  function update(key: string, value: string) {
    setValues((current) => {
      const next = { ...current, [key]: value }
      if (isCreditForm && key === 'NOMBRE' && isReturn) { next.CODIGO = ''; next.DETALLE = ''; next.CANT = ''; next.PRECIO = ''; next.DESCUENTO = '0' }
      if (isCreditForm && key === 'TIPO') {
        if (value === 'Abono') {
          next.CODIGO = ''
          next.DETALLE = ''
          next.CANT = ''
          next.DESCUENTO = '0'
          next.PRECIO = '0'
          next.VALOR = ''
          next.COMENTARIO = 'Abono'
        } else if (current.COMENTARIO === 'Abono' || current.TIPO === 'Abono') {
          next.COMENTARIO = ''
          next.DETALLE = ''
          next.VALOR = ''
        }
      }
      return next
    })
    setError('')
  }
  function updateCode(value: string) {
    const catalog = module === 'COSTOS_NO_PRODUCIDOS' ? data.COSTOS_NO_PRODUCIDOS : productRows.length ? productRows : data.INVENTARIO_PT
    const inventoryProduct = data.INVENTARIO_PT.find((row) => normalizeCode(row.CODIGO) === normalizeCode(value))
    const match = catalog.find((row) => normalizeCode(row.CODIGO) === normalizeCode(value))
    const refundable = isReturn ? returnOptions.find((row) => normalizeCode(row.code) === normalizeCode(value)) : undefined
    setValues((current) => ({ ...current, CODIGO: value, DETALLE: String(inventoryProduct?.DETALLE ?? match?.DETALLE ?? refundable?.detail ?? ''), ...(isCreditForm || module === 'ENTRADAS' ? { PRECIO: String(isCreditForm && refundable ? refundable.unitPrice : productUnitPrice(value, module, data)) } : {}) }))
    setError('')
  }
  function chooseCode(option: CodeSearchOption) {
    const refundable = isReturn ? returnOptions.find((row) => normalizeCode(row.code) === normalizeCode(option.code)) : undefined
    const existingCost = module === 'COSTOS_NO_PRODUCIDOS' ? getLatestProductCost(data.COSTOS_NO_PRODUCIDOS, option.code) : undefined
    setValues((current) => ({ ...current, CODIGO: option.code, DETALLE: option.detail, ...(isCreditForm || module === 'ENTRADAS' ? { PRECIO: String(isCreditForm && refundable ? refundable.unitPrice : productUnitPrice(option.code, module, data)) } : {}), ...(module === 'COSTOS_NO_PRODUCIDOS' ? existingCost ? { COSTO: String(existingCost.COSTO ?? ''), 'COSTO FIJO': String(existingCost['COSTO FIJO'] ?? 500), 'PRECIO AL PUBLICO': String(existingCost['PRECIO AL PUBLICO'] ?? '') } : { COSTO: '', 'PRECIO AL PUBLICO': '' } : {}) }))
    setError('')
  }
  function isDisabled(key: string) { return isCreditForm && isAbono && ['CODIGO', 'CANT', 'DESCUENTO', 'PRECIO'].includes(key) }
  function isRequired(column: { key: string; required?: boolean }) {
    if (!isCreditForm) return Boolean(column.required)
    if (['TIPO', 'FECHA', 'NOMBRE'].includes(column.key)) return true
    if (column.key === 'MEDIO PAGO') return isAbono || (isReturn && refundValue > 0)
    if (column.key === 'VALOR') return isAbono
    if (column.key === 'PRECIO') return isReturn || !isReduction
    if (isReturn) return ['CODIGO', 'CANT'].includes(column.key)
    return !isReduction && ['CODIGO', 'DETALLE', 'CANT'].includes(column.key)
  }
  function submit(event: React.FormEvent) {
    event.preventDefault()
    const missing = formColumns.filter((column) => isRequired(column) && !String(values[column.key] ?? '').trim())
    if (missing.length) { setError('Completa: ' + missing.map((column) => column.label).join(', ') + '.'); return }
    if (isCreditForm && !clientNames.some((name) => normalizeClientName(name) === normalizeClientName(values.NOMBRE))) {
      setError('Busca y selecciona una persona de la lista.')
      return
    }
    if (module === 'CLIENTES') {
      const identity = getValidationClientIdentity(values.NOMBRE)
      if (data.CLIENTES.some((client) => getValidationClientIdentity(client.NOMBRE) === identity)) {
        setError('Ya existe un cliente con ese nombre. Revisa la lista y selecciona el existente.')
        return
      }
    }
    if (datedOperationalModules.has(module)) {
      const dateError = validateOperationalDate(values.FECHA, periodPolicy)
      if (dateError) { setError(dateError); return }
    }
    if (module === 'INVENTARIO_PT') {
      const identityError = validateProductIdentity(values, data.INVENTARIO_PT)
      if (identityError) { setError(identityError); return }
    }
    if (module === 'ENTRADAS' && !data.INVENTARIO_PT.some((product) => normalizeCode(product.CODIGO) === normalizeCode(values.CODIGO))) { setError('El código debe existir en INVENTARIO_PT. Si es un producto nuevo, créalo primero en ese módulo.'); return }
    if (module === 'ENTRADAS' && (!Number.isFinite(lineQuantity) || lineQuantity <= 0 || !Number.isFinite(lineUnitPrice) || lineUnitPrice < 0 || !Number.isFinite(lineTotal))) { setError('La cantidad debe ser mayor a cero, el precio no puede ser negativo y el total debe ser válido.'); return }
    if (module === 'VENTAS' && (!Number.isFinite(lineQuantity) || lineQuantity <= 0 || !Number.isFinite(lineUnitPrice) || lineUnitPrice <= 0 || !Number.isFinite(lineDiscount) || lineDiscount < 0 || lineDiscount >= lineQuantity * lineUnitPrice || !Number.isFinite(lineTotal))) { setError('La cantidad y el precio deben ser mayores a cero; el descuento debe ser válido y menor que el subtotal.'); return }
    if (module === 'GASTOS' && (!Number.isFinite(Number(values.VALOR)) || Number(values.VALOR) <= 0)) { setError('El valor del gasto debe ser mayor a cero.'); return }
    if (module === 'COSTOS_NO_PRODUCIDOS' && (!Number.isFinite(Number(values.COSTO)) || Number(values.COSTO) < 0 || !Number.isFinite(Number(values['PRECIO AL PUBLICO'])) || Number(values['PRECIO AL PUBLICO']) <= 0 || !Number.isFinite(Number(values['COSTO FIJO'] ?? 0)) || Number(values['COSTO FIJO'] ?? 0) < 0)) { setError('Los costos no pueden ser negativos y el precio al público debe ser mayor a cero.'); return }
    if (module === 'COSTOS_NO_PRODUCIDOS' && !data.INVENTARIO_PT.some((product) => normalizeCode(product.CODIGO) === normalizeCode(values.CODIGO))) { setError('Selecciona un código que exista en INVENTARIO_PT para que el costo se actualice en ese producto.'); return }
    if (isCreditForm && !isReturn && (!Number.isFinite(transactionValue) || transactionValue <= 0)) { setError('Indica un valor válido mayor que cero.'); return }
    if (isCreditForm && !isReduction && (!Number.isFinite(lineQuantity) || lineQuantity <= 0 || !Number.isFinite(lineUnitPrice) || lineUnitPrice <= 0 || !Number.isFinite(lineDiscount) || lineDiscount < 0 || lineDiscount >= lineQuantity * lineUnitPrice || !Number.isFinite(lineTotal))) { setError('La cantidad y el precio deben ser mayores a cero; el descuento debe ser válido y menor que el subtotal.'); return }
    if (isCreditForm && isReturn && (!Number.isFinite(lineQuantity) || lineQuantity <= 0 || !Number.isFinite(returnValue) || returnValue <= 0)) { setError('La cantidad y el valor de la devolución deben ser mayores a cero.'); return }
    if ((module === 'VENTAS' || (isCreditForm && !isReduction)) && !validateAvailableStock(values, data)) { setError('El código no tiene existencias suficientes para esta cantidad.'); return }
    if (isCreditForm && isReturn) {
      const option = returnOptions.find((item) => normalizeCode(item.code) === normalizeCode(values.CODIGO))
      if (!option) { setError('Este cliente no tiene compras pendientes de devolución para ese código.'); return }
      if (Number(values.CANT ?? 0) > option.available) { setError(`Solo se pueden devolver ${option.available} unidad(es) de este código.`); return }
      if (refundValue > 0 && !String(values['MEDIO PAGO'] ?? '').trim()) { setError('Selecciona el medio para registrar el reembolso que entregarás al cliente.'); return }
      const value = returnValue
      const note = `Devolución ${String(values.CODIGO)} | DEVUELTO:${value} | REEMBOLSO:${refundValue}`
      const row = { ...values, VALOR: returnDebtPart, COMENTARIO: note, 'MEDIO PAGO': refundValue > 0 ? String(values['MEDIO PAGO'] || 'Efectivo') : String(values['MEDIO PAGO'] ?? '') }
      void onSave(row); return
    }
    void onSave(values)
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="record-form-title">
      <div className="modal-heading">
        <div><p className="eyebrow">FORMULARIO XLSM</p><h2 id="record-form-title">Nuevo registro - {module}</h2><p>{isCreditForm ? 'Selecciona primero el tipo, como en el formulario original.' : 'Captura los campos de la hoja visible.'}</p></div>
        <button className="close-button" type="button" onClick={onClose} aria-label="Cerrar">x</button>
      </div>
      <form onSubmit={submit}>
        <div className="form-grid">{formColumns.map((column, index) => {
          const disabled = isDisabled(column.key)
          const customerSelect = isCreditForm && column.key === 'NOMBRE'
          const codeSearch = column.key === 'CODIGO'
          const codeOptions: CodeSearchOption[] = module === 'COSTOS_NO_PRODUCIDOS' ? costCatalogOptions : isReturn ? returnOptions.map((item) => ({ code: item.code, detail: item.detail, hint: `${item.available} disp.` })) : productRows.length ? productRows.map((item) => ({ code: String(item.CODIGO ?? ''), detail: String(item.DETALLE ?? ''), hint: `Stock ${Number(item.STOCK ?? 0)}`, disabled: module !== 'ENTRADAS' && Number(item.STOCK ?? 0) <= 0 })) : inventoryCodeOptions
          return <label key={column.key} className={disabled ? 'field-disabled' : ''}>{codeSearch ? 'CÓDIGO (puedes escribirlo o buscar por detalle)' : isAbono && column.key === 'DETALLE' ? 'Detalle del abono' : column.label}{isRequired(column) && <span>*</span>}
            {customerSelect
              ? <SearchableClientInput value={String(values[column.key] ?? '')} options={clientNames} required={isRequired(column)} onChange={(value) => update('NOMBRE', value)} onSelect={(name) => update('NOMBRE', name)} />
              : codeSearch ? <SearchableCodeInput value={String(values.CODIGO ?? '')} options={codeOptions} onChange={updateCode} onSelect={chooseCode} allowCustom required={isRequired(column)} disabled={disabled} placeholder="Escribe un código o busca por detalle" ariaLabel={`${column.label}: escribir código o buscar por detalle`} />
            : column.type === 'select' ? <select disabled={disabled} required={isRequired(column)} value={String(values[column.key] ?? '')} onChange={(event) => update(column.key, event.target.value)}><option value="">{column.key.includes('PAGO') ? 'Selecciona un medio de pago' : 'Selecciona una opción'}</option>{(column.options ?? []).slice().sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })).map((option) => <option key={option}>{option}</option>)}</select>
              : <input disabled={disabled} required={isRequired(column)} autoFocus={index === 0} type={column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : 'text'} min={column.type === 'date' ? periodPolicy.firstDate : undefined} max={column.type === 'date' ? periodPolicy.today : undefined} step={column.type === 'number' ? 'any' : undefined} value={String(values[column.key] ?? '')} onChange={(event) => update(column.key, event.target.value)} placeholder={column.type === 'number' ? '0' : ''} />}
          </label>
        })}</div>
        {module === 'COSTOS_NO_PRODUCIDOS' && String(values.CODIGO ?? '').trim() && <>
          <div className="quantity-preview cost-preview" aria-live="polite">
            <div><span>Costo de compra</span><strong>{currency.format(costPurchaseValue)}</strong></div>
            <div><span>Costo fijo</span><strong>{currency.format(costFixedValue)}</strong></div>
            <div><span>Costo total</span><strong>{currency.format(costTotalValue)}</strong></div>
            <div><span>Margen al público</span><strong className={costMarginValue < 0 ? 'debt-negative' : ''}>{currency.format(costMarginValue)}</strong></div>
          </div>
          <p className="form-hint">El costo actualiza los valores del producto para futuras entradas y ventas/créditos. Guardar un costo no registra mercancía ni cambia por sí solo el balance.</p>
        </>}
        {module === 'INVENTARIO_PT' && <p className="form-hint">PRECIO, costo y existencias son calculados. Los costos se consultan en COSTOS_NO_PRODUCIDOS; las hojas de costos ocultas y consignaciones no se cargan en esta PWA.</p>}
        {module === 'GASTOS' && <p className="form-hint">Si el detalle coincide con un producto del catálogo COSTOS_NO_PRODUCIDOS, el balance lo clasifica automáticamente; los demás se cuentan como gastos operativos.</p>}
        {isCreditForm && <div className="debt-preview" aria-live="polite">
          <div><span>Deuda actual de {selectedClient || 'cliente'}</span><strong>{currency.format(currentDebt)}</strong></div>
          <div><span>{isAbono ? 'Saldo despues del abono' : values.TIPO === 'Devolución' ? 'Saldo despues de la devolución' : 'Nueva deuda con este credito'}</span><strong className={projectedDebt < 0 ? 'debt-negative' : ''}>{currency.format(projectedDebt)}</strong></div>
        </div>}
        {module === 'VENTAS' || isCreditForm && !isAbono ? <p className="form-hint">Al elegir el código se completa el producto y su precio. Los códigos sin existencias no se pueden seleccionar.</p> : null}
        {(module === 'VENTAS' || module === 'ENTRADAS' || isCreditForm && !isAbono) && <div className="quantity-preview" aria-live="polite">
          <div><span>{module === 'ENTRADAS' ? 'Unidades ingresadas' : 'Unidades'}</span><strong>{number.format(lineQuantity)}</strong></div>
          <div><span>{module === 'ENTRADAS' ? 'Costo por unidad' : 'Precio por unidad'}</span><strong>{currency.format(lineUnitPrice)}</strong></div>
          <div><span>{module === 'VENTAS' ? 'Total de la venta' : module === 'ENTRADAS' ? 'Valor total de la entrada' : 'Valor de los productos'}</span><strong>{currency.format(lineTotal)}</strong></div>
          <div><span>{module === 'ENTRADAS' ? 'Stock después de la entrada' : isReturn ? 'Stock después de devolución' : 'Stock después de la venta'}</span><strong>{selectedProduct ? number.format(projectedStock) : '-'}</strong></div>
        </div>}
        {isReturn && <div className="debt-preview"><div><span>Valor de los productos devueltos</span><strong>{currency.format(returnValue)}</strong></div><div><span>Abono a la deuda</span><strong>{currency.format(returnDebtPart)}</strong></div><div><span>Reembolso a entregar al cliente</span><strong>{currency.format(refundValue)}</strong></div></div>}
        {isCreditForm && isAbono && <p className="form-hint">El abono reduce la deuda del cliente y se registra en VALOR.</p>}
        {isCreditForm && !isAbono && !isReturn && <p className="form-hint">Un crédito aumenta la cartera, no el recaudo. El medio de pago se solicita al registrar ventas o abonos.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancelar</button><button className="primary-button" type="submit">Guardar registro</button></div>
      </form>
    </section>
  </div>
}

function PhysicalInventoryCountModal({ data, counts, setupError, onClose, onSave }: { data: Record<ModuleKey, WorkbookRow[]>; counts: PhysicalInventoryCount[]; setupError: string; onClose: () => void; onSave: (values: Array<{ code: string; quantity: number; note: string }>) => Promise<boolean> }) {
  void counts
  const products = useMemo(() => getRows('INVENTARIO_PT', data, counts).filter((row) => String(row.CODIGO ?? '').trim()).sort((a, b) => String(a.CODIGO).localeCompare(String(b.CODIGO), 'es')), [data, counts])
  const [search, setSearch] = useState('')
  const [note, setNote] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [isSaving, setIsSaving] = useState(false)
  const visibleProducts = products.filter((row) => `${row.CODIGO} ${row.DETALLE}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  const entered = products.filter((row) => values[normalizeCode(row.CODIGO)] !== undefined && values[normalizeCode(row.CODIGO)] !== '')
  async function save() {
    const invalid = entered.find((row) => !Number.isFinite(Number(values[normalizeCode(row.CODIGO)])) || Number(values[normalizeCode(row.CODIGO)]) < 0)
    if (invalid) return
    setIsSaving(true)
    try {
      const saved = await onSave(entered.map((row) => ({ code: String(row.CODIGO).trim(), quantity: Number(values[normalizeCode(row.CODIGO)]), note })))
      if (saved) onClose()
    } finally {
      setIsSaving(false)
    }
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !isSaving) onClose() }}>
    <section className="modal physical-count-modal" role="dialog" aria-modal="true" aria-labelledby="physical-count-title">
      <div className="modal-heading"><div><p className="eyebrow">AJUSTE OPERATIVO</p><h2 id="physical-count-title">Conteo físico</h2><p>Actualiza la existencia visible sin crear entradas, salidas ni movimientos de caja.</p></div><button className="close-button" type="button" onClick={onClose} disabled={isSaving} aria-label="Cerrar">×</button></div>
      <div className="physical-count-callout"><strong>El stock aumenta con las unidades ingresadas.</strong><span>Se suman directamente al stock disponible, sin registrar entradas o salidas ni cambiar el balance.</span></div>
      {setupError && <p className="form-error">La tabla de conteos físicos todavía no está disponible en Supabase. Ejecuta la migración del proyecto y vuelve a cargar.</p>}
      <div className="physical-count-toolbar"><input aria-label="Buscar producto para contar" placeholder="Buscar por código o detalle..." value={search} onChange={(event) => setSearch(event.target.value)} /><span>{entered.length} productos diligenciados</span></div>
      <div className="table-wrap physical-count-table-wrap"><table><thead><tr><th>CÓDIGO</th><th>DETALLE</th><th>STOCK ACTUAL</th><th>UNIDADES A SUMAR</th><th>STOCK RESULTANTE</th></tr></thead><tbody>{visibleProducts.map((row) => {
        const code = normalizeCode(row.CODIGO)
        const value = values[code] ?? ''
        const currentStock = Number(row.STOCK ?? 0)
        const added = value === '' ? 0 : Number(value)
        return <tr key={code}><td>{row.CODIGO}</td><td>{row.DETALLE}</td><td>{number.format(currentStock)}</td><td><input type="number" min="0" step="0.001" aria-label={`Cantidad a sumar ${String(row.CODIGO)}`} value={value} onChange={(event) => setValues((current) => ({ ...current, [code]: event.target.value }))} /></td><td>{number.format(currentStock + added)}</td></tr>
      })}</tbody></table></div>
      <label className="physical-count-note">Nota del conteo<input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ej. Conteo manual del 4 de noviembre" maxLength={200} /></label>
      <p className="form-hint">Deja en blanco los productos sin mercancía nueva. Para sumar unidades, escribe la cantidad que ingresó.</p>
      <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose} disabled={isSaving}>Cancelar</button><button className="primary-button" type="button" onClick={() => void save()} disabled={isSaving || entered.length === 0 || Boolean(setupError)}>{isSaving ? 'Guardando...' : 'Guardar conteo'}</button></div>
    </section>
  </div>
}

function getRows(module: ModuleKey | 'MENU', data: Record<ModuleKey, WorkbookRow[]>, physicalCounts: PhysicalInventoryCount[] = [], deletedHistoryKeys: ReadonlySet<string> = new Set()): WorkbookRow[] {
  void physicalCounts
  if (module === 'MENU') return []
  if (module === 'INVENTARIO_PT') {
    const entries = sumBy(data.ENTRADAS, 'CODIGO', 'CANTIDAD')
    const sales = sumBy(data.VENTAS, 'CODIGO', 'CANT')
    const credits = sumBy(data.CREDITOS.filter((row) => isCreditType(row.TIPO)), 'CODIGO', 'CANT')
    const returns = sumBy(data.CREDITOS.filter((row) => isReturnType(row.TIPO)), 'CODIGO', 'CANT')
    return data.INVENTARIO_PT.map((row) => {
      const code = normalizeCode(row.CODIGO)
      const cost = getLatestProductCost(data.COSTOS_NO_PRODUCIDOS, code)
      const incoming = entries[code] ?? Number(row.ENTRADAS ?? 0)
      const outgoing = (sales[code] ?? 0) + (credits[code] ?? 0) - (returns[code] ?? 0)
      const calculatedStock = incoming - outgoing
      const price = cost ? Number(cost['PRECIO AL PUBLICO'] ?? row.PRECIO ?? 0) : row.PRECIO
      const fixedCost = cost ? Number(cost['COSTO FIJO'] ?? 500) : row['Costo fijo']
      const totalCost = cost ? Number(cost.COSTO ?? 0) + Number(cost['COSTO FIJO'] ?? 500) : row.COSTO
      return { ...row, PRECIO: price, COSTO: totalCost, 'Costo fijo': fixedCost, ENTRADAS: incoming, SALIDAS: outgoing, STOCK: Number(row.STOCK ?? calculatedStock), GANANCIA: calculateInventoryProfit(price, totalCost) }
    })
  }
  if (module === 'CLIENTES') {
    const clients = new Map<string, WorkbookRow>()
    const snapshots = new Map<string, { balance: number; asOf: number; movementCutoff: number }>()
    data.CLIENTES.forEach((row) => {
      const name = String(row.NOMBRE ?? '').trim()
      const key = normalizeClientName(name)
      const identity = getValidationClientIdentity(name)
      if (key && !clients.has(identity)) clients.set(identity, { ...row, NOMBRE: getValidationClientSheet(name) ?? name })
      const balance = Number(row.saldo_base)
      const asOf = Date.parse(String(row.saldo_base_fecha ?? ''))
      if (identity && row.saldo_base !== null && row.saldo_base !== undefined && row.saldo_base !== '' && Number.isFinite(balance) && Number.isFinite(asOf)) snapshots.set(identity, { balance, asOf, movementCutoff: asOf })
    })
    mergeValidationCreditMovements([], [], deletedHistoryKeys).forEach((person) => snapshots.set(getValidationClientIdentity(person.sheet), {
      balance: person.saldoPendiente,
      asOf: validationCreditSourceAsOf,
      movementCutoff: importedCreditHistoryCutoff,
    }))
    validationCreditOpeningBalances.forEach((balance, identity) => {
      if (!snapshots.has(identity)) snapshots.set(identity, { balance, asOf: validationCreditSourceAsOf, movementCutoff: importedCreditHistoryCutoff })
    })
    const balancesByClient = new Map<string, number>()
    snapshots.forEach((snapshot, identity) => balancesByClient.set(identity, snapshot.balance))
    const workbookDuplicateCreditIds = getWorkbookDuplicateCreditIds(data.CREDITOS)
    data.CREDITOS.forEach((row) => {
      const identity = getValidationClientIdentity(row.NOMBRE)
      const key = normalizeClientName(row.NOMBRE)
      if (!key) return
      if (!clients.has(identity)) clients.set(identity, { NOMBRE: getValidationClientSheet(row.NOMBRE) ?? String(row.NOMBRE ?? '').trim() })
      const snapshot = snapshots.get(identity)
      if ((!snapshot || rowCreatedAtValue(row) > snapshot.movementCutoff) && !workbookDuplicateCreditIds.has(String(row.id ?? ''))) {
        balancesByClient.set(identity, (balancesByClient.get(identity) ?? 0) + getCreditMovementDelta(row))
      }
    })
    validationCreditPortfolio.forEach((person) => {
      const identity = getValidationClientIdentity(person.sheet)
      if (!clients.has(identity)) clients.set(identity, { NOMBRE: person.sheet })
      if (!balancesByClient.has(identity)) balancesByClient.set(identity, person.saldoPendiente)
    })
    const balances: WorkbookRow[] = [...clients.entries()].map(([identity, row]) => ({ ...row, Columna1: balancesByClient.get(identity) ?? 0 }))
    return balances.sort((a, b) => String(a.NOMBRE ?? '').localeCompare(String(b.NOMBRE ?? ''), 'es', { sensitivity: 'base' }))
  }
  if (module === 'COSTOS_NO_PRODUCIDOS') {
    const latestByCode = new Map<string, WorkbookRow>()
    const withoutCode: WorkbookRow[] = []
    data.COSTOS_NO_PRODUCIDOS.forEach((row) => {
      const code = normalizeCode(row.CODIGO)
      if (code) latestByCode.set(code, row)
      else withoutCode.push(row)
    })
    return [...latestByCode.values(), ...withoutCode].map((row) => {
      const product = data.INVENTARIO_PT.find((item) => normalizeCode(item.CODIGO) === normalizeCode(row.CODIGO))
      const totalCost = Number(row.COSTO ?? 0) + Number(row['COSTO FIJO'] ?? 0)
      return {
        ...row,
        DETALLE: String(product?.DETALLE ?? row.DETALLE ?? ''),
        'COSTO TOTAL': totalCost,
        Columna1: Number(row['PRECIO AL PUBLICO'] ?? 0) - totalCost,
      }
    })
  }
  return data[module]
}

function sumBy(rows: WorkbookRow[], groupKey: string, valueKey: string): Record<string, number> {
  return rows.reduce<Record<string, number>>((result, row) => {
    const group = normalizeCode(row[groupKey])
    if (group) result[group] = (result[group] ?? 0) + Number(row[valueKey] ?? 0)
    return result
  }, {})
}
function normalizeCode(value: CellValue): string { return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase() }
const productCostIndexCache = new WeakMap<WorkbookRow[], Map<string, WorkbookRow>>()
function validateProductIdentity(row: WorkbookRow, products: WorkbookRow[]): string {
  const code = normalizeCode(row.CODIGO)
  const detail = normalizeExpenseText(row.DETALLE)
  if (!code) return 'El código del producto es obligatorio.'
  if (!detail) return 'La descripción del producto es obligatoria.'
  if (products.some((product) => normalizeCode(product.CODIGO) === code)) return `El código ${String(row.CODIGO).trim()} ya existe en el inventario. Usa el producto existente.`
  const duplicateDetail = products.find((product) => normalizeExpenseText(product.DETALLE) === detail && normalizeCode(product.CODIGO) !== code)
  if (duplicateDetail) return `La descripción “${String(row.DETALLE).trim()}” ya está asignada al código ${String(duplicateDetail.CODIGO ?? '').trim()}. Cada código nuevo debe tener una descripción diferente.`
  return ''
}
function getLatestProductCost(costs: WorkbookRow[], code: CellValue): WorkbookRow | undefined {
  const key = normalizeCode(code)
  if (!key) return undefined
  let index = productCostIndexCache.get(costs)
  if (!index) {
    const nextIndex = new Map<string, WorkbookRow>()
    costs.forEach((row) => {
      const productCode = normalizeCode(row.CODIGO)
      if (productCode) nextIndex.set(productCode, row)
    })
    productCostIndexCache.set(costs, nextIndex)
    index = nextIndex
  }
  return index.get(key)
}
function compareProductDetails(a: WorkbookRow, b: WorkbookRow): number {
  return String(a.DETALLE ?? '').localeCompare(String(b.DETALLE ?? ''), 'es', { sensitivity: 'base' })
    || String(a.CODIGO ?? '').localeCompare(String(b.CODIGO ?? ''), 'es', { sensitivity: 'base' })
}
function normalizeExpenseText(value: CellValue): string {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}
function getExpenseCode(row: WorkbookRow, data: Record<ModuleKey, WorkbookRow[]>): string {
  const code = String(row.CODIGO_MP ?? '').trim()
  if (code) return code
  const detail = normalizeExpenseText(row.DETALLE ?? row.COMENTARIOS)
  if (!detail) return ''
  const match = data.COSTOS_NO_PRODUCIDOS.find((item) => normalizeExpenseText(item.CODIGO) === detail || normalizeExpenseText(item.DETALLE) === detail)
  return String(match?.CODIGO ?? '').trim()
}
function refundableProducts(rows: WorkbookRow[], clientName: string): Array<{ code: string; detail: string; available: number; unitPrice: number; outstandingValue: number }> {
  if (!clientName) return []
  const transactions = rows.filter((row) => String(row.NOMBRE ?? '').trim().toLocaleLowerCase() === clientName.trim().toLocaleLowerCase()).sort((a, b) => rowDateValue(a.FECHA) - rowDateValue(b.FECHA))
  const lots: Array<{ code: string; detail: string; quantity: number; originalQuantity: number; netValue: number; debt: number }> = []
  for (const row of transactions) {
    if (isCreditType(row.TIPO) && String(row.CODIGO ?? '').trim()) {
      const quantity = Math.max(0, Number(row.CANT ?? 0))
      const recordedValue = Number(row.VALOR ?? 0)
      const netValue = Math.max(0, recordedValue > 0 ? recordedValue : Number(row.PRECIO ?? 0) * quantity - Number(row.DESCUENTO ?? 0))
      lots.push({ code: String(row.CODIGO).trim(), detail: String(row.DETALLE ?? ''), quantity, originalQuantity: quantity, netValue, debt: netValue })
    } else if (isCreditType(row.TIPO)) {
      const legacyDebt = Math.max(0, Number(row.VALOR ?? 0))
      if (legacyDebt) lots.push({ code: '', detail: '', quantity: 0, originalQuantity: 0, netValue: legacyDebt, debt: legacyDebt })
    } else if (isAbonoType(row.TIPO)) {
      let payment = Math.max(0, Number(row.VALOR ?? 0))
      for (const lot of lots) { const applied = Math.min(payment, lot.debt); lot.debt -= applied; payment -= applied; if (payment <= 0) break }
    } else if (isReturnType(row.TIPO) && String(row.CODIGO ?? '').trim()) {
      let quantity = Math.max(0, Number(row.CANT ?? 0)); let debtReduction = Math.max(0, Number(row.VALOR ?? 0))
      for (const lot of lots.filter((item) => normalizeCode(item.code) === normalizeCode(row.CODIGO))) {
        const returned = Math.min(quantity, lot.quantity); lot.quantity -= returned; quantity -= returned
        const applied = Math.min(debtReduction, lot.debt); lot.debt -= applied; debtReduction -= applied
        if (quantity <= 0 && debtReduction <= 0) break
      }
    }
  }
  const grouped = new Map<string, { code: string; detail: string; available: number; originalQuantity: number; netValue: number; outstandingValue: number }>()
  for (const lot of lots) {
    const key = normalizeCode(lot.code)
    const group = grouped.get(key) ?? { code: lot.code, detail: lot.detail, available: 0, originalQuantity: 0, netValue: 0, outstandingValue: 0 }
    group.available += lot.quantity; group.originalQuantity += lot.originalQuantity; group.netValue += lot.netValue; group.outstandingValue += lot.debt
    grouped.set(key, group)
  }
  return [...grouped.values()].filter((item) => item.available > 0).map((item) => ({ code: item.code, detail: item.detail, available: item.available, unitPrice: item.originalQuantity ? item.netValue / item.originalQuantity : 0, outstandingValue: item.outstandingValue }))
}
function validateAvailableStock(row: WorkbookRow, data: Record<ModuleKey, WorkbookRow[]>): boolean {
  const code = normalizeCode(row.CODIGO)
  const product = getRows('INVENTARIO_PT', data).find((item) => normalizeCode(item.CODIGO) === code)
  return Boolean(product && Number(product.STOCK ?? 0) >= Number(row.CANT ?? 0) && Number(row.CANT ?? 0) > 0)
}
function productUnitPrice(code: CellValue, module: ModuleKey, data: Record<ModuleKey, WorkbookRow[]>): number {
  const key = normalizeCode(code)
  const product = data.INVENTARIO_PT.find((row) => normalizeCode(row.CODIGO) === key)
  const cost = getLatestProductCost(data.COSTOS_NO_PRODUCIDOS, key)
  if (module === 'ENTRADAS') return Number(cost ? Number(cost.COSTO ?? 0) + Number(cost['COSTO FIJO'] ?? 0) : product?.COSTO ?? 0)
  return Number(cost ? cost['PRECIO AL PUBLICO'] ?? product?.PRECIO ?? 0 : product?.PRECIO ?? 0)
}
function isCreditTypeLegacy(value: CellValue): boolean {
  const text = String(value ?? '').trim().toLowerCase()
  return text === 'crédito' || text === 'credito'
}
function normalizeTransactionType(value: CellValue): string { return String(value ?? '').trim().toLowerCase().replace(/Ã©/g, 'e').replace(/Ã³/g, 'o').replace(/Ã±/g, 'n').normalize('NFD').replace(/[\u0300-\u036f]/g, '') }
function isCreditType(value: CellValue): boolean { return normalizeTransactionType(value) === 'credito' || isCreditTypeLegacy(value) }
function isAbonoType(value: CellValue): boolean { return normalizeTransactionType(value) === 'abono' }
function isReturnType(value: CellValue): boolean { return normalizeTransactionType(value) === 'devolucion' }
function normalizeClientName(value: unknown): string {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es')
}
function compareClientNames(a: unknown, b: unknown): number {
  return String(a ?? '').trim().localeCompare(String(b ?? '').trim(), 'es', { sensitivity: 'base', numeric: true, ignorePunctuation: true })
}
function getValidationClientSheet(value: unknown): string | undefined {
  return validationCreditClientSheets.get(normalizeClientName(value))
}
function getValidationClientIdentity(value: unknown): string {
  return normalizeClientName(getValidationClientSheet(value) ?? value)
}
function getClientBalanceSnapshot(clients: WorkbookRow[], clientName: string, deletedHistoryKeys: ReadonlySet<string> = new Set()): { balance: number; asOf: number; movementCutoff: number } | null {
  const key = getValidationClientIdentity(clientName)
  const validationPerson = mergeValidationCreditMovements([], [], deletedHistoryKeys).find((person) => getValidationClientIdentity(person.sheet) === key)
  if (validationPerson) return {
    balance: validationPerson.saldoPendiente,
    asOf: validationCreditSourceAsOf,
    movementCutoff: importedCreditHistoryCutoff,
  }
  const client = clients.find((row) => getValidationClientIdentity(row.NOMBRE) === key)
  const balance = Number(client?.saldo_base)
  const asOf = Date.parse(String(client?.saldo_base_fecha ?? ''))
  if (client && client.saldo_base !== null && client.saldo_base !== undefined && client.saldo_base !== '' && Number.isFinite(balance) && Number.isFinite(asOf)) return { balance, asOf, movementCutoff: asOf }
  const historicalBalance = validationCreditOpeningBalances.get(key)
  return historicalBalance === undefined ? null : { balance: historicalBalance, asOf: validationCreditSourceAsOf, movementCutoff: importedCreditHistoryCutoff }
}
function getCreditMovementDelta(row: WorkbookRow): number {
  const value = Number(row.VALOR ?? 0)
  return isAbonoType(row.TIPO) || isReturnType(row.TIPO) ? -value : isCreditType(row.TIPO) ? value : 0
}
function getWorkbookCreditMatchKey(identity: string, type: 'COMPRA' | 'ABONO', code: unknown, quantity: unknown, discount: unknown, amount: unknown): string {
  return [identity, type, normalizeCode(String(code ?? '')), Number(quantity ?? 0), Number(discount ?? 0), Number(amount ?? 0)].join('|')
}
function getWorkbookDuplicateCreditIds(rows: WorkbookRow[]): Set<string> {
  const sourceMatches = new Map<string, Array<{ date: number | null; consumed: boolean }>>()
  validationCreditPortfolio.forEach((person) => person.transactions.forEach((transaction) => {
    const identity = getValidationClientIdentity(person.sheet)
    const type = transaction.tipo
    const amount = type === 'ABONO' ? transaction.abona : transaction.total
    const key = getWorkbookCreditMatchKey(identity, type, transaction.codigo, transaction.cantidad, transaction.descuento, amount)
    const matches = sourceMatches.get(key) ?? []
    matches.push({ date: transaction.fecha ? rowDateValue(transaction.fecha) : null, consumed: false })
    sourceMatches.set(key, matches)
  }))
  const duplicateIds = new Set<string>()
  rows.filter((row) => rowCreatedAtValue(row) > importedCreditHistoryCutoff)
    .slice()
    .sort((a, b) => rowCreatedAtValue(a) - rowCreatedAtValue(b))
    .forEach((row) => {
      if (!isCreditType(row.TIPO) && !isAbonoType(row.TIPO)) return
      const identity = getValidationClientIdentity(row.NOMBRE)
      const type = isAbonoType(row.TIPO) ? 'ABONO' : 'COMPRA'
      const amount = Number(row.VALOR ?? 0)
      const key = getWorkbookCreditMatchKey(identity, type, row.CODIGO, row.CANT, row.DESCUENTO, amount)
      const matches = sourceMatches.get(key) ?? []
      const date = row.FECHA === null || row.FECHA === undefined || row.FECHA === '' ? null : rowDateValue(row.FECHA)
      const match = matches
        .filter((candidate) => !candidate.consumed && (candidate.date === null || date === null
          ? candidate.date === date
          : Math.abs(candidate.date - date) <= 86400000))
        .sort((a, b) => Math.abs((a.date ?? 0) - (date ?? 0)) - Math.abs((b.date ?? 0) - (date ?? 0)))[0]
      if (!match) return
      match.consumed = true
      if (row.id !== null && row.id !== undefined && row.id !== '') duplicateIds.add(String(row.id))
    })
  return duplicateIds
}
function getClientDebt(rows: WorkbookRow[], clientName: string, clients: WorkbookRow[] = [], deletedHistoryKeys: ReadonlySet<string> = new Set()): number {
  if (!clientName) return 0
  const key = getValidationClientIdentity(clientName)
  const snapshot = getClientBalanceSnapshot(clients, clientName, deletedHistoryKeys)
  const workbookDuplicateCreditIds = getWorkbookDuplicateCreditIds(rows)
  return rows.filter((row) => getValidationClientIdentity(row.NOMBRE) === key
      && (!snapshot || rowCreatedAtValue(row) > snapshot.movementCutoff)
      && !workbookDuplicateCreditIds.has(String(row.id ?? '')))
    .reduce((balance, row) => balance + getCreditMovementDelta(row), snapshot?.balance ?? 0)
}
function rowDateValue(value: CellValue): number {
  if (typeof value === 'number') return new Date(Date.UTC(1899, 11, 30) + value * 86400000).getTime()
  const raw = String(value ?? '').trim()
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])).getTime()
  const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (dmy) return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1])).getTime()
  const timestamp = Date.parse(raw)
  return Number.isNaN(timestamp) ? 0 : timestamp
}
function rowCreatedAtValue(row: WorkbookRow): number {
  const timestamp = Date.parse(String(row.created_at ?? row.updated_at ?? ''))
  return Number.isNaN(timestamp) ? 0 : timestamp
}
function filterCreditRows(rows: WorkbookRow[], filters: CreditFilters): WorkbookRow[] {
  const name = filters.name.trim().toLocaleLowerCase()
  const product = filters.product.trim().toLocaleLowerCase()
  const type = filters.type.trim().toLocaleLowerCase()
  const from = filters.from ? rowDateValue(filters.from) : Number.NEGATIVE_INFINITY
  const to = filters.to ? rowDateValue(filters.to) + 86400000 : Number.POSITIVE_INFINITY
  const matchingRows = rows.filter((row) => {
    const rowName = String(row.NOMBRE ?? '').trim().toLocaleLowerCase()
    const rowProduct = `${String(row.CODIGO ?? '')} ${String(row.DETALLE ?? '')}`.toLocaleLowerCase()
    const rowType = String(row.TIPO ?? '').trim().toLocaleLowerCase()
    const date = rowDateValue(row.FECHA)
    return (!name || rowName.includes(name)) && (!product || rowProduct.includes(product)) && (!type || rowType === type) && date >= from && date < to
  })
  const matchingPeople = new Set(matchingRows.map((row) => String(row.NOMBRE ?? '').trim().toLocaleLowerCase()).filter(Boolean))
  const chronological = Boolean(name) && matchingPeople.size === 1
  return matchingRows.sort((a, b) => {
    const dateDifference = rowDateValue(a.FECHA) - rowDateValue(b.FECHA)
    const insertionDifference = rowCreatedAtValue(a) - rowCreatedAtValue(b)
    return chronological ? dateDifference || insertionDifference : -dateDifference || -insertionDifference
  })
}
function matchesPeriod(row: WorkbookRow, month: number, year: number): boolean {
  if (month < 1 || month > 12 || year < 2000) return false
  const date = rowDateValue(row.FECHA)
  if (date) { const parsed = new Date(date); return parsed.getMonth() + 1 === month && parsed.getFullYear() === year }
  return String(row.MES ?? '').trim().toLowerCase() === monthLabels[month - 1]
}
function normalizeRow(module: ModuleKey, row: WorkbookRow, data: Record<ModuleKey, WorkbookRow[]>): WorkbookRow {
  const next = { ...row }
  moduleColumns[module].forEach((column) => {
    if (column.type === 'number' && next[column.key] === '') next[column.key] = null
    else if (column.type === 'number' && next[column.key] !== null && next[column.key] !== undefined) next[column.key] = Number(next[column.key])
  })
  if (module === 'CLIENTES') next.NOMBRE = String(next.NOMBRE ?? '').trim().replace(/\s+/g, ' ')
  if (module === 'INVENTARIO_PT') {
    const code = String(next.CODIGO ?? '').trim().toLowerCase()
    const cost = getLatestProductCost(data.COSTOS_NO_PRODUCIDOS, code)
    const entryCount = sumBy(data.ENTRADAS, 'CODIGO', 'CANTIDAD')[code] ?? 0
    const saleCount = sumBy(data.VENTAS, 'CODIGO', 'CANT')[code] ?? 0
    const creditCount = sumBy(data.CREDITOS.filter((item) => isCreditType(item.TIPO)), 'CODIGO', 'CANT')[code] ?? 0
    next.PRECIO = cost ? Number(cost['PRECIO AL PUBLICO'] ?? 0) : null
    next.PRECIO_AL_POR_MAYOR = null
    next.COSTO = cost ? Number(cost.COSTO ?? 0) + Number(cost['COSTO FIJO'] ?? 0) : null
    next['Costo fijo'] = cost ? Number(cost['COSTO FIJO'] ?? 0) : null
    next['Costo MO'] = null
    next.GANANCIA = next.PRECIO === null || next.COSTO === null ? null : Number(next.PRECIO) - Number(next.COSTO)
    next.ENTRADAS = entryCount
    next.SALIDAS = saleCount + creditCount
    next.CONSIGNACION = 0
    next.STOCK = entryCount - saleCount - creditCount
  }
  if (module === 'VENTAS') {
    next.TOTAL = calculateLineTotal(next.CANT, next.PRECIO, next.DESCUENTO)
    next.MES = monthName(String(next.FECHA ?? ''))
  }
  if (module === 'GASTOS') {
    next.DETALLE = String(next.DETALLE ?? '').trim()
    next.CODIGO_MP = getExpenseCode(next, data) || null
    next.MES = 'Otro'
  }
  if (module === 'CREDITOS') {
    const type = isAbonoType(next.TIPO) ? 'Abono' : isReturnType(next.TIPO) ? 'Devolución' : CREDIT_TYPE
    const clientName = String(next.NOMBRE ?? '').trim()
    next.TIPO = type
    next.NOMBRE = clientName
    if (isAbonoType(type)) {
      next.CODIGO = null
      next.DETALLE = String(next.DETALLE ?? '').trim() || null
      next.CANT = null
      next.DESCUENTO = 0
      next.COMENTARIO = 'Abono'
      next.PRECIO = 0
      next.VALOR = Number(next.VALOR ?? 0)
    } else if (isReturnType(type)) {
      next.CODIGO = String(next.CODIGO ?? '').trim()
      next.DETALLE = String(next.DETALLE ?? '').trim()
      next.CANT = Number(next.CANT ?? 0)
      next.DESCUENTO = Number(next.DESCUENTO ?? 0)
      next.PRECIO = Number(next.PRECIO ?? 0)
      next.COMENTARIO = String(next.COMENTARIO ?? 'Devolución')
      next.VALOR = Number(next.VALOR ?? 0)
    } else {
      next.VALOR = Number(next.VALOR ?? 0) || calculateLineTotal(next.CANT, next.PRECIO, next.DESCUENTO)
    }
    next.DEUDA = getClientDebt(data.CREDITOS, clientName, data.CLIENTES) + getCreditMovementDelta(next)
    next.MES = monthName(String(next.FECHA ?? ''))
  }
  if (module === 'ENTRADAS') {
    next.VALOR_PRODUCTO = calculateLineTotal(next.CANTIDAD, next.PRECIO)
    delete next.Columna1
  }
  if (module === 'COSTOS_NO_PRODUCIDOS') {
    const product = data.INVENTARIO_PT.find((item) => normalizeCode(item.CODIGO) === normalizeCode(next.CODIGO))
    if (product) next.DETALLE = String(product.DETALLE ?? next.DETALLE ?? '').trim()
    if (next['COSTO FIJO'] === null || next['COSTO FIJO'] === undefined || next['COSTO FIJO'] === '') next['COSTO FIJO'] = 500
    next['COSTO TOTAL'] = Number(next.COSTO ?? 0) + Number(next['COSTO FIJO'] ?? 0)
    next.Columna1 = Number(next['PRECIO AL PUBLICO'] ?? 0) - Number(next['COSTO TOTAL'] ?? 0)
  }
  return next
}
function calculateLineTotal(quantity: CellValue, unitPrice: CellValue, discount: CellValue = 0): number {
  return Number(quantity ?? 0) * Number(unitPrice ?? 0) - Number(discount ?? 0)
}
function formatCell(value: CellValue, key: string): string {
  const cleanValue = cleanExcelError(value)
  if (cleanValue === null || cleanValue === '') return '-'
  const normalizedKey = key.toLocaleUpperCase()
  if (normalizedKey.includes('PRECIO') || normalizedKey.includes('COSTO') || normalizedKey.includes('VALOR') || ['TOTAL', 'DEUDA', 'GANANCIA', 'DESCUENTO', 'COLUMNA1'].includes(normalizedKey)) return currency.format(Number(cleanValue))
  if (key === 'FECHA' || key === 'FECHA DE PAGO') return String(cleanValue).slice(0, 10)
  return typeof cleanValue === 'number' ? number.format(cleanValue) : String(cleanValue)
}
function moduleDescription(module: ModuleKey): string {
  const descriptions: Partial<Record<ModuleKey, string>> = {
    INVENTARIO_PT: 'Inventario de producto terminado.',
    ENTRADAS: 'Registro de productos fabricados o comprados.',
    VENTAS: 'Registro de ventas, descuentos, total y medio de pago.',
    GASTOS: 'Registro de compras de insumos y gastos operativos.',
    CREDITOS: 'Creditos otorgados y abonos de clientes.',
    CLIENTES: 'Listado de clientes usados por los formularios.',
    COSTOS_NO_PRODUCIDOS: 'Costos de productos comprados o no producidos.',
    BALANCE: 'Reporte mensual de ventas, recaudo, egresos, retiro y fondo.',
    VALIDACION_CREDITOS: `Validación de cartera por persona importada desde ${validationCreditSourceWorkbook}.`,
  }
  return descriptions[module] ?? ''
}
function getMetrics(data: Record<ModuleKey, WorkbookRow[]>, physicalCounts: PhysicalInventoryCount[] = []) {
  const sales = data.VENTAS.reduce((total, row) => total + Number(row.TOTAL ?? 0), 0)
  const cashSales = data.VENTAS.filter((row) => String(row.MEDIO_DE_PAGO).includes('Efectivo')).reduce((total, row) => total + Number(row.TOTAL ?? 0), 0)
  const transferSales = data.VENTAS.filter((row) => String(row.MEDIO_DE_PAGO).includes('Transferencia')).reduce((total, row) => total + Number(row.TOTAL ?? 0), 0)
  const expenses = data.GASTOS.reduce((total, row) => total + Number(row.VALOR ?? 0), 0)
  const materialExpenses = data.GASTOS.filter((row) => getExpenseCode(row, data)).reduce((total, row) => total + Number(row.VALOR ?? 0), 0)
  const creditsPaid = data.CREDITOS.filter((row) => row.TIPO === 'Abono').reduce((total, row) => total + Number(row.VALOR ?? 0), 0)
  const inventory = getRows('INVENTARIO_PT', data, physicalCounts)
  const stock = inventory.reduce((total, row) => total + Number(row.STOCK ?? 0), 0)
  const stockValue = inventory.reduce((total, row) => total + Math.max(0, Number(row.STOCK ?? 0)) * Number(row.COSTO ?? 0), 0)
  return { products: data.INVENTARIO_PT.length, stock, stockValue, sales, cashSales, transferSales, expenses, materialExpenses, operatingExpenses: expenses - materialExpenses, creditsPaid }
}
function emptyWorkbookData(): Record<ModuleKey, WorkbookRow[]> {
  const entries: Array<[ModuleKey, WorkbookRow[]]> = (Object.keys(moduleColumns) as ModuleKey[]).map((module) => [module, []])
  return Object.fromEntries(entries) as Record<ModuleKey, WorkbookRow[]>
}

export default App
