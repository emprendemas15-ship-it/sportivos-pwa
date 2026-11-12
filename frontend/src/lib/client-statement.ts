import type { WorkbookRow } from './workbook'

const cop = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 })
export type ClientStatementOptions = { openingBalance: number; openingDate: number }

function safeText(value: unknown): string {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, ' ')
}

function formatDate(value: unknown): string {
  if (typeof value === 'number') {
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86400000)
    return date.toLocaleDateString('es-CO', { timeZone: 'UTC' })
  }
  const parsed = new Date(String(value ?? ''))
  return Number.isNaN(parsed.getTime()) ? safeText(value) : parsed.toLocaleDateString('es-CO', { timeZone: 'UTC' })
}

function reducesDebt(value: unknown): boolean {
  return ['abono', 'devolucion'].includes(safeText(value).toLowerCase())
}

async function makePdf(clientName: string, transactions: WorkbookRow[], options?: ClientStatementOptions): Promise<Blob> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const green = rgb(0.11, 0.29, 0.21)
  const lightGreen = rgb(0.91, 0.95, 0.91)
  const muted = rgb(0.35, 0.41, 0.37)
  const pdf = await PDFDocument.create()
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const pageSize = 23
  const pages = Math.max(1, Math.ceil(transactions.length / pageSize))
  const byDate = (a: WorkbookRow, b: WorkbookRow) => rowDateValue(a.FECHA) - rowDateValue(b.FECHA)
    || rowCreatedAtValue(a) - rowCreatedAtValue(b)
  const orderedByDate = [...transactions].sort(byDate)
  const historical = options ? orderedByDate.filter((row) => rowCreatedAtValue(row) <= options.openingDate) : []
  const sinceOpening = options ? orderedByDate.filter((row) => rowCreatedAtValue(row) > options.openingDate) : orderedByDate
  const ordered = options ? [...historical, ...sinceOpening] : orderedByDate
  const totalCharges = sinceOpening.filter((row) => !reducesDebt(row.TIPO)).reduce((total, row) => total + Number(row.VALOR ?? 0), 0)
  const totalPayments = sinceOpening.filter((row) => reducesDebt(row.TIPO)).reduce((total, row) => total + Number(row.VALOR ?? 0), 0)
  const totalRefunds = sinceOpening.filter((row) => safeText(row.TIPO).toLowerCase() === 'devolucion').reduce((total, row) => total + Number(String(row.COMENTARIO ?? '').match(/REEMBOLSO:(\d+(?:\.\d+)?)/i)?.[1] ?? 0), 0)
  const finalBalance = (options?.openingBalance ?? 0) + totalCharges - totalPayments
  const lineBalances = new Map<WorkbookRow, number>()
  if (options) {
    let historicalBalance = options.openingBalance - historical.reduce((total, row) => total + movementDelta(row), 0)
    historical.forEach((row) => {
      historicalBalance += movementDelta(row)
      lineBalances.set(row, historicalBalance)
    })
    let currentBalance = options.openingBalance
    sinceOpening.forEach((row) => {
      currentBalance += movementDelta(row)
      lineBalances.set(row, currentBalance)
    })
  } else {
    let balance = 0
    ordered.forEach((row) => {
      balance += movementDelta(row)
      lineBalances.set(row, balance)
    })
  }
  const createdAt = new Date().toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })
  let logo: Awaited<ReturnType<typeof pdf.embedPng>> | null = null
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}logo-sportivos.png`)
    if (response.ok) logo = await pdf.embedPng(await response.arrayBuffer())
  } catch { /* El documento conserva su encabezado de marca aunque el logo no esté disponible. */ }

  for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
    const page = pdf.addPage([595, 842])
    const { width, height } = page.getSize()
    const draw = (text: unknown, x: number, y: number, size = 9, font = regular, color = muted) => page.drawText(safeText(text), { x, y, size, font, color })
    page.drawRectangle({ x: 0, y: height - 100, width, height: 100, color: green })
    let headerTextX = 40
    if (logo) {
      const card = { x: 38, y: height - 76, width: 170, height: 52 }
      const scale = Math.min(144 / logo.width, 36 / logo.height)
      const logoWidth = logo.width * scale
      const logoHeight = logo.height * scale
      page.drawRectangle({ ...card, color: rgb(1, 1, 1), borderColor: rgb(0.88, 0.92, 0.88), borderWidth: 0.6 })
      page.drawImage(logo, {
        x: card.x + (card.width - logoWidth) / 2,
        y: card.y + (card.height - logoHeight) / 2,
        width: logoWidth,
        height: logoHeight,
      })
      headerTextX = card.x + card.width + 14
    }
    draw("SPORTIVO'S", headerTextX, height - 49, 19, bold, rgb(1, 1, 1))
    draw('ESTADO DE CUENTA DEL CLIENTE', headerTextX, height - 70, 10, regular, rgb(0.88, 0.93, 0.88))
    draw(`Pagina ${pageIndex + 1} de ${pages}`, width - 105, height - 49, 9, bold, rgb(1, 1, 1))

    const infoY = height - 155
    page.drawRectangle({ x: 38, y: infoY - 42, width: 519, height: 66, color: lightGreen, borderColor: rgb(0.82, 0.87, 0.82), borderWidth: 0.7 })
    draw('CLIENTE', 52, infoY + 8, 7, bold, green)
    draw(clientName, 52, infoY - 10, 12, bold, green)
    draw('FECHA DE GENERACION', 310, infoY + 8, 7, bold, green)
    draw(createdAt, 310, infoY - 10, 9, regular, green)
    draw('MOVIMIENTOS', 52, infoY - 31, 7, bold, green)
    draw(String(ordered.length), 142, infoY - 31, 8, regular, green)

    const summaryY = infoY - 84
    const boxes = options ? [
      { x: 38, title: `SALDO BASE ${new Date(options.openingDate).toLocaleDateString('es-CO')}`, amount: options.openingBalance },
      { x: 170, title: 'CARGOS DESDE CORTE', amount: totalCharges },
      { x: 302, title: 'ABONOS DESDE CORTE', amount: totalPayments },
      { x: 434, title: 'SALDO ACTUAL', amount: finalBalance },
    ] : [
      { x: 38, title: 'TOTAL CARGOS', amount: totalCharges },
      { x: 170, title: 'ABONOS A DEUDA', amount: totalPayments },
      { x: 302, title: 'REEMBOLSOS', amount: totalRefunds },
      { x: 434, title: 'SALDO PENDIENTE', amount: finalBalance },
    ]
    for (const box of boxes) {
      page.drawRectangle({ x: box.x, y: summaryY - 30, width: 123, height: 48, color: rgb(1, 1, 1), borderColor: rgb(0.82, 0.87, 0.82), borderWidth: 0.7 })
      draw(box.title, box.x + 9, summaryY + 4, 6.5, bold, muted)
      draw(`$ ${cop.format(box.amount)}`, box.x + 9, summaryY - 17, 12, bold, green)
    }

    let y = summaryY - 64
    const columns = [38, 103, 326, 404, 478, 557]
    page.drawRectangle({ x: 38, y: y - 7, width: 519, height: 23, color: green })
    draw('FECHA', columns[0] + 8, y, 7, bold, rgb(1, 1, 1))
    draw('MOVIMIENTO / DETALLE', columns[1] + 8, y, 7, bold, rgb(1, 1, 1))
    draw('CARGO', columns[2] + 8, y, 7, bold, rgb(1, 1, 1))
    draw('ABONO', columns[3] + 8, y, 7, bold, rgb(1, 1, 1))
    draw('SALDO', columns[4] + 8, y, 7, bold, rgb(1, 1, 1))
    const chunk = ordered.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize)
    chunk.forEach((row, index) => {
      const rowY = y - 24 - index * 19
      if (index % 2 === 0) page.drawRectangle({ x: 38, y: rowY - 5, width: 519, height: 19, color: rgb(0.97, 0.98, 0.97) })
      const payment = reducesDebt(row.TIPO)
      const amount = Number(row.VALOR ?? 0)
      const product = row.CODIGO ? `${row.CODIGO} x${row.CANT ?? 1} ${row.DETALLE ?? ''}` : row.COMENTARIO ?? (payment ? 'Abono recibido' : 'Credito')
      const refund = Number(String(row.COMENTARIO ?? '').match(/REEMBOLSO:(\d+(?:\.\d+)?)/i)?.[1] ?? 0)
      const refundNote = refund > 0 ? ` | Reembolso $${cop.format(refund)}` : ''
      const description = `${safeText(row.TIPO)} - ${safeText(product)}${refundNote}`.slice(0, 51)
      draw(formatDate(row.FECHA), columns[0] + 7, rowY, 7.5)
      draw(description, columns[1] + 7, rowY, 7.5)
      draw(payment ? '-' : cop.format(amount), columns[2] + 7, rowY, 7.5)
      draw(payment ? cop.format(amount) : '-', columns[3] + 7, rowY, 7.5)
      draw(cop.format(lineBalances.get(row) ?? 0), columns[4] + 7, rowY, 7.5, bold, green)
    })
    const footerY = 54
    page.drawLine({ start: { x: 38, y: footerY + 15 }, end: { x: 557, y: footerY + 15 }, thickness: 0.7, color: rgb(0.82, 0.87, 0.82) })
    draw("SPORTIVO'S | Estado de cuenta confidencial del cliente", 38, footerY, 7, regular, muted)
    draw(`Saldo al corte: $ ${cop.format(finalBalance)}`, 380, footerY, 9, bold, green)
  }

  const bytes = await pdf.save()
  return new Blob([new Uint8Array(bytes).buffer as ArrayBuffer], { type: 'application/pdf' })
}

export async function downloadClientStatement(clientName: string, transactions: WorkbookRow[], options?: ClientStatementOptions): Promise<void> {
  const blob = await makePdf(clientName, transactions, options)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `estado-cuenta-${safeText(clientName).toLowerCase().replace(/\s+/g, '-')}.pdf`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function shareClientStatement(clientName: string, transactions: WorkbookRow[], notify: (message: string) => void, options?: ClientStatementOptions): Promise<void> {
  const blob = await makePdf(clientName, transactions, options)
  const filename = `estado-cuenta-${safeText(clientName).toLowerCase().replace(/\s+/g, '-')}.pdf`
  const file = new File([blob], filename, { type: 'application/pdf' })
  if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
    try {
      await navigator.share({ title: `Estado de cuenta - ${clientName}`, text: `Movimientos y saldo pendiente de ${clientName}.`, files: [file] })
      return
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
    }
  }
  await downloadClientStatement(clientName, transactions, options)
  notify('Este navegador no permite compartir archivos directamente. Descargué el PDF para que puedas adjuntarlo.')
}

function rowDateValue(value: unknown): number {
  if (typeof value === 'number') return new Date(Date.UTC(1899, 11, 30) + value * 86400000).getTime()
  const raw = String(value ?? '').trim()
  const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (dmy) return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1])).getTime()
  const timestamp = Date.parse(raw)
  return Number.isNaN(timestamp) ? 0 : timestamp
}

function rowCreatedAtValue(row: WorkbookRow): number {
  const timestamp = Date.parse(String(row.created_at ?? row.updated_at ?? ''))
  return Number.isNaN(timestamp) ? 0 : timestamp
}

function movementDelta(row: WorkbookRow): number {
  const amount = Number(row.VALOR ?? 0)
  return reducesDebt(row.TIPO) ? -amount : amount
}
