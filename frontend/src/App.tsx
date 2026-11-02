import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'
import { cloneInitialData, monthName, moduleColumns, type CellValue, type Column, type ModuleKey, type WorkbookRow } from './lib/workbook'
import { downloadClientStatement, shareClientStatement } from './lib/client-statement'
import { hasSupabaseConfig, supabase } from './lib/supabase'

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
  { key: 'CLIENTES', label: 'CLIENTES', group: 'CARTERA', icon: 'C' },
  { key: 'COSTOS_NO_PRODUCIDOS', label: 'COSTOS_NO_PRODUCIDOS', group: 'COSTOS', icon: 'NP' },
  { key: 'BALANCE', label: 'BALANCE', group: 'REPORTES', icon: 'B' },
]
const editableModules = new Set<ModuleKey>(['INVENTARIO_PT', 'ENTRADAS', 'VENTAS', 'GASTOS', 'CREDITOS', 'CLIENTES', 'COSTOS_NO_PRODUCIDOS'])
const remoteTableByModule: Partial<Record<ModuleKey, string>> = {
  INVENTARIO_PT: 'inventario_pt', ENTRADAS: 'entradas', VENTAS: 'ventas', GASTOS: 'gastos', CREDITOS: 'creditos', CLIENTES: 'clientes', COSTOS_NO_PRODUCIDOS: 'costos_no_producidos',
}
type SyncState = 'local' | 'syncing' | 'synced' | 'error'

function App() {
  const { data, setData, syncState, syncError, refreshAll } = useWorkbookSync()
  const [active, setActive] = useState<ModuleKey | 'MENU'>('MENU')
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [notice, setNotice] = useState('')

  const rows = useMemo(() => getRows(active, data), [active, data])
  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return needle ? rows.filter((row) => Object.values(row).some((value) => String(value ?? '').toLowerCase().includes(needle))) : rows
  }, [rows, search])

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
    setSearch('')
    setShowForm(false)
  }

  async function saveRow(row: WorkbookRow) {
    if (active === 'MENU' || active === 'BALANCE') return
    const normalized = normalizeRow(active, row, data)
    if (!supabase) {
      const nextData = { ...data, [active]: [...data[active], normalized] }
      setData(nextData)
      localStorage.setItem('sportivos-workbook-v1', JSON.stringify(nextData))
      setShowForm(false)
      flashNotice('Registro guardado en ' + active + '.')
      return
    }
    const client = supabase as any
    const table = remoteTableByModule[active]
    if (!table) return
    const result = await client.from(table).insert(toRemoteRow(active, normalized))
    if (result.error) {
      flashNotice('No se pudo guardar: ' + result.error.message)
      return
    }
    await refreshAll()
    setShowForm(false)
    flashNotice('Registro guardado en ' + active + ' y sincronizado.')
  }

  const connectionLabel = syncState === 'synced' ? 'Sincronizado con Supabase' : syncState === 'syncing' ? 'Sincronizando...' : syncState === 'error' ? 'Sin conexion - datos locales' : 'Persistencia local'

  return <div className="app-shell">
    <aside className="sidebar">
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
        <div className="data-status"><i /> {hasSupabaseConfig ? 'Base remota conectada' : 'Datos de prueba activos'}</div>
      </div>
    </aside>
    <main className="main-content">
      <header className="topbar">
        <div className="breadcrumb"><button type="button" onClick={() => navigate('MENU')}>MENU</button><span>/</span><strong>{active}</strong></div>
        <div className="topbar-right"><span className="connection"><i /> {connectionLabel}</span><button className="refresh-button" type="button" onClick={() => void refreshAll(true)}>Actualizar</button><span className="source-pill">SPORTIVOS - XLSM</span></div>
      </header>
      {notice && <div className="toast" role="status">{notice}</div>}
      {syncError && <div className="sync-warning" role="status">{syncError}</div>}
    {active === 'MENU' ? <Menu data={data} onNavigate={navigate} /> : <ModuleView module={active} data={data} rows={filteredRows} totalRows={rows.length} search={search} onSearch={setSearch} onNew={() => setShowForm(true)} onNotice={flashNotice} />}
    </main>
    {showForm && active !== 'MENU' && <RecordForm module={active} data={data} onClose={() => setShowForm(false)} onSave={saveRow} />}
  </div>
}

function useWorkbookSync() {
  const [data, setData] = useState<Record<ModuleKey, WorkbookRow[]>>(() => loadData())
  const [syncState, setSyncState] = useState<SyncState>(hasSupabaseConfig ? 'syncing' : 'local')
  const [syncError, setSyncError] = useState('')

  const refreshAll = useCallback(async (showNotice = false) => {
    if (!supabase) {
      setSyncState('local')
      return
    }
    setSyncState('syncing')
    try {
      const remoteData = await readRemoteData()
      setData(remoteData)
      localStorage.setItem('sportivos-workbook-v1', JSON.stringify(remoteData))
      setSyncError('')
      setSyncState('synced')
      if (showNotice) window.dispatchEvent(new CustomEvent('sportivos:notice', { detail: 'Datos actualizados desde Supabase.' }))
    } catch (error) {
      setSyncState('error')
      setSyncError(error instanceof Error ? error.message : 'No fue posible conectar con Supabase.')
      if (showNotice) window.dispatchEvent(new CustomEvent('sportivos:notice', { detail: 'No se pudo actualizar. Se conservan los datos locales.' }))
    }
  }, [])

  useEffect(() => {
    void refreshAll()
    const timer = window.setInterval(() => void refreshAll(), 10000)
    return () => window.clearInterval(timer)
  }, [refreshAll])

  return { data, setData, syncState, syncError, refreshAll }
}

