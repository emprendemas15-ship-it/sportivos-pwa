import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { calculateInventoryProfit, cleanExcelError, monthName, moduleColumns, type CellValue, type Column, type ModuleKey, type WorkbookRow } from './lib/workbook'
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
type SyncState = 'syncing' | 'synced' | 'error'
type CreditFilters = { name: string; type: string; from: string; to: string }

function App() {
  const { data, syncState, syncError, writeBlocked, refreshAll, markWriteFailure, markWriteSuccess } = useWorkbookSync()
  const balanceHistory = useSavedBalances()
  const [active, setActive] = useState<ModuleKey | 'MENU'>('MENU')
  const [search, setSearch] = useState('')
  const [creditFilters, setCreditFilters] = useState<CreditFilters>({ name: '', type: '', from: '', to: '' })
  const [showForm, setShowForm] = useState(false)
  const [notice, setNotice] = useState('')

  const rows = useMemo(() => {
    const currentRows = getRows(active, data)
    if (active === 'MENU' || active === 'BALANCE' || active === 'CREDITOS') return currentRows
    return [...currentRows].sort((a, b) => rowCreatedAtValue(b) - rowCreatedAtValue(a))
  }, [active, data])
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
    setSearch('')
    setShowForm(false)
  }

  async function saveRow(row: WorkbookRow) {
    if (active === 'MENU' || active === 'BALANCE') return
    if (syncState !== 'synced') {
      flashNotice('No se guardó: espera a que aparezca la conexión con la base compartida.')
      return
    }
    const normalized = normalizeRow(active, row, data)
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
      markWriteSuccess()
      await refreshAll()
      setShowForm(false)
      flashNotice('Registro guardado en ' + active + ' y sincronizado.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido'
      markWriteFailure('La base está en línea, pero no se pudo guardar el registro. ' + message)
      flashNotice('No se pudo guardar: ' + message)
    }
  }

  const connectionStatus = syncState === 'error' ? 'offline' : syncState === 'syncing' ? 'checking' : writeBlocked ? 'blocked' : 'online'
  const connectionLabel = connectionStatus === 'offline' ? 'Sin conexión' : connectionStatus === 'blocked' ? 'En línea · no guarda' : connectionStatus === 'checking' ? 'Conectando…' : 'En línea · listo'

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
        <div className="data-status"><i /> {hasSupabaseConfig ? 'Base compartida Supabase' : 'Base compartida no configurada'}</div>
      </div>
    </aside>
    <main className="main-content">
      <header className="topbar">
        <div className="breadcrumb"><button type="button" onClick={() => navigate('MENU')}>MENU</button><span>/</span><strong>{active}</strong></div>
        <div className="topbar-right"><span className="connection" data-state={connectionStatus} role="status" aria-live="polite" title={connectionStatus === 'online' ? 'Conectado con la base compartida; puedes guardar registros.' : connectionStatus === 'blocked' ? 'La base responde, pero el último intento de guardar falló. Puedes reintentar después de revisar el aviso.' : connectionStatus === 'offline' ? 'No se pudo conectar con la base compartida.' : 'Comprobando la conexión con la base compartida.'}><i aria-hidden="true" /><span>{connectionLabel}</span></span><button className="refresh-button" type="button" onClick={() => void refreshAll(true)} title="Volver a cargar los datos y recalcular existencias">Actualizar</button></div>
      </header>
      {notice && <div className="toast" role="status">{notice}</div>}
      {syncError && <div className="sync-warning" role="status">{syncError}</div>}
    {active === 'MENU' ? <Menu data={data} balances={balanceHistory} onNavigate={navigate} /> : <ModuleView module={active} data={data} rows={filteredRows} totalRows={rows.length} search={search} onSearch={setSearch} creditFilters={creditFilters} onCreditFiltersChange={setCreditFilters} onNew={() => { if (syncState === 'synced') setShowForm(true); else flashNotice('Espera a que conecte con la base compartida antes de agregar registros.') }} onNotice={flashNotice} />}
    </main>
    {showForm && active !== 'MENU' && <RecordForm module={active} data={data} onClose={() => setShowForm(false)} onSave={saveRow} />}
  </div>
}

