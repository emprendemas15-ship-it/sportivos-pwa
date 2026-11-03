import type { ValidationCreditPerson, ValidationCreditTransaction } from './credit-validation'

const currency = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 })
const quantityFormat = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 })
const pageWidth = 595
const pageHeight = 842
const margin = 42
const tableWidth = pageWidth - margin * 2
const columnWidths = [55, 45, 47, 105, 38, 61, 61, 52, 47]
const rowHeight = 22

function safeText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, ' ')
}

function formatDate(value: string | null): string {
  if (!value) return 'Sin fecha'
  const date = new Date(`${value.slice(0, 10)}T00:00:00`)
  return Number.isNaN(date.getTime()) ? safeText(value) : date.toLocaleDateString('es-CO')
}

function drawText(
  page: import('pdf-lib').PDFPage,
  text: unknown,
  x: number,
  y: number,
  size: number,
  font: import('pdf-lib').PDFFont,
  color: ReturnType<typeof import('pdf-lib').rgb>,
  maxWidth?: number,
) {
  let output = safeText(text)
  if (maxWidth && font.widthOfTextAtSize(output, size) > maxWidth) {
    while (output.length > 0 && font.widthOfTextAtSize(`${output}...`, size) > maxWidth) output = output.slice(0, -1)
    output = `${output}...`
  }
  page.drawText(output, { x, y, size, font, color })
}

function movementAmount(row: ValidationCreditTransaction): number {
  return row.tipo === 'ABONO' ? row.abona : row.total || row.valor
}