async function readRemoteData(): Promise<Record<ModuleKey, WorkbookRow[]>> {
  if (!supabase) return loadData()
  const client = supabase
  const entries = await Promise.all((Object.keys(remoteTableByModule) as ModuleKey[]).map(async (module) => {
    const table = remoteTableByModule[module]
    if (!table) return [module, []] as const
    const result = await client.from(table).select('*').order('created_at', { ascending: true })
    if (result.error) throw new Error(module + ': ' + result.error.message)
    return [module, (result.data ?? []).map((row) => fromRemoteRow(module, row as WorkbookRow))] as const
  }))
  return { ...cloneInitialData(), ...Object.fromEntries(entries) } as Record<ModuleKey, WorkbookRow[]>
}
function fromRemoteRow(module: ModuleKey, row: WorkbookRow): WorkbookRow {
  const next = { ...row }
  if (module === 'INVENTARIO_PT') next.CONSIGNACION = row.CONSIGNACION ?? row['CONSIGNACIÓN'] ?? null
  if (module === 'ENTRADAS') next.Columna1 = Number(row.CANTIDAD ?? 0) * Number(row.PRECIO ?? 0)
  if (module === 'GASTOS') next.MES = 'Otro'
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
  if (module === 'ENTRADAS' || module === 'CLIENTES' || module === 'COSTOS_NO_PRODUCIDOS' || module === 'CREDITOS') delete next.Columna1
  if (module === 'GASTOS') delete next.MES
  return next
}

function Menu({ data, onNavigate }: { data: Record<ModuleKey, WorkbookRow[]>; onNavigate: (module: ModuleKey | 'MENU') => void }) {
  const metrics = getMetrics(data)
  return <section className="page-content">
    <div className="page-heading"><div><p className="eyebrow">HOJA PRINCIPAL</p><h1>MENU</h1><p className="page-description">Vista de control del libro Sportivos: inventarios, ventas, cartera y reportes.</p></div><span className="reference-badge">Fuente: SPORTIVOS (1) (1).xlsm</span></div>
    <div className="summary-grid">
      <SummaryCard label="Productos terminados" value={number.format(metrics.products)} note="Registros en INVENTARIO_PT" tone="green" />
      <SummaryCard label="Stock disponible" value={number.format(metrics.stock)} note="ENTRADAS menos SALIDAS" tone="blue" />
      <SummaryCard label="Ventas del periodo" value={currency.format(metrics.sales)} note="Suma de TOTAL en VENTAS" tone="amber" />
      <SummaryCard label="Gastos registrados" value={currency.format(metrics.expenses)} note="Suma de VALOR en GASTOS" tone="rose" />
    </div>
    <section className="menu-card"><div className="section-heading"><div><h2>HOJAS Y FORMULARIOS</h2><p>Acceso directo a cada modulo visible del archivo original.</p></div></div>
      <div className="module-grid">{menuItems.filter((item) => item.key !== 'MENU').map((item) => <button key={item.key} className="module-tile" type="button" onClick={() => onNavigate(item.key)}><span className="tile-icon">{item.icon}</span><span><strong>{item.label}</strong><small>{item.key === 'BALANCE' ? 'Historial mensual' : `${data[item.key as ModuleKey].length} registros`}</small></span><span className="tile-arrow">-&gt;</span></button>)}</div>
    </section>
      <section className="logic-card"><div><p className="eyebrow">RELACIONES DEL LIBRO</p><h2>Relaciones de las hojas activas</h2><p>INVENTARIO_PT toma entradas y ventas. BALANCE guarda un resumen por cada periodo, incluidos septiembre y los meses siguientes.</p></div><div className="flow-line"><span>HOJAS ACTIVAS</span><b>-&gt;</b><span>REGISTROS</span><b>-&gt;</b><span>BALANCE</span></div></section>
  </section>
}
function SummaryCard({ label, value, note, tone }: { label: string; value: string; note: string; tone: string }) {
  return <article className="summary-card"><div className="summary-top"><span>{label}</span><span className={'summary-icon ' + tone}>*</span></div><strong>{value}</strong><small>{note}</small></article>
}