function useWorkbookSync() {
  const [data, setData] = useState<Record<ModuleKey, WorkbookRow[]>>(emptyWorkbookData)
  const [syncState, setSyncState] = useState<SyncState>('syncing')
  const [syncError, setSyncError] = useState('')
  const [writeBlocked, setWriteBlocked] = useState(false)
  const refreshInFlight = useRef(false)
  const manualRefreshQueued = useRef(false)
  const hasLoadedRemote = useRef(false)
  const writeBlockedRef = useRef(false)

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

  const refreshAll = useCallback(async (showNotice = false) => {
    if (!supabase) {
      setSyncState('error')
      setSyncError('Esta aplicación no está conectada a la base compartida. No guardes registros desde esta versión.')
      if (showNotice) window.dispatchEvent(new CustomEvent('sportivos:notice', { detail: 'No se pudo actualizar: falta configurar la base compartida.' }))
      return
    }
    if (refreshInFlight.current) {
      if (showNotice) manualRefreshQueued.current = true
      return
    }
    refreshInFlight.current = true
    if (!hasLoadedRemote.current || showNotice) setSyncState('syncing')
    try {
      const remoteData = await readRemoteData()
      hasLoadedRemote.current = true
      setData(remoteData)
      setSyncError(writeBlockedRef.current ? 'La base está en línea, pero un intento de guardado fue rechazado. Revisa los permisos o intenta guardar de nuevo.' : '')
      setSyncState('synced')
      window.dispatchEvent(new CustomEvent('sportivos:balance-updated'))
      if (showNotice || manualRefreshQueued.current) window.dispatchEvent(new CustomEvent('sportivos:notice', { detail: 'Datos recargados y existencias recalculadas con los códigos normalizados. Solo se recuperan registros guardados en la base.' }))
      manualRefreshQueued.current = false
    } catch (error) {
      setSyncState('error')
      setSyncError('No hay conexión con la base compartida. Los cambios no se guardan; vuelve a conectar y pulsa Actualizar. ' + (error instanceof Error ? error.message : ''))
      if (showNotice || manualRefreshQueued.current) window.dispatchEvent(new CustomEvent('sportivos:notice', { detail: 'No se pudo actualizar desde la base compartida.' }))
      manualRefreshQueued.current = false
    } finally {
      refreshInFlight.current = false
    }
  }, [])

  useEffect(() => {
    void refreshAll()
    const timer = window.setInterval(() => void refreshAll(), 10000)
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

  return { data, syncState, syncError, writeBlocked, refreshAll, markWriteFailure, markWriteSuccess }
}

function useSavedBalances(): MonthlyBalance[] {
  const [balances, setBalances] = useState<MonthlyBalance[]>([])
  useEffect(() => {
    if (!supabase) return
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
      } finally { loading = false }
    }
    const refreshWhenActive = () => { if (document.visibilityState === 'visible') void refresh() }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 10000)
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
  return balances
}

async function readRemoteData(): Promise<Record<ModuleKey, WorkbookRow[]>> {
  if (!supabase) throw new Error('Falta la configuración de Supabase.')
  const client = supabase
  const entries = await Promise.all((Object.keys(remoteTableByModule) as ModuleKey[]).map(async (module) => {
    const table = remoteTableByModule[module]
    if (!table) return [module, []] as const
    const result = await client.from(table).select('*').order('created_at', { ascending: true })
    if (result.error) throw new Error(module + ': ' + result.error.message)
    return [module, (result.data ?? []).map((row) => fromRemoteRow(module, row as WorkbookRow))] as const
  }))
  return { ...emptyWorkbookData(), ...Object.fromEntries(entries) } as Record<ModuleKey, WorkbookRow[]>
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

function Menu({ data, balances, onNavigate }: { data: Record<ModuleKey, WorkbookRow[]>; balances: MonthlyBalance[]; onNavigate: (module: ModuleKey | 'MENU') => void }) {
  const metrics = getMetrics(data)
  return <section className="page-content home-page">
    <div className="page-heading"><div><p className="eyebrow">HOJA PRINCIPAL</p><h1>MENU</h1><p className="page-description">Vista de control del libro Sportivos: inventarios, ventas, cartera y reportes.</p></div><span className="reference-badge">Fuente: SPORTIVOS (1) (1).xlsm</span></div>
    <div className="summary-grid">
      <SummaryCard label="Productos terminados" value={number.format(metrics.products)} note="Registros en INVENTARIO_PT" tone="green" />
      <SummaryCard label="Stock disponible" value={number.format(metrics.stock)} note="ENTRADAS menos SALIDAS" tone="blue" />
      <SummaryCard label="Valor del stock" value={currency.format(metrics.stockValue)} note="Existencias actuales × costo unitario" tone="amber" />
      <SummaryCard label="Gastos registrados" value={currency.format(metrics.expenses)} note="Suma de VALOR en GASTOS" tone="rose" />
    </div>
    <BalanceTrend balances={balances} />
    <section className="menu-card home-module-menu"><div className="section-heading"><div><h2>HOJAS Y FORMULARIOS</h2><p>Acceso directo a cada modulo visible del archivo original.</p></div></div>
      <div className="module-grid">{menuItems.filter((item) => item.key !== 'MENU').map((item) => <button key={item.key} className="module-tile" type="button" onClick={() => onNavigate(item.key)}><span className="tile-icon">{item.icon}</span><span><strong>{item.label}</strong><small>{item.key === 'BALANCE' ? 'Historial mensual' : `${data[item.key as ModuleKey].length} registros`}</small></span><span className="tile-arrow">-&gt;</span></button>)}</div>
    </section>
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
function SummaryCard({ label, value, note, tone }: { label: string; value: string; note: string; tone: string }) {
  return <article className="summary-card"><div className="summary-top"><span>{label}</span><span className={'summary-icon ' + tone}>*</span></div><strong>{value}</strong><small>{note}</small></article>
}

function ModuleView({ module, data, rows, totalRows, search, onSearch, creditFilters, onCreditFiltersChange, onNew, onNotice }: { module: ModuleKey; data: Record<ModuleKey, WorkbookRow[]>; rows: WorkbookRow[]; totalRows: number; search: string; onSearch: (value: string) => void; creditFilters: CreditFilters; onCreditFiltersChange: (filters: CreditFilters) => void; onNew: () => void; onNotice: (message: string) => void }) {
  const columns = moduleColumns[module]
  const isReport = module === 'BALANCE'
  return <section className="page-content">
    <div className="page-heading"><div><p className="eyebrow">HOJA DEL LIBRO</p><h1>{module}</h1><p className="page-description">{moduleDescription(module)}</p></div>{editableModules.has(module) && <button className="primary-button" type="button" onClick={onNew}><span className="plus">+</span> Nuevo registro</button>}</div>
    {isReport ? <ReportView data={data} /> : <section className="catalog-card"><div className="catalog-header"><div><h2>{module}</h2><p>{columns.length} columnas - {rows.length} de {totalRows} registros{module === 'CREDITOS' ? ' - orden cronológico según los filtros' : ' - busqueda en todos los campos'}</p></div>{module === 'CREDITOS' ? <CreditFilterControls rows={data.CREDITOS} filters={creditFilters} onChange={onCreditFiltersChange} /> : <label className="search-box"><span>?</span><input aria-label={'Buscar en ' + module} value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Buscar en la hoja..." /><kbd>Ctrl K</kbd></label>}</div><div className="table-wrap"><table><thead><tr>{columns.filter((column) => module !== 'CLIENTES' || column.key !== 'Columna1').map((column) => <th key={column.key}>{column.label}</th>)}{module === 'CLIENTES' && <><th>SALDO PENDIENTE</th><th>ESTADO DE CUENTA</th></>}</tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={columns.length + (module === 'CLIENTES' ? 1 : 0)} className="empty-state"><strong>{module === 'CREDITOS' && totalRows > 0 ? 'No hay movimientos con esos filtros' : 'Sin registros'}</strong><span>{module === 'CREDITOS' && totalRows > 0 ? 'Prueba con otro nombre, tipo o rango de fechas.' : 'Usa Nuevo registro para capturar un dato.'}</span></td></tr> : rows.map((row, index) => { const clientName = String(row.NOMBRE ?? '').trim(); const statementRows = getClientTransactions(data.CREDITOS, clientName); return <tr key={module + '-' + String(row.id ?? index)}>{columns.filter((column) => module !== 'CLIENTES' || column.key !== 'Columna1').map((column) => <td key={column.key}>{formatCell(row[column.key], column.key)}</td>)}{module === 'CLIENTES' && <><td className="client-balance">{currency.format(Number(row.Columna1 ?? 0))}</td><td><div className="client-actions"><button type="button" className="small-action" onClick={() => downloadClientStatement(clientName, statementRows)}>Descargar PDF</button><button type="button" className="small-action" onClick={() => void shareClientStatement(clientName, statementRows, onNotice)}>Compartir</button></div></td></>}</tr> })}</tbody></table></div><footer className="table-footer"><span>Mostrando <strong>{rows.length}</strong> de <strong>{totalRows}</strong> registros</span>{module === 'CLIENTES' && <span className="footer-note">El saldo y estado de cuenta se calculan desde CREDITOS.</span>}</footer></section>}
  </section>
}

function CreditFilterControls({ rows, filters, onChange }: { rows: WorkbookRow[]; filters: CreditFilters; onChange: (filters: CreditFilters) => void }) {
  const names = Array.from(new Set(rows.map((row) => String(row.NOMBRE ?? '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'es'))
  const types = Array.from(new Set(rows.map((row) => String(row.TIPO ?? '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'es'))
  const update = (key: keyof CreditFilters, value: string) => onChange({ ...filters, [key]: value })
  const hasFilters = Object.values(filters).some(Boolean)
  const setDateRange = (range: 'month' | '30days') => {
    const today = new Date()
    const start = range === 'month' ? new Date(today.getFullYear(), today.getMonth(), 1) : new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29)
    const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    onChange({ ...filters, from: localDate(start), to: localDate(today) })
  }
  return <div className="credit-filters" aria-label="Filtros de créditos">
    <label>Nombre<input aria-label="Buscar movimientos por nombre" list="credit-client-name-options" placeholder="Escribe o elige una persona" value={filters.name} onChange={(event) => update('name', event.target.value)} /><datalist id="credit-client-name-options">{names.map((name) => <option key={name} value={name} />)}</datalist></label>
    <label>Tipo<select aria-label="Filtrar créditos por tipo" value={filters.type} onChange={(event) => update('type', event.target.value)}><option value="">Todos los tipos</option>{types.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
    <label>Desde<input aria-label="Fecha desde" type="date" value={filters.from} onChange={(event) => update('from', event.target.value)} /></label>
    <label>Hasta<input aria-label="Fecha hasta" type="date" value={filters.to} onChange={(event) => update('to', event.target.value)} /></label>
    <div className="credit-filter-actions"><div className="credit-date-presets"><button type="button" onClick={() => setDateRange('month')}>Este mes</button><button type="button" onClick={() => setDateRange('30days')}>Últimos 30 días</button></div>{hasFilters && <button type="button" className="clear-credit-filters" onClick={() => onChange({ name: '', type: '', from: '', to: '' })}>Limpiar filtros</button>}</div>
  </div>
}

type MonthlyBalance = { month: number; year: number; openingFund: number; cashSales: number; transferSales: number; totalCollections: number; availableCash: number; creditsGranted: number; payments: number; returns: number; refunds: number; receivables: number; productionCosts: number; nonProducedCosts: number; fixedCosts: number; operatingExpenses: number; totalExpenses: number; remainingCash: number; withdrawalRate: number; suggestedWithdrawal: number; nextFund: number }
const monthLabels = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const septemberBalance: MonthlyBalance = { month: 9, year: 2026, openingFund: 1000000, cashSales: 543000, transferSales: 1989000, totalCollections: 2532000, availableCash: 3532000, creditsGranted: 1198000, payments: 2532000, returns: 0, refunds: 0, receivables: 5181000, productionCosts: 0, nonProducedCosts: 985000, fixedCosts: 9500, operatingExpenses: 108000, totalExpenses: 1093000, remainingCash: 2439000, withdrawalRate: 0.2, suggestedWithdrawal: 506400, nextFund: 1932600 }
function parseBalanceSnapshot(value: unknown): MonthlyBalance | null {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    if (parsed && typeof parsed === 'object' && 'month' in parsed && 'year' in parsed && 'nextFund' in parsed) return { refunds: 0, ...parsed } as MonthlyBalance
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
  const cashSales = sum(sales.filter((row) => String(row.MEDIO_DE_PAGO ?? '').toLowerCase().includes('efectivo')), 'TOTAL') + sum(credits.filter((row) => row.TIPO === 'Abono' && String(row['MEDIO PAGO'] ?? '').toLowerCase().includes('efectivo')), 'VALOR')
  const transferSales = sum(sales.filter((row) => String(row.MEDIO_DE_PAGO ?? '').toLowerCase().includes('transfer')), 'TOTAL') + sum(credits.filter((row) => row.TIPO === 'Abono' && String(row['MEDIO PAGO'] ?? '').toLowerCase().includes('transfer')), 'VALOR')
  const totalCollections = cashSales + transferSales
  const creditsGranted = sum(credits.filter((row) => isCreditType(row.TIPO)), 'VALOR')
  const payments = sum(credits.filter((row) => row.TIPO === 'Abono'), 'VALOR')
  const receivables = Math.max(0, data.CREDITOS.reduce((total, row) => total + (isCreditType(row.TIPO) ? Number(row.VALOR ?? 0) : isAbonoType(row.TIPO) || isReturnType(row.TIPO) ? -Number(row.VALOR ?? 0) : 0), 0))
  const nonProducedCodes = new Set(data.COSTOS_NO_PRODUCIDOS.map((row) => String(row.CODIGO ?? '').trim().toLowerCase()).filter(Boolean))
  const nonProducedEntries = entries.filter((row) => nonProducedCodes.has(String(row.CODIGO ?? '').trim().toLowerCase()))
  const codedExpenses = expenses.filter((row) => Boolean(String(row.CODIGO_MP ?? '').trim()))
  const nonProducedExpenseRows = codedExpenses.filter((row) => nonProducedCodes.has(String(row.CODIGO_MP ?? '').trim().toLowerCase()))
  const productionExpenseRows = codedExpenses.filter((row) => !nonProducedCodes.has(String(row.CODIGO_MP ?? '').trim().toLowerCase()))
  const nonProducedCosts = entries.reduce((total, row) => total + (Number(row.Columna1 ?? 0) || Number(row.CANTIDAD ?? 0) * Number(row.PRECIO ?? 0)), 0) + sum(nonProducedExpenseRows, 'VALOR')
  const operatingExpenses = sum(expenses.filter((row) => !String(row.CODIGO_MP ?? '').trim()), 'VALOR')
  const productionCosts = sum(productionExpenseRows, 'VALOR')
  const fixedCosts = nonProducedEntries.reduce((total, row) => {
    const catalog = data.COSTOS_NO_PRODUCIDOS.find((item) => String(item.CODIGO ?? '').trim().toLowerCase() === String(row.CODIGO ?? '').trim().toLowerCase())
    return total + Number(row.CANTIDAD ?? 0) * Number(catalog?.['COSTO FIJO'] ?? 0)
  }, 0) + nonProducedExpenseRows.reduce((total, row) => {
    const catalog = data.COSTOS_NO_PRODUCIDOS.find((item) => String(item.CODIGO ?? '').trim().toLowerCase() === String(row.CODIGO_MP ?? '').trim().toLowerCase())
    return total + Number(row.CANTIDAD ?? 0) * Number(catalog?.['COSTO FIJO'] ?? 0)
  }, 0)
  const refunds = credits.filter((row) => isReturnType(row.TIPO)).reduce((total, row) => total + returnMarker(row.COMENTARIO).refund, 0)
  const totalExpenses = productionCosts + nonProducedCosts + operatingExpenses + refunds
  const suggestedWithdrawal = Math.round(totalCollections * withdrawalRate)
  const returns = credits.filter((row) => isReturnType(row.TIPO)).reduce((total, row) => total + Number(row.VALOR ?? 0) + returnMarker(row.COMENTARIO).refund, 0)
  const remainingCash = openingFund + totalCollections - totalExpenses
  return { month, year, openingFund, cashSales, transferSales, totalCollections, availableCash: openingFund + totalCollections, creditsGranted, payments, returns, refunds, receivables, productionCosts, nonProducedCosts, fixedCosts, operatingExpenses, totalExpenses, remainingCash, withdrawalRate, suggestedWithdrawal, nextFund: remainingCash - suggestedWithdrawal }
}
function ReportView({ data }: { data: Record<ModuleKey, WorkbookRow[]> }) {
  const [month, setMonth] = useState(10)
  const [year, setYear] = useState(2026)
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
  const report = generated?.month === month && generated.year === year ? generated : calculateBalance(data, month, year, openingFund, withdrawalPercent / 100)
  const hasCurrentReport = generated?.month === month && generated.year === year
  const title = `ESTADO DE RESULTADOS Y FLUJO DE CAJA: ${monthLabels[month - 1]?.toUpperCase()} ${year}`
  function updatePeriod(nextMonth: number, nextYear: number) {
    setMonth(nextMonth); setYear(nextYear); setGenerated(null)
    const priorMonth = nextMonth === 1 ? 12 : nextMonth - 1; const priorYear = nextMonth === 1 ? nextYear - 1 : nextYear
    const prior = history.find((item) => item.month === priorMonth && item.year === priorYear)
    if (prior) setOpeningFund(prior.nextFund)
  }
  function generate() { setGenerated(calculateBalance(data, month, year, openingFund, withdrawalPercent / 100)) }
  async function save() {
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
      <BalanceSection title="1. FLUJO DE CAJA Y DISPONIBILIDAD" rows={[["(+) Saldo / Fondo de Reserva Mes Anterior", report.openingFund], ["(+) Recaudo en Efectivo (Ventas + Abonos)", report.cashSales], ["(+) Recaudo en Transferencias (Ventas + Abonos)", report.transferSales], ["(=) Total Recaudo Generado Este Mes", report.totalCollections, 'gray'], ["(=) TOTAL CAJA DISPONIBLE", report.availableCash, 'blue']]} />
      <BalanceSection title="2. CUENTAS POR COBRAR (CxC) - [INFORMATIVO]" rows={[["(+) Créditos Otorgados (Solo en este mes)", report.creditsGranted], ["(-) Abonos Recibidos (Solo en este mes)", report.payments], ["(-) Devoluciones Realizadas (Solo en este mes)", report.returns], ["(=) Saldo Total Pendiente de Cobro (Histórico)", report.receivables, 'gray']]} />
      <BalanceSection title="3. COSTOS Y GASTOS OPERATIVOS" rows={[["(-) Costos de Producción (Materia Prima)", report.productionCosts], ["(-) Costos No Producidos (Total Compras)", report.nonProducedCosts], ["    + De los cuales: Costos Fijos", report.fixedCosts], ["(-) Gastos Operativos (Viáticos)", report.operatingExpenses], ["(-) Reembolsos entregados por devoluciones", report.refunds], ["(=) TOTAL EGRESOS DEL MES", report.totalExpenses, 'peach'], ["(=) CAJA RESTANTE TRAS PAGAR EGRESOS", report.remainingCash, 'blue']]} />
      <BalanceSection title="4. RESULTADO FINANCIERO Y DISTRIBUCIÓN" rows={[["(+) Total Recaudo Generado Este Mes", report.totalCollections], [`(-) Retiro Sugerido (${number.format(report.withdrawalRate * 100)}% del Recaudo)`, report.suggestedWithdrawal, 'yellow'], ["(=) NUEVO FONDO / CAPITAL PRÓXIMO MES", report.nextFund, 'blue']]} />
      <p className="balance-note">El balance incluye las compras registradas en ENTRADAS del mes. GASTOS se separa entre materia prima codificada y gastos operativos sin código.</p></section> : <section className="balance-empty"><strong>Balance sin generar</strong><span>Elige el mes y presiona “Generar balance” para ver el resumen; después puedes guardarlo.</span></section>}
    <section className="balance-history"><div className="section-heading"><div><h2>Balances guardados</h2><p>Los cierres quedan dentro de este mismo módulo, uno por mes.</p></div></div><div className="table-wrap"><table><thead><tr><th>PERIODO</th><th>FONDO INICIAL</th><th>TOTAL RECAUDO</th><th>RETIRO SUGERIDO</th><th>FONDO PRÓXIMO MES</th><th>ACCIONES</th></tr></thead><tbody>{history.map((item) => <tr key={`${item.year}-${item.month}`}><td>{monthLabels[item.month - 1]} {item.year}</td><td>{currency.format(item.openingFund)}</td><td>{currency.format(item.totalCollections)}</td><td>{currency.format(item.suggestedWithdrawal)}</td><td>{currency.format(item.nextFund)}</td><td><div className="client-actions"><button type="button" className="small-action" onClick={() => viewSaved(item)}>Ver balance</button><button type="button" className="small-action danger-action" onClick={() => void deleteSaved(item)}>Eliminar</button></div></td></tr>)}</tbody></table></div></section>
    {viewing && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setViewing(null) }}><section className="modal balance-summary-modal" role="dialog" aria-modal="true" aria-labelledby="saved-balance-title"><div className="modal-heading"><div><p className="eyebrow">RESUMEN GUARDADO</p><h2 id="saved-balance-title">{monthLabels[viewing.month - 1]} {viewing.year}</h2></div><button className="close-button" type="button" onClick={() => setViewing(null)} aria-label="Cerrar">×</button></div><div className="saved-balance-grid"><div><span>Recaudo del mes</span><strong>{currency.format(viewing.totalCollections)}</strong></div><div><span>Compras y gastos</span><strong>{currency.format(viewing.totalExpenses)}</strong></div><div><span>Saldo de caja tras gastos</span><strong>{currency.format(viewing.remainingCash)}</strong></div><div><span>Retiro sugerido</span><strong>{currency.format(viewing.suggestedWithdrawal)}</strong></div><div><span>Fondo con que inició</span><strong>{currency.format(viewing.openingFund)}</strong></div><div><span>Fondo para el siguiente mes</span><strong>{currency.format(viewing.nextFund)}</strong></div><div><span>Créditos otorgados</span><strong>{currency.format(viewing.creditsGranted)}</strong></div><div><span>Saldo por cobrar histórico</span><strong>{currency.format(viewing.receivables)}</strong></div></div><div className="modal-actions"><button className="primary-button" type="button" onClick={() => setViewing(null)}>Cerrar resumen</button></div></section></div>}
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
  const isAbono = isAbonoType(values.TIPO)
  const isReturn = isCreditForm && isReturnType(values.TIPO)
  const isReduction = isCreditForm && (isAbono || isReturn)
  const formColumns = isCreditForm ? creditKeys.map((key) => columns.find((column) => column.key === key)).filter((column): column is Column => column !== undefined && !(isAbono && ['CODIGO', 'DETALLE', 'CANT', 'DESCUENTO', 'PRECIO'].includes(column.key)) && !(isReturn && column.key === 'VALOR')) : columns
  const selectedClient = String(values.NOMBRE ?? '').trim()
  const currentDebt = isCreditForm ? getClientDebt(data.CREDITOS, selectedClient) : 0
  const returnValue = Math.max(0, Number(values.CANT ?? 0) * Number(values.PRECIO ?? 0) - Number(values.DESCUENTO ?? 0))
  const returnOptions = isReturn ? refundableProducts(data.CREDITOS, selectedClient) : []
  const selectedReturnOption = returnOptions.find((item) => normalizeCode(item.code) === normalizeCode(values.CODIGO))
  const proportionalUnpaid = selectedReturnOption ? selectedReturnOption.outstandingValue * Number(values.CANT ?? 0) / Math.max(1, selectedReturnOption.available) : 0
  const returnDebtPart = isReturn ? Math.min(currentDebt, returnValue, proportionalUnpaid) : 0
  const refundValue = Math.max(0, returnValue - returnDebtPart)
  const transactionValue = isReturn ? returnValue : isCreditForm && isAbono ? Number(values.VALOR ?? 0) : Number(values.VALOR ?? 0) || Number(values.CANT ?? 0) * Number(values.PRECIO ?? 0) - Number(values.DESCUENTO ?? 0)
  const projectedDebt = currentDebt + (isReturn ? -returnDebtPart : isAbono ? -transactionValue : transactionValue)
  const productRows = module === 'VENTAS' || module === 'ENTRADAS' || isCreditForm ? getRows('INVENTARIO_PT', data) : []

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
          next.VALOR = ''
        }
      }
      return next
    })
    setError('')
  }
  function isDisabled(key: string) { return isCreditForm && isAbono && ['CODIGO', 'DETALLE', 'CANT', 'DESCUENTO', 'PRECIO'].includes(key) }
  function isRequired(column: { key: string; required?: boolean }) {
    if (!isCreditForm) return Boolean(column.required)
    if (['TIPO', 'FECHA', 'NOMBRE'].includes(column.key)) return true
    if (column.key === 'VALOR') return isAbono
    if (column.key === 'PRECIO') return isReturn || !isReduction
    if (isReturn) return ['CODIGO', 'CANT'].includes(column.key)
    return !isReduction && ['CODIGO', 'DETALLE', 'CANT'].includes(column.key)
  }
  function submit(event: React.FormEvent) {
    event.preventDefault()
    const missing = formColumns.filter((column) => isRequired(column) && !String(values[column.key] ?? '').trim())
    if (missing.length) { setError('Completa: ' + missing.map((column) => column.label).join(', ') + '.'); return }
    if (isCreditForm && !isReturn && transactionValue <= 0) { setError('Indica un valor mayor que cero.'); return }
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
          const codeSelect = column.key === 'CODIGO' && (module === 'VENTAS' || module === 'ENTRADAS' || isCreditForm && !isAbono)
          const codeOptions = isReturn ? returnOptions.map((item) => ({ code: item.code, label: `${item.code} · ${item.detail} · ${item.available} disp.`, disabled: false })) : productRows.map((item) => ({ code: String(item.CODIGO ?? ''), label: `${String(item.CODIGO ?? '')} · ${String(item.DETALLE ?? '')} · stock ${Number(item.STOCK ?? 0)}`, disabled: module !== 'ENTRADAS' && Number(item.STOCK ?? 0) <= 0 }))
          return <label key={column.key} className={disabled ? 'field-disabled' : ''}>{column.label}{isRequired(column) && <span>*</span>}
            {customerSelect ? <select value={String(values[column.key] ?? '')} onChange={(event) => update(column.key, event.target.value)}><option value="">Selecciona un cliente</option>{clientNames.map((name) => <option key={name} value={name}>{name}</option>)}</select>
              : codeSelect ? <select required={isRequired(column)} value={String(values[column.key] ?? '')} onChange={(event) => { const code = event.target.value; const product = productRows.find((row) => normalizeCode(row.CODIGO) === normalizeCode(code)); const refundable = returnOptions.find((row) => normalizeCode(row.code) === normalizeCode(code)); setValues((current) => ({ ...current, CODIGO: code, DETALLE: String(product?.DETALLE ?? refundable?.detail ?? ''), PRECIO: String(refundable?.unitPrice ?? productUnitPrice(code, module, data)) })); setError(''); }}>{isReturn ? <option value="">Elige un código que el cliente llevó</option> : <option value="">Selecciona un código del inventario</option>}{codeOptions.map((option) => <option key={option.code} value={option.code} disabled={option.disabled}>{option.label}</option>)}</select>
              : column.type === 'select' ? <select disabled={disabled} value={String(values[column.key] ?? '')} onChange={(event) => update(column.key, event.target.value)}>{(column.options ?? []).map((option) => <option key={option}>{option}</option>)}</select>
                : <input disabled={disabled} autoFocus={index === 0} type={column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : 'text'} step={column.type === 'number' ? 'any' : undefined} value={String(values[column.key] ?? '')} onChange={(event) => update(column.key, event.target.value)} placeholder={column.type === 'number' ? '0' : ''} />}
          </label>
        })}</div>
        {module === 'INVENTARIO_PT' && <p className="form-hint">PRECIO, costo y existencias son calculados. Los costos se consultan en COSTOS_NO_PRODUCIDOS; las hojas de costos ocultas y consignaciones no se cargan en esta PWA.</p>}
        {isCreditForm && <div className="debt-preview" aria-live="polite">
          <div><span>Deuda actual de {selectedClient || 'cliente'}</span><strong>{currency.format(currentDebt)}</strong></div>
          <div><span>{isAbono ? 'Saldo despues del abono' : values.TIPO === 'Devolución' ? 'Saldo despues de la devolución' : 'Nueva deuda con este credito'}</span><strong className={projectedDebt < 0 ? 'debt-negative' : ''}>{currency.format(projectedDebt)}</strong></div>
        </div>}
        {module === 'VENTAS' || isCreditForm && !isAbono ? <p className="form-hint">Al elegir el código se completa el producto y su precio. Los códigos sin existencias no se pueden seleccionar.</p> : null}
        {isReturn && <div className="debt-preview"><div><span>Valor de los productos devueltos</span><strong>{currency.format(returnValue)}</strong></div><div><span>Abono a la deuda</span><strong>{currency.format(returnDebtPart)}</strong></div><div><span>Reembolso a entregar al cliente</span><strong>{currency.format(refundValue)}</strong></div></div>}
        {isCreditForm && isAbono && <p className="form-hint">El abono reduce la deuda del cliente y se registra en VALOR.</p>}
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
    const returns = sumBy(data.CREDITOS.filter((row) => isReturnType(row.TIPO)), 'CODIGO', 'CANT')
    return data.INVENTARIO_PT.map((row) => {
      const code = normalizeCode(row.CODIGO)
      const incoming = entries[code] ?? Number(row.ENTRADAS ?? 0)
      const outgoing = (sales[code] ?? 0) + (credits[code] ?? 0) - (returns[code] ?? 0)
      return { ...row, ENTRADAS: incoming, SALIDAS: outgoing, STOCK: incoming - outgoing, GANANCIA: calculateInventoryProfit(row.PRECIO, row.COSTO) }
    })
  }
  if (module === 'CLIENTES') return data.CLIENTES.map((row) => ({ ...row, Columna1: getClientDebt(data.CREDITOS, String(row.NOMBRE ?? '').trim()) }))
  if (module === 'COSTOS_NO_PRODUCIDOS') return data.COSTOS_NO_PRODUCIDOS.map((row) => ({ ...row, 'COSTO TOTAL': Number(row.COSTO ?? 0) + Number(row['COSTO FIJO'] ?? 0), Columna1: Number(row['PRECIO AL PUBLICO'] ?? 0) - (Number(row.COSTO ?? 0) + Number(row['COSTO FIJO'] ?? 0)) }))
  return data[module]
}

function sumBy(rows: WorkbookRow[], groupKey: string, valueKey: string): Record<string, number> {
  return rows.reduce<Record<string, number>>((result, row) => {
    const group = normalizeCode(row[groupKey])
    if (group) result[group] = (result[group] ?? 0) + Number(row[valueKey] ?? 0)
    return result
  }, {})
}
function normalizeCode(value: CellValue): string { return String(value ?? '').trim().toLocaleLowerCase() }
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
  const cost = data.COSTOS_NO_PRODUCIDOS.find((row) => normalizeCode(row.CODIGO) === key)
  return Number(module === 'ENTRADAS' ? product?.COSTO ?? cost?.['COSTO TOTAL'] ?? cost?.COSTO ?? 0 : product?.PRECIO ?? cost?.['PRECIO AL PUBLICO'] ?? 0)
}
function isCreditTypeLegacy(value: CellValue): boolean {
  const text = String(value ?? '').trim().toLowerCase()
  return text === 'crédito' || text === 'credito'
}
function normalizeTransactionType(value: CellValue): string { return String(value ?? '').trim().toLowerCase().replace(/Ã©/g, 'e').replace(/Ã³/g, 'o').replace(/Ã±/g, 'n').normalize('NFD').replace(/[\u0300-\u036f]/g, '') }
function isCreditType(value: CellValue): boolean { return normalizeTransactionType(value) === 'credito' || isCreditTypeLegacy(value) }
function isAbonoType(value: CellValue): boolean { return normalizeTransactionType(value) === 'abono' }
function isReturnType(value: CellValue): boolean { return normalizeTransactionType(value) === 'devolucion' }
function getClientDebt(rows: WorkbookRow[], clientName: string): number {
  if (!clientName) return 0
  return rows.filter((row) => String(row.NOMBRE ?? '').trim().toLowerCase() === clientName.trim().toLowerCase()).reduce((balance, row) => {
    const value = Number(row.VALOR ?? 0)
    return balance + (isAbonoType(row.TIPO) || isReturnType(row.TIPO) ? -value : isCreditType(row.TIPO) ? value : 0)
  }, 0)
}
function getClientTransactions(rows: WorkbookRow[], clientName: string): WorkbookRow[] {
  return rows.filter((row) => String(row.NOMBRE ?? '').trim().toLowerCase() === clientName.toLowerCase()).sort((a, b) => rowDateValue(a.FECHA) - rowDateValue(b.FECHA))
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
  const type = filters.type.trim().toLocaleLowerCase()
  const from = filters.from ? rowDateValue(filters.from) : Number.NEGATIVE_INFINITY
  const to = filters.to ? rowDateValue(filters.to) + 86400000 : Number.POSITIVE_INFINITY
  const matchingRows = rows.filter((row) => {
    const rowName = String(row.NOMBRE ?? '').trim().toLocaleLowerCase()
    const rowType = String(row.TIPO ?? '').trim().toLocaleLowerCase()
    const date = rowDateValue(row.FECHA)
    return (!name || rowName.includes(name)) && (!type || rowType === type) && date >= from && date < to
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
  if (module === 'INVENTARIO_PT') {
    const code = String(next.CODIGO ?? '').trim().toLowerCase()
    const cost = data.COSTOS_NO_PRODUCIDOS.find((item) => String(item.CODIGO ?? '').trim().toLowerCase() === code)
    const entryCount = sumBy(data.ENTRADAS, 'CODIGO', 'CANTIDAD')[code] ?? 0
    const saleCount = sumBy(data.VENTAS, 'CODIGO', 'CANT')[code] ?? 0
    const creditCount = sumBy(data.CREDITOS.filter((item) => isCreditType(item.TIPO)), 'CODIGO', 'CANT')[code] ?? 0
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
    const type = isAbonoType(next.TIPO) ? 'Abono' : isReturnType(next.TIPO) ? 'Devolución' : CREDIT_TYPE
    const clientName = String(next.NOMBRE ?? '').trim()
    next.TIPO = type
    next.NOMBRE = clientName
    if (isAbonoType(type)) {
      next.CODIGO = null
      next.DETALLE = null
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
      next.VALOR = Number(next.VALOR ?? 0) || Number(next.CANT ?? 0) * Number(next.PRECIO ?? 0) - Number(next.DESCUENTO ?? 0)
    }
    next.DEUDA = getClientDebt(data.CREDITOS, clientName) + (isAbonoType(type) || isReturnType(type) ? -Number(next.VALOR ?? 0) : Number(next.VALOR ?? 0))
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
  const cleanValue = cleanExcelError(value)
  if (cleanValue === null || cleanValue === '') return '-'
  const normalizedKey = key.toLocaleUpperCase()
  if (normalizedKey.includes('PRECIO') || normalizedKey.includes('COSTO') || ['VALOR', 'TOTAL', 'DEUDA', 'GANANCIA', 'DESCUENTO', 'COLUMNA1'].includes(normalizedKey)) return currency.format(Number(cleanValue))
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
  const inventory = getRows('INVENTARIO_PT', data)
  const stock = inventory.reduce((total, row) => total + Number(row.STOCK ?? 0), 0)
  const stockValue = inventory.reduce((total, row) => total + Math.max(0, Number(row.STOCK ?? 0)) * Number(row.COSTO ?? 0), 0)
  return { products: data.INVENTARIO_PT.length, stock, stockValue, sales, cashSales, transferSales, expenses, materialExpenses, operatingExpenses: expenses - materialExpenses, creditsPaid }
}
function emptyWorkbookData(): Record<ModuleKey, WorkbookRow[]> {
  const entries: Array<[ModuleKey, WorkbookRow[]]> = (Object.keys(moduleColumns) as ModuleKey[]).map((module) => [module, []])
  return Object.fromEntries(entries) as Record<ModuleKey, WorkbookRow[]>
}

export default App