export async function downloadValidationCreditHistory(person: ValidationCreditPerson): Promise<void> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const pdf = await PDFDocument.create()
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const green = rgb(0.06, 0.24, 0.20)
  const accent = rgb(0.16, 0.45, 0.32)
  const pale = rgb(0.94, 0.97, 0.94)
  const border = rgb(0.84, 0.89, 0.85)
  const muted = rgb(0.39, 0.46, 0.41)
  const white = rgb(1, 1, 1)
  const filenameName = safeText(person.name).toLowerCase().replace(/\s+/g, '-')
  const generatedAt = new Date().toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })
  const transactions = person.transactions
    .map((transaction, index) => ({ transaction, index }))
    .sort((a, b) => {
      if (!a.transaction.fecha) return b.transaction.fecha ? -1 : a.index - b.index
      if (!b.transaction.fecha) return 1
      return a.transaction.fecha.localeCompare(b.transaction.fecha) || a.index - b.index
    })
  const pages: Array<{ page: import('pdf-lib').PDFPage; pageNumber: number }> = []
  let cursorY = 0

  const createPage = (first: boolean) => {
    const page = pdf.addPage([pageWidth, pageHeight])
    const { height } = page.getSize()
    page.drawRectangle({ x: 0, y: height - 108, width: pageWidth, height: 108, color: green })
    drawText(page, "SPORTIVO'S", margin, height - 42, 17, bold, white)
    drawText(page, 'HISTORIAL COMPLETO DE CARTERA', margin, height - 64, 11, bold, rgb(0.86, 0.93, 0.87))
    drawText(page, `Generado: ${generatedAt}`, 390, height - 42, 8, regular, white, 160)
    drawText(page, `Persona: ${person.name}`, margin, height - 88, 10, bold, white, tableWidth)
    if (first) {
      page.drawRectangle({ x: margin, y: 669, width: tableWidth, height: 62, color: pale, borderColor: border, borderWidth: 0.8 })
      const summaryColumns = [
        { label: 'MOVIMIENTOS', value: quantityFormat.format(transactions.length) },
        { label: 'TOTAL COMPRAS', value: `$ ${currency.format(person.totalCompras)}` },
        { label: 'TOTAL ABONOS', value: `$ ${currency.format(person.totalAbonos)}` },
        { label: 'DESCUENTOS', value: `$ ${currency.format(person.totalDescuentos)}` },
      ]
      const summaryWidth = tableWidth / summaryColumns.length
      summaryColumns.forEach((item, index) => {
        const x = margin + 12 + summaryWidth * index
        drawText(page, item.label, x, 711, 7, bold, accent, summaryWidth - 16)
        drawText(page, item.value, x, 686, 10, bold, green, summaryWidth - 16)
      })
      drawText(page, 'SALDO PENDIENTE', margin + 3, 647, 8, bold, accent)
      drawText(page, `$ ${currency.format(person.saldoPendiente)}`, margin + 116, 646, 10, bold, green)
      cursorY = 619
    } else {
      cursorY = 704
    }

    page.drawRectangle({ x: margin, y: cursorY - 5, width: tableWidth, height: 19, color: green })
    const headings = ['FECHA', 'TIPO', 'CODIGO', 'DETALLE', 'CANT.', 'COMPRA', 'ABONO', 'DESC.', 'SALDO']
    let x = margin + 4
    headings.forEach((heading, index) => {
      drawText(page, heading, x, cursorY, 6.5, bold, white, columnWidths[index] - 6)
      x += columnWidths[index]
    })
    pages.push({ page, pageNumber: pages.length + 1 })
    cursorY -= 20
    return page
  }

  let page = createPage(true)
  if (transactions.length === 0) {
    drawText(page, 'No hay movimientos registrados para esta persona.', margin + 8, cursorY - 8, 9, regular, muted, tableWidth - 16)
  } else {
    transactions.forEach(({ transaction }, index) => {
      if (cursorY < 58) {
        page = createPage(false)
      }
      if (index % 2 === 0) page.drawRectangle({ x: margin, y: cursorY - 5, width: tableWidth, height: rowHeight, color: pale })
      const values = [
        formatDate(transaction.fecha),
        transaction.tipo === 'ABONO' ? 'ABONO' : 'COMPRA',
        transaction.codigo || '—',
        transaction.detalle || '—',
        quantityFormat.format(transaction.cantidad),
        currency.format(transaction.tipo === 'ABONO' ? 0 : movementAmount(transaction)),
        currency.format(transaction.abona),
        currency.format(transaction.descuento),
        currency.format(transaction.debe),
      ]
      let x = margin + 4
      values.forEach((value, columnIndex) => {
        const width = columnWidths[columnIndex] - 6
        const rightAligned = columnIndex >= 5
        const size = columnIndex === 3 ? 6.5 : 6
        const text = safeText(value)
        const fitted = width && regular.widthOfTextAtSize(text, size) > width
          ? truncateText(text, width, size, regular)
          : text
        drawText(page, fitted, rightAligned ? x + Math.max(0, width - regular.widthOfTextAtSize(fitted, size)) : x, cursorY - 1, size, regular, muted, width)
        x += columnWidths[columnIndex]
      })
      cursorY -= rowHeight
    })
  }

  pages.forEach(({ page: reportPage, pageNumber }) => {
    reportPage.drawLine({ start: { x: margin, y: 46 }, end: { x: pageWidth - margin, y: 46 }, thickness: 0.7, color: border })
    drawText(reportPage, 'Documento informativo del modulo VALIDACION CREDITOS.', margin, 30, 7, regular, muted, 310)
    drawText(reportPage, `Pagina ${pageNumber} de ${pages.length}`, pageWidth - margin - 88, 30, 7, bold, muted, 88)
  })

  const bytes = await pdf.save()
  const blob = new Blob([new Uint8Array(bytes).buffer as ArrayBuffer], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `historial-cartera-${filenameName}.pdf`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function truncateText(text: string, maxWidth: number, size: number, font: import('pdf-lib').PDFFont): string {
  let output = text
  while (output.length > 0 && font.widthOfTextAtSize(`${output}...`, size) > maxWidth) output = output.slice(0, -1)
  return output.length < text.length ? `${output}...` : output
}