function ModuleView({ module, data, rows, totalRows, search, onSearch, onNew, onNotice }: { module: ModuleKey; data: Record<ModuleKey, WorkbookRow[]>; rows: WorkbookRow[]; totalRows: number; search: string; onSearch: (value: string) => void; onNew: () => void; onNotice: (message: string) => void }) {
  const columns = moduleColumns[module]
  const isReport = module === 'BALANCE'
  return <section className="page-content">
    <div className="page-heading"><div><p className="eyebrow">HOJA DEL LIBRO</p><h1>{module}</h1><p className="page-description">{moduleDescription(module)}</p></div>{editableModules.has(module) && <button className="primary-button" type="button" onClick={onNew}><span className="plus">+</span> Nuevo registro</button>}</div>
    {isReport ? <ReportView data={data} /> : <section className="catalog-card"><div className="catalog-header"><div><h2>{module}</h2><p>{columns.length} columnas - {totalRows} registros - busqueda en todos los campos</p></div><label className="search-box"><span>?</span><input aria-label={'Buscar en ' + module} value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Buscar en la hoja..." /><kbd>Ctrl K</kbd></label></div><div className="table-wrap"><table><thead><tr>{columns.filter((column) => module !== 'CLIENTES' || column.key !== 'Columna1').map((column) => <th key={column.key}>{column.label}</th>)}{module === 'CLIENTES' && <><th>SALDO PENDIENTE</th><th>ESTADO DE CUENTA</th></>}</tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={columns.length + (module === 'CLIENTES' ? 1 : 0)} className="empty-state"><strong>Sin registros</strong><span>Usa Nuevo registro para capturar un dato.</span></td></tr> : rows.map((row, index) => { const clientName = String(row.NOMBRE ?? '').trim(); const statementRows = getClientTransactions(data.CREDITOS, clientName); return <tr key={module + '-' + String(row.id ?? index)}>{columns.filter((column) => module !== 'CLIENTES' || column.key !== 'Columna1').map((column) => <td key={column.key}>{formatCell(row[column.key], column.key)}</td>)}{module === 'CLIENTES' && <><td className="client-balance">{currency.format(Number(row.Columna1 ?? 0))}</td><td><div className="client-actions"><button type="button" className="small-action" onClick={() => downloadClientStatement(clientName, statementRows)}>Descargar PDF</button><button type="button" className="small-action" onClick={() => void shareClientStatement(clientName, statementRows, onNotice)}>Compartir</button></div></td></>}</tr> })}</tbody></table></div><footer className="table-footer"><span>Mostrando <strong>{rows.length}</strong> de <strong>{totalRows}</strong> registros</span><span className="footer-note">{module === 'CLIENTES' ? 'El saldo y estado de cuenta se calculan desde CREDITOS.' : 'Los campos y nombres siguen la hoja original.'}</span></footer></section>}
  </section>
}

type MonthlyBalance = { month: number; year: number; openingFund: number; cashSales: number; transferSales: number; totalCollections: number; availableCash: number; creditsGranted: number; payments: number; returns: number; receivables: number; productionCosts: number; nonProducedCosts: number; fixedCosts: number; operatingExpenses: number; totalExpenses: number; remainingCash: number; withdrawalRate: number; suggestedWithdrawal: number; nextFund: number }
const BALANCE_STORAGE_KEY = 'sportivos-monthly-balances-v1'
const monthLabels = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const septemberBalance: MonthlyBalance = { month: 9, year: 2026, openingFund: 1000000, cashSales: 543000, transferSales: 1989000, totalCollections: 2532000, availableCash: 3532000, creditsGranted: 1198000, payments: 2532000, returns: 0, receivables: 5181000, productionCosts: 0, nonProducedCosts: 985000, fixedCosts: 9500, operatingExpenses: 108000, totalExpenses: 1093000, remainingCash: 2439000, withdrawalRate: 0.2, suggestedWithdrawal: 506400, nextFund: 1932600 }
function readBalanceHistory(): MonthlyBalance[] { try { const value = JSON.parse(localStorage.getItem(BALANCE_STORAGE_KEY) ?? 'null'); if (Array.isArray(value)) return value as MonthlyBalance[] } catch { localStorage.removeItem(BALANCE_STORAGE_KEY) } return [septemberBalance] }
function parseBalanceSnapshot(value: unknown): MonthlyBalance | null {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    if (parsed && typeof parsed === 'object' && 'month' in parsed && 'year' in parsed && 'nextFund' in parsed) return parsed as MonthlyBalance
  } catch { }
  return null
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
    'Ventas registradas - otros medios': 0,
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
  const existing = await supabase.from('balance').select('id').eq(monthColumn, report.month).eq(yearColumn, report.year)
  if (existing.error) throw new Error(existing.error.message)
  const payload = toRemoteBalance(report)
  if (existing.data?.length) {
    const update = await supabase.from('balance').update(payload).eq('id', existing.data[0].id)
    if (update.error) throw new Error(update.error.message)
    for (const duplicate of existing.data.slice(1)) {
      const remove = await supabase.from('balance').delete().eq('id', duplicate.id)
      if (remove.error) throw new Error(remove.error.message)
    }
    return
  }
  const insert = await supabase.from('balance').insert(payload)
  if (insert.error) throw new Error(insert.error.message)
}
function calculateBalance(data: Record<ModuleKey, WorkbookRow[]>, month: number, year: number, openingFund: number, withdrawalRate: number): MonthlyBalance {
  const sales = data.VENTAS.filter((row) => matchesPeriod(row, month, year))
  const credits = data.CREDITOS.filter((row) => matchesPeriod(row, month, year))
  const expenses = data.GASTOS.filter((row) => matchesPeriod(row, month, year))
  const sum = (items: WorkbookRow[], key: string) => items.reduce((total, row) => total + Number(row[key] ?? 0), 0)
  const cashSales = sum(sales.filter((row) => String(row.MEDIO_DE_PAGO ?? '').toLowerCase().includes('efectivo')), 'TOTAL') + sum(credits.filter((row) => row.TIPO === 'Abono' && String(row['MEDIO PAGO'] ?? '').toLowerCase().includes('efectivo')), 'VALOR')
  const transferSales = sum(sales.filter((row) => String(row.MEDIO_DE_PAGO ?? '').toLowerCase().includes('transfer')), 'TOTAL') + sum(credits.filter((row) => row.TIPO === 'Abono' && String(row['MEDIO PAGO'] ?? '').toLowerCase().includes('transfer')), 'VALOR')
  const totalCollections = cashSales + transferSales
  const creditsGranted = sum(credits.filter((row) => isCreditType(row.TIPO)), 'VALOR')
  const payments = sum(credits.filter((row) => row.TIPO === 'Abono'), 'VALOR')
  const receivables = Math.max(0, data.CREDITOS.reduce((total, row) => total + (isCreditType(row.TIPO) ? Number(row.VALOR ?? 0) : ['Abono', 'Devolución'].includes(String(row.TIPO ?? '')) ? -Number(row.VALOR ?? 0) : 0), 0))
  const nonProducedCosts = sum(expenses.filter((row) => Boolean(row.CODIGO_MP)), 'VALOR')
  const operatingExpenses = sum(expenses.filter((row) => !row.CODIGO_MP), 'VALOR')
  const productionCosts = 0
  const fixedCosts = expenses.filter((row) => Boolean(row.CODIGO_MP)).reduce((total, row) => total + Number(row.CANTIDAD ?? 0) * 500, 0)
  const totalExpenses = productionCosts + nonProducedCosts + operatingExpenses
  const suggestedWithdrawal = Math.round(totalCollections * withdrawalRate)
  const returns = sum(credits.filter((row) => row.TIPO === 'Devolución'), 'VALOR')
  const remainingCash = openingFund + totalCollections - totalExpenses
  return { month, year, openingFund, cashSales, transferSales, totalCollections, availableCash: openingFund + totalCollections, creditsGranted, payments, returns, receivables, productionCosts, nonProducedCosts, fixedCosts, operatingExpenses, totalExpenses, remainingCash, withdrawalRate, suggestedWithdrawal, nextFund: remainingCash - suggestedWithdrawal }
}
function ReportView({ data }: { data: Record<ModuleKey, WorkbookRow[]> }) {
  const [month, setMonth] = useState(10)
  const [year, setYear] = useState(2026)
  const [openingFund, setOpeningFund] = useState(() => septemberBalance.nextFund)
  const [withdrawalPercent, setWithdrawalPercent] = useState(20)
  const [history, setHistory] = useState<MonthlyBalance[]>(readBalanceHistory)
  const [generated, setGenerated] = useState<MonthlyBalance | null>(null)
  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    void (async () => {
      const result = await supabase.from('balance').select('*')
      if (result.error) throw new Error(result.error.message)
      const remoteHistory = (result.data ?? []).map((row) => parseBalanceSnapshot(row['Estado del período'])).filter((item): item is MonthlyBalance => item !== null)
      const localHistory = readBalanceHistory()
      const merged = [...localHistory.filter((local) => !remoteHistory.some((remote) => remote.month === local.month && remote.year === local.year)), ...remoteHistory]
      if (!remoteHistory.some((item) => item.month === 9 && item.year === 2026)) await persistRemoteBalance(septemberBalance)
      for (const item of merged) {
        if (!remoteHistory.some((remote) => remote.month === item.month && remote.year === item.year)) await persistRemoteBalance(item)
      }
      merged.sort((a, b) => a.year - b.year || a.month - b.month)
      if (!cancelled) {
        setHistory(merged)
        localStorage.setItem(BALANCE_STORAGE_KEY, JSON.stringify(merged))
      }
    })().catch((error) => {
      if (!cancelled) window.dispatchEvent(new CustomEvent('sportivos:notice', { detail: 'No se pudo sincronizar el historial de balances: ' + (error instanceof Error ? error.message : 'error de conexión') }))
    })
    return () => { cancelled = true }
  }, [])
  const report = generated?.month === month && generated.year === year ? generated : calculateBalance(data, month, year, openingFund, withdrawalPercent / 100)
  const title = `ESTADO DE RESULTADOS Y FLUJO DE CAJA: ${monthLabels[month - 1]?.toUpperCase()} ${year}`
  function updatePeriod(nextMonth: number, nextYear: number) {
    setMonth(nextMonth); setYear(nextYear); setGenerated(null)
    const priorMonth = nextMonth === 1 ? 12 : nextMonth - 1; const priorYear = nextMonth === 1 ? nextYear - 1 : nextYear
    const prior = history.find((item) => item.month === priorMonth && item.year === priorYear)
    if (prior) setOpeningFund(prior.nextFund)
  }
  function generate() { setGenerated(calculateBalance(data, month, year, openingFund, withdrawalPercent / 100)) }
  async function save() {
    const current = calculateBalance(data, month, year, openingFund, withdrawalPercent / 100)
    const next = [...history.filter((item) => item.month !== month || item.year !== year), current].sort((a, b) => a.year - b.year || a.month - b.month)
    setHistory(next); localStorage.setItem(BALANCE_STORAGE_KEY, JSON.stringify(next)); setGenerated(current)
    try {
      await persistRemoteBalance(current)
      if (supabase) window.dispatchEvent(new CustomEvent('sportivos:notice', { detail: 'Balance guardado y sincronizado para todos tus dispositivos.' }))
    } catch (error) {
      window.dispatchEvent(new CustomEvent('sportivos:notice', { detail: 'No se pudo sincronizar el balance. Quedó guardado en este dispositivo: ' + (error instanceof Error ? error.message : 'error de conexión') }))
    }
  }
  function viewSaved(item: MonthlyBalance) { setMonth(item.month); setYear(item.year); setOpeningFund(item.openingFund); setWithdrawalPercent(item.withdrawalRate * 100); setGenerated(item) }
  return <div className="balance-workspace"><section className="balance-controls"><label>Mes<select value={month} onChange={(event) => updatePeriod(Number(event.target.value), year)}>{monthLabels.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}</select></label><label>Año<input type="number" min="2000" max="2200" value={year} onChange={(event) => updatePeriod(month, Number(event.target.value))} /></label><label>Fondo mes anterior<input type="number" min="0" value={openingFund} onChange={(event) => { setOpeningFund(Number(event.target.value)); setGenerated(null) }} /></label><label>% retiro sugerido<input type="number" min="0" max="100" step="0.1" value={withdrawalPercent} onChange={(event) => { setWithdrawalPercent(Number(event.target.value)); setGenerated(null) }} /></label><div className="balance-actions"><button className="secondary-button" type="button" onClick={generate}>Generar balance</button><button className="primary-button" type="button" onClick={save}>Guardar balance</button></div></section>
    <section className="excel-balance" aria-label="Balance mensual con formato del Excel"><div className="balance-sheet-top"><span><b>% Retiro Sugerido:</b> {number.format(report.withdrawalRate * 100)}%</span><span><b>Fondo Mes Anterior:</b> {currency.format(report.openingFund)}</span></div><h2 className="balance-sheet-title">{title}</h2>
      <BalanceSection title="1. FLUJO DE CAJA Y DISPONIBILIDAD" rows={[["(+) Saldo / Fondo de Reserva Mes Anterior", report.openingFund], ["(+) Recaudo en Efectivo (Ventas + Abonos)", report.cashSales], ["(+) Recaudo en Transferencias (Ventas + Abonos)", report.transferSales], ["(=) Total Recaudo Generado Este Mes", report.totalCollections, 'gray'], ["(=) TOTAL CAJA DISPONIBLE", report.availableCash, 'blue']]} />
      <BalanceSection title="2. CUENTAS POR COBRAR (CxC) - [INFORMATIVO]" rows={[["(+) Créditos Otorgados (Solo en este mes)", report.creditsGranted], ["(-) Abonos Recibidos (Solo en este mes)", report.payments], ["(-) Devoluciones Realizadas (Solo en este mes)", report.returns], ["(=) Saldo Total Pendiente de Cobro (Histórico)", report.receivables, 'gray']]} />
      <BalanceSection title="3. COSTOS Y GASTOS OPERATIVOS" rows={[["(-) Costos de Producción (Materia Prima)", report.productionCosts], ["(-) Costos No Producidos (Total Compras)", report.nonProducedCosts], ["    + De los cuales: Costos Fijos", report.fixedCosts], ["(-) Gastos Operativos (Viáticos)", report.operatingExpenses], ["(=) TOTAL EGRESOS DEL MES", report.totalExpenses, 'peach'], ["(=) CAJA RESTANTE TRAS PAGAR EGRESOS", report.remainingCash, 'blue']]} />
      <BalanceSection title="4. RESULTADO FINANCIERO Y DISTRIBUCIÓN" rows={[["(+) Total Recaudo Generado Este Mes", report.totalCollections], [`(-) Retiro Sugerido (${number.format(report.withdrawalRate * 100)}% del Recaudo)`, report.suggestedWithdrawal, 'yellow'], ["(=) NUEVO FONDO / CAPITAL PRÓXIMO MES", report.nextFund, 'blue']]} />
      <p className="balance-note">Las compras con código registradas en GASTOS se muestran en Costos No Producidos. Materia prima queda en cero porque ese inventario no se gestiona en esta versión. El valor de costos fijos es informativo y se calcula con CANTIDAD × $500.</p></section>
    <section className="balance-history"><div className="section-heading"><div><h2>Balances guardados</h2><p>Los cierres quedan dentro de este mismo módulo, uno por mes.</p></div></div><div className="table-wrap"><table><thead><tr><th>PERIODO</th><th>FONDO INICIAL</th><th>TOTAL RECAUDO</th><th>RETIRO SUGERIDO</th><th>FONDO PRÓXIMO MES</th><th></th></tr></thead><tbody>{history.map((item) => <tr key={`${item.year}-${item.month}`}><td>{monthLabels[item.month - 1]} {item.year}</td><td>{currency.format(item.openingFund)}</td><td>{currency.format(item.totalCollections)}</td><td>{currency.format(item.suggestedWithdrawal)}</td><td>{currency.format(item.nextFund)}</td><td><button type="button" className="small-action" onClick={() => viewSaved(item)}>Ver balance</button></td></tr>)}</tbody></table></div></section>
  </div>
}

