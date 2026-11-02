import type { WorkbookRow } from './workbook'

const cop = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 })

function safeText(value: unknown): string {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ñ/g, 'n').replace(/Ñ/g, 'N').replace(/[^\x20-\x7E]/g, ' ')
}

function pdfEscape(value: unknown): string {
  return safeText(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function formatDate(value: unknown): string {
  if (typeof value === 'number') {
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86400000)
    return date.toLocaleDateString('es-CO', { timeZone: 'UTC' })
  }
  const raw = String(value ?? '')
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleDateString('es-CO', { timeZone: 'UTC' })
}

function reducesDebt(value: unknown): boolean {
  return ['abono', 'devolución', 'devolucion'].includes(String(value ?? '').toLowerCase())
}

function makePdf(clientName: string, transactions: WorkbookRow[]): Blob {
  const pageSize = 30
  const pages = Math.max(1, Math.ceil(transactions.length / pageSize))
  const objects: string[] = []
  const pageRefs: number[] = []
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
  const pageContentRefs: number[] = []
  for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
    const pageObject = 5 + pageIndex * 2
    const streamObject = pageObject + 1
    pageRefs.push(pageObject)
    pageContentRefs.push(streamObject)
    const chunk = transactions.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize)
    const commands: string[] = []
    const draw = (x: number, y: number, size: number, text: string, bold = false) => {
      commands.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${pdfEscape(text)}) Tj ET`)
    }
    draw(40, 800, 17, "SPORTIVO'S - ESTADO DE CUENTA", true)
    draw(40, 778, 11, `Cliente: ${clientName}`, true)
    draw(40, 761, 9, `Movimientos de creditos y abonos | Pagina ${pageIndex + 1} de ${pages}`)
    draw(40, 735, 9, 'FECHA', true); draw(116, 735, 9, 'TIPO / DETALLE', true)
    draw(380, 735, 9, 'CARGO', true); draw(451, 735, 9, 'ABONO', true); draw(520, 735, 9, 'SALDO', true)
    commands.push('0.55 w 40 728 m 555 728 l S')
    let balance = transactions.slice(0, pageIndex * pageSize).reduce((total, row) => total + (reducesDebt(row.TIPO) ? -Number(row.VALOR ?? 0) : Number(row.VALOR ?? 0)), 0)
    chunk.forEach((row, index) => {
      const y = 710 - index * 21
      const isPayment = reducesDebt(row.TIPO)
      const amount = Number(row.VALOR ?? 0)
      balance += isPayment ? -amount : amount
      const description = `${String(row.TIPO ?? '')} - ${String(row.DETALLE ?? row.COMENTARIO ?? (isPayment ? 'Abono recibido' : 'Credito')).slice(0, 40)}`
      draw(40, y, 8, formatDate(row.FECHA))
      draw(116, y, 8, description)
      draw(380, y, 8, isPayment ? '-' : `$${cop.format(amount)}`)
      draw(451, y, 8, isPayment ? `$${cop.format(amount)}` : '-')
      draw(520, y, 8, `$${cop.format(balance)}`)
    })
    const finalBalance = transactions.slice(0, (pageIndex + 1) * pageSize).reduce((total, row) => total + (reducesDebt(row.TIPO) ? -Number(row.VALOR ?? 0) : Number(row.VALOR ?? 0)), 0)
    const footerY = 65
    commands.push('0.55 w 40 82 m 555 82 l S')
    draw(40, footerY, 10, `Saldo pendiente: $${cop.format(finalBalance)}`, true)
    const stream = commands.join('\n')
    objects[pageObject] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${streamObject} 0 R >>`
    objects[streamObject] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  }
  objects[2] = `<< /Type /Pages /Kids [${pageRefs.map((reference) => `${reference} 0 R`).join(' ')}] /Count ${pages} >>`
  const maxObject = objects.length - 1
  let pdf = '%PDF-1.4\n'
  const offsets = new Array<number>(maxObject + 1).fill(0)
  for (let index = 1; index <= maxObject; index += 1) {
    offsets[index] = pdf.length
    pdf += `${index} 0 obj\n${objects[index]}\nendobj\n`
  }
  const xrefOffset = pdf.length
  pdf += `xref\n0 ${maxObject + 1}\n0000000000 65535 f \n`
  for (let index = 1; index <= maxObject; index += 1) pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${maxObject + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  return new Blob([new TextEncoder().encode(pdf)], { type: 'application/pdf' })
}

export function downloadClientStatement(clientName: string, transactions: WorkbookRow[]): void {
  const blob = makePdf(clientName, transactions)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `estado-cuenta-${safeText(clientName).toLowerCase().replace(/\s+/g, '-')}.pdf`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function shareClientStatement(clientName: string, transactions: WorkbookRow[], notify: (message: string) => void): Promise<void> {
  const blob = makePdf(clientName, transactions)
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
  downloadClientStatement(clientName, transactions)
  notify('Este navegador no permite compartir archivos directamente. Descargué el PDF para que puedas adjuntarlo.')
}