function BalanceSection({ title, rows }: { title: string; rows: Array<[string, number, string?]> }) { return <section className="balance-section"><h3>{title}</h3>{rows.map(([label, amount, tone]) => <div key={label} className={`balance-row ${tone ? `balance-${tone}` : ''}`}><span>{label}</span><strong>{currency.format(amount)}</strong></div>)}</section> }

function RecordForm({ module, data, onClose, onSave }: { module: ModuleKey; data: Record<ModuleKey, WorkbookRow[]>; onClose: () => void; onSave: (row: WorkbookRow) => Promise<void> | void }) {
  const isCreditForm = module === 'CREDITOS'
  const columns = moduleColumns[module].filter((column) => !['ENTRADAS', 'SALIDAS', 'STOCK', 'GANANCIA', 'TOTAL', 'DEUDA', 'Columna1', 'COSTO TOTAL', 'CONSIGNACION'].includes(column.key) && !(module === 'INVENTARIO_PT' && ['PRECIO', 'PRECIO_AL_POR_MAYOR', 'COSTO', 'Costo fijo', 'Costo MO'].includes(column.key)) && (column.key !== 'VALOR' || module === 'CREDITOS') && (column.key !== 'MES' || module === 'GASTOS'))
  const clientNames = useMemo(() => Array.from(new Set([...data.CLIENTES, ...data.CREDITOS].map((row) => String(row.NOMBRE ?? '').trim()).filter(Boolean))), [data.CLIENTES, data.CREDITOS])
  const creditKeys = ['TIPO', 'FECHA', 'NOMBRE', 'CODIGO', 'DETALLE', 'CANT', 'DESCUENTO', 'PRECIO', 'VALOR', 'COMENTARIO', 'MEDIO PAGO']
  const [values, setValues] = useState<WorkbookRow>(() => Object.fromEntries(columns.map((column) => [column.key, column.type === 'date' ? new Date().toISOString().slice(0, 10) : column.key === 'TIPO' ? CREDIT_TYPE : column.key === 'MES' && module === 'GASTOS' ? 'Otro' : column.key === 'COSTO FIJO' ? 500 : column.key === 'NOMBRE' && clientNames[0] ? clientNames[0] : column.type === 'number' ? '' : ''])) as WorkbookRow)
  const [error, setError] = useState('')
  const isAbono = String(values.TIPO ?? '') === 'Abono'
  const isReduction = isCreditForm && ['Abono', 'Devolución'].includes(String(values.TIPO ?? ''))
  const formColumns = isCreditForm ? creditKeys.map((key) => columns.find((column) => column.key === key)).filter((column): column is Column => column !== undefined && !(isReduction && ['CODIGO', 'DETALLE', 'CANT', 'DESCUENTO', 'PRECIO'].includes(column.key))) : columns
  const selectedClient = String(values.NOMBRE ?? '').trim()
  const currentDebt = isCreditForm ? getClientDebt(data.CREDITOS, selectedClient) : 0
  const transactionValue = isCreditForm && isReduction ? Number(values.VALOR ?? 0) : Number(values.VALOR ?? 0) || Number(values.CANT ?? 0) * Number(values.PRECIO ?? 0) - Number(values.DESCUENTO ?? 0)
  const projectedDebt = currentDebt + (isReduction ? -transactionValue : transactionValue)

  function update(key: string, value: string) {
    setValues((current) => {
      const next = { ...current, [key]: value }
      if (isCreditForm && key === 'TIPO') {
        if (value === 'Abono') {
          next.CODIGO = ''
          next.DETALLE = ''
          next.CANT = ''
          next.DESCUENTO = '0'
          next.PRECIO = '0'
          next.VALOR = ''
          next.COMENTARIO = 'Abono'
        } else if (current.COMENTARIO === 'Abono') {
          next.COMENTARIO = ''
          next.VALOR = ''
        }
      }
      return next
    })
    setError('')
  }
  function isDisabled(key: string) { return isCreditForm && isReduction && ['CODIGO', 'DETALLE', 'CANT', 'DESCUENTO', 'PRECIO'].includes(key) }
  function isRequired(column: { key: string; required?: boolean }) {
    if (!isCreditForm) return Boolean(column.required)
    if (['TIPO', 'FECHA', 'NOMBRE'].includes(column.key)) return true
    if (column.key === 'VALOR') return isReduction
    if (column.key === 'PRECIO') return !isReduction
    return !isReduction && ['CODIGO', 'DETALLE', 'CANT'].includes(column.key)
  }
  function submit(event: React.FormEvent) {
    event.preventDefault()
    const missing = formColumns.filter((column) => isRequired(column) && !String(values[column.key] ?? '').trim())
    if (missing.length) { setError('Completa: ' + missing.map((column) => column.label).join(', ') + '.'); return }
    if (isCreditForm && transactionValue <= 0) { setError('Indica un valor mayor que cero.'); return }
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
          return <label key={column.key} className={disabled ? 'field-disabled' : ''}>{column.label}{isRequired(column) && <span>*</span>}
            {customerSelect ? <select value={String(values[column.key] ?? '')} onChange={(event) => update(column.key, event.target.value)}><option value="">Selecciona un cliente</option>{clientNames.map((name) => <option key={name} value={name}>{name}</option>)}</select>
              : column.type === 'select' ? <select disabled={disabled} value={String(values[column.key] ?? '')} onChange={(event) => update(column.key, event.target.value)}>{(column.options ?? []).map((option) => <option key={option}>{option}</option>)}</select>
                : <input disabled={disabled} autoFocus={index === 0} type={column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : 'text'} step={column.type === 'number' ? 'any' : undefined} value={String(values[column.key] ?? '')} onChange={(event) => update(column.key, event.target.value)} placeholder={column.type === 'number' ? '0' : ''} />}
          </label>
        })}</div>
        {module === 'INVENTARIO_PT' && <p className="form-hint">PRECIO, costo y existencias son calculados. Los costos se consultan en COSTOS_NO_PRODUCIDOS; las hojas de costos ocultas y consignaciones no se cargan en esta PWA.</p>}
        {isCreditForm && <div className="debt-preview" aria-live="polite">
          <div><span>Deuda actual de {selectedClient || 'cliente'}</span><strong>{currency.format(currentDebt)}</strong></div>
          <div><span>{isAbono ? 'Saldo despues del abono' : values.TIPO === 'Devolución' ? 'Saldo despues de la devolución' : 'Nueva deuda con este credito'}</span><strong className={projectedDebt < 0 ? 'debt-negative' : ''}>{currency.format(projectedDebt)}</strong></div>
        </div>}
        {isCreditForm && isReduction && <p className="form-hint">El valor del abono o devolución se guarda en VALOR. En Abono, PRECIO se conserva en cero y los campos de producto no aplican.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancelar</button><button className="primary-button" type="submit">Guardar registro</button></div>
      </form>
    </section>
  </div>
}

function getRows(module: ModuleKey | 'MENU', data: Record<ModuleKey, WorkbookRow[]>): WorkbookRow[] {
  if (module === 'MENU') return []
  if (module === 'INVENTARIO_PT') {
    const entries = sumBy(data.ENTRADAS, 'CODIGO', 'CANTIDAD')
    const sales = sumBy(data.VENTAS, 'CODIGO', 'CANT')
    const credits = sumBy(data.CREDITOS.filter((row) => isCreditType(row.TIPO)), 'CODIGO', 'CANT')
    return data.INVENTARIO_PT.map((row) => {
      const incoming = entries[String(row.CODIGO ?? '')] ?? Number(row.ENTRADAS ?? 0)
      const outgoing = (sales[String(row.CODIGO ?? '')] ?? 0) + (credits[String(row.CODIGO ?? '')] ?? 0)
      return { ...row, ENTRADAS: incoming, SALIDAS: outgoing, STOCK: incoming - outgoing, GANANCIA: Number(row.PRECIO_AL_POR_MAYOR ?? 0) - Number(row.COSTO ?? 0) }
    })
  }
  if (module === 'CLIENTES') return data.CLIENTES.map((row) => ({ ...row, Columna1: getClientDebt(data.CREDITOS, String(row.NOMBRE ?? '').trim()) }))
  if (module === 'COSTOS_NO_PRODUCIDOS') return data.COSTOS_NO_PRODUCIDOS.map((row) => ({ ...row, 'COSTO TOTAL': Number(row.COSTO ?? 0) + Number(row['COSTO FIJO'] ?? 0), Columna1: Number(row['PRECIO AL PUBLICO'] ?? 0) - (Number(row.COSTO ?? 0) + Number(row['COSTO FIJO'] ?? 0)) }))
  return data[module]
}

function sumBy(rows: WorkbookRow[], groupKey: string, valueKey: string): Record<string, number> {
  return rows.reduce<Record<string, number>>((result, row) => {
    const group = String(row[groupKey] ?? '')
    if (group) result[group] = (result[group] ?? 0) + Number(row[valueKey] ?? 0)
    return result
  }, {})
}
function isCreditType(value: CellValue): boolean {
  const text = String(value ?? '').trim().toLowerCase()
  return text === 'crédito' || text === 'credito'
}
function getClientDebt(rows: WorkbookRow[], clientName: string): number {
  if (!clientName) return 0
  return rows.filter((row) => String(row.NOMBRE ?? '').trim().toLowerCase() === clientName.trim().toLowerCase()).reduce((balance, row) => {
    const value = Number(row.VALOR ?? 0)
    return balance + (row.TIPO === 'Abono' || row.TIPO === 'Devolución' ? -value : isCreditType(row.TIPO) ? value : 0)
  }, 0)
}
function getClientTransactions(rows: WorkbookRow[], clientName: string): WorkbookRow[] {
  return rows.filter((row) => String(row.NOMBRE ?? '').trim().toLowerCase() === clientName.toLowerCase()).sort((a, b) => rowDateValue(a.FECHA) - rowDateValue(b.FECHA))
}
function rowDateValue(value: CellValue): number {
  if (typeof value === 'number') return new Date(Date.UTC(1899, 11, 30) + value * 86400000).getTime()
  const raw = String(value ?? '').trim()
  const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (dmy) return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1])).getTime()
  const timestamp = Date.parse(raw)
  return Number.isNaN(timestamp) ? 0 : timestamp
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
  if (module === 'INVENTARIO_PT') {
    const code = String(next.CODIGO ?? '').trim().toLowerCase()
    const cost = data.COSTOS_NO_PRODUCIDOS.find((item) => String(item.CODIGO ?? '').trim().toLowerCase() === code)
    const entryCount = sumBy(data.ENTRADAS, 'CODIGO', 'CANTIDAD')[String(next.CODIGO ?? '')] ?? 0
    const saleCount = sumBy(data.VENTAS, 'CODIGO', 'CANT')[String(next.CODIGO ?? '')] ?? 0
    const creditCount = sumBy(data.CREDITOS.filter((item) => isCreditType(item.TIPO)), 'CODIGO', 'CANT')[String(next.CODIGO ?? '')] ?? 0
    next.PRECIO = cost ? Number(cost['PRECIO AL PUBLICO'] ?? 0) : null
    next.PRECIO_AL_POR_MAYOR = null
    next.COSTO = cost ? Number(cost['COSTO TOTAL'] ?? Number(cost.COSTO ?? 0) + Number(cost['COSTO FIJO'] ?? 0)) : null
    next['Costo fijo'] = cost ? Number(cost['COSTO FIJO'] ?? 0) : null
    next['Costo MO'] = null
    next.GANANCIA = next.PRECIO === null || next.COSTO === null ? null : Number(next.PRECIO) - Number(next.COSTO)
    next.ENTRADAS = entryCount
    next.SALIDAS = saleCount + creditCount
    next.CONSIGNACION = 0
    next.STOCK = entryCount - saleCount - creditCount
  }
  if (module === 'VENTAS') {
    next.TOTAL = Number(next.CANT ?? 0) * Number(next.PRECIO ?? 0) - Number(next.DESCUENTO ?? 0)
    next.MES = monthName(String(next.FECHA ?? ''))
  }
  if (module === 'CREDITOS') {
    const type = next.TIPO === 'Abono' ? 'Abono' : next.TIPO === 'Devolución' ? 'Devolución' : CREDIT_TYPE
    const clientName = String(next.NOMBRE ?? '').trim()
    next.TIPO = type
    next.NOMBRE = clientName
    if (type === 'Abono') {
      next.CODIGO = null
      next.DETALLE = null
      next.CANT = null
      next.DESCUENTO = 0
      next.COMENTARIO = 'Abono'
      next.PRECIO = 0
      next.VALOR = Number(next.VALOR ?? 0)
    } else if (type === 'Devolución') {
      next.CODIGO = null
      next.DETALLE = null
      next.CANT = null
      next.DESCUENTO = 0
      next.PRECIO = 0
      next.COMENTARIO = String(next.COMENTARIO ?? 'Devolución')
      next.VALOR = Number(next.VALOR ?? 0)
    } else {
      next.VALOR = Number(next.VALOR ?? 0) || Number(next.CANT ?? 0) * Number(next.PRECIO ?? 0) - Number(next.DESCUENTO ?? 0)
    }
    next.DEUDA = getClientDebt(data.CREDITOS, clientName) + (type === 'Abono' || type === 'Devolución' ? -Number(next.VALOR ?? 0) : Number(next.VALOR ?? 0))
    next.MES = monthName(String(next.FECHA ?? ''))
  }
  if (module === 'ENTRADAS') next.Columna1 = Number(next.CANTIDAD ?? 0) * Number(next.PRECIO ?? 0)
  if (module === 'COSTOS_NO_PRODUCIDOS') {
    if (next['COSTO FIJO'] === null || next['COSTO FIJO'] === undefined || next['COSTO FIJO'] === '') next['COSTO FIJO'] = 500
    next['COSTO TOTAL'] = Number(next.COSTO ?? 0) + Number(next['COSTO FIJO'] ?? 0)
    next.Columna1 = Number(next['PRECIO AL PUBLICO'] ?? 0) - Number(next['COSTO TOTAL'] ?? 0)
  }
  return next
}
function formatCell(value: CellValue, key: string): string {
  if (value === null || value === undefined || value === '') return '-'
  if (key.includes('PRECIO') || key.includes('COSTO') || key === 'VALOR' || key === 'TOTAL' || key === 'DEUDA' || key === 'GANANCIA' || key === 'DESCUENTO') return currency.format(Number(value))
  if (key === 'FECHA' || key === 'FECHA DE PAGO') return String(value).slice(0, 10)
  return typeof value === 'number' ? number.format(value) : String(value)
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
  }
  return descriptions[module] ?? ''
}
function getMetrics(data: Record<ModuleKey, WorkbookRow[]>) {
  const sales = data.VENTAS.reduce((total, row) => total + Number(row.TOTAL ?? 0), 0)
  const cashSales = data.VENTAS.filter((row) => String(row.MEDIO_DE_PAGO).includes('Efectivo')).reduce((total, row) => total + Number(row.TOTAL ?? 0), 0)
  const transferSales = data.VENTAS.filter((row) => String(row.MEDIO_DE_PAGO).includes('Transferencia')).reduce((total, row) => total + Number(row.TOTAL ?? 0), 0)
  const expenses = data.GASTOS.reduce((total, row) => total + Number(row.VALOR ?? 0), 0)
  const materialExpenses = data.GASTOS.filter((row) => row.CODIGO_MP).reduce((total, row) => total + Number(row.VALOR ?? 0), 0)
  const creditsPaid = data.CREDITOS.filter((row) => row.TIPO === 'Abono').reduce((total, row) => total + Number(row.VALOR ?? 0), 0)
  return { products: data.INVENTARIO_PT.length, stock: getRows('INVENTARIO_PT', data).reduce((total, row) => total + Number(row.STOCK ?? 0), 0), sales, cashSales, transferSales, expenses, materialExpenses, operatingExpenses: expenses - materialExpenses, creditsPaid }
}
function loadData(force = false): Record<ModuleKey, WorkbookRow[]> {
  if (!force) {
    const saved = localStorage.getItem('sportivos-workbook-v1')
    if (saved) {
      try {
        const stored = JSON.parse(saved) as Partial<Record<ModuleKey, WorkbookRow[]>>
        const activeData = Object.fromEntries((Object.keys(moduleColumns) as ModuleKey[]).map((module) => [module, Array.isArray(stored[module]) ? stored[module] : []])) as Record<ModuleKey, WorkbookRow[]>
        localStorage.setItem('sportivos-workbook-v1', JSON.stringify(activeData))
        return activeData
      } catch { localStorage.removeItem('sportivos-workbook-v1') }
    }
  }
  const next = cloneInitialData()
  localStorage.setItem('sportivos-workbook-v1', JSON.stringify(next))
  return next
}

export default App

