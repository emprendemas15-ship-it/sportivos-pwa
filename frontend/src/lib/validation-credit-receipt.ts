import type { ValidationCreditPerson, ValidationCreditTransaction } from './credit-validation'

const currency = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 })

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

export async function downloadValidationCreditReceipt(
  person: ValidationCreditPerson,
  movement: ValidationCreditTransaction,
): Promise<void> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([595, 842])
  const { width, height } = page.getSize()
  const green = rgb(0.06, 0.24, 0.20)
  const accent = rgb(0.16, 0.45, 0.32)
  const pale = rgb(0.94, 0.97, 0.94)
  const border = rgb(0.84, 0.89, 0.85)
  const muted = rgb(0.39, 0.46, 0.41)
  const white = rgb(1, 1, 1)
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const draw = (text: unknown, x: number, y: number, size = 10, font = regular, color = muted, maxWidth?: number) =>
    drawText(page, text, x, y, size, font, color, maxWidth)
  const type = movement.tipo === 'ABONO' ? 'ABONO RECIBIDO' : 'CREDITO OTORGADO'
  const amount = movement.tipo === 'ABONO' ? movement.abona : movement.total || movement.valor
  const documentReference = movement.codigo || `MOV-${movement.savedMovementId?.slice(0, 8) ?? 'HISTORICO'}`
  const filenameName = safeText(person.name).toLowerCase().replace(/\s+/g, '-')
  const filenameDate = (movement.fecha ?? 'sin-fecha').slice(0, 10)

  page.drawRectangle({ x: 0, y: height - 150, width, height: 150, color: green })
  let titleX = 44
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}logo-sportivos.png`)
    if (response.ok) {
      const logo = await pdf.embedPng(await response.arrayBuffer())
      const card = { x: 42, y: height - 116, width: 140, height: 65 }
      const scale = Math.min(120 / logo.width, 48 / logo.height)
      const logoWidth = logo.width * scale
      const logoHeight = logo.height * scale
      page.drawRectangle({ ...card, color: white })
      page.drawImage(logo, {
        x: card.x + (card.width - logoWidth) / 2,
        y: card.y + (card.height - logoHeight) / 2,
        width: logoWidth,
        height: logoHeight,
      })
      titleX = 205
    }
  } catch {
    titleX = 44
  }
  draw("SPORTIVO'S", titleX, height - 54, 18, bold, white)
  draw('COMPROBANTE DE CARTERA', titleX, height - 76, 11, bold, rgb(0.86, 0.93, 0.87))
  draw(type, titleX, height - 96, 9, regular, rgb(0.86, 0.93, 0.87))
  draw('COPIA DEL MOVIMIENTO', 414, height - 48, 7, bold, rgb(0.86, 0.93, 0.87))
  draw(`No. ${documentReference}`, 414, height - 64, 8, regular, white, 145)

  const cardX = 42
  const cardWidth = width - 84
  page.drawRectangle({ x: cardX, y: 584, width: cardWidth, height: 82, color: pale, borderColor: border, borderWidth: 0.8 })
  draw('CLIENTE', 58, 642, 8, bold, accent)
  draw(person.name, 58, 622, 13, bold, green, 290)
  draw('FECHA DEL MOVIMIENTO', 365, 642, 8, bold, accent)
  draw(formatDate(movement.fecha), 365, 622, 10, bold, green)
  draw('CATEGORIA', 58, 601, 8, bold, accent)
  draw(movement.negocio || 'Sin categoria', 125, 601, 9, regular, green, 250)

  page.drawRectangle({ x: cardX, y: 448, width: cardWidth, height: 112, color: white, borderColor: border, borderWidth: 0.8 })
  draw('DETALLE DEL MOVIMIENTO', 58, 538, 8, bold, accent)
  draw('Descripcion', 58, 511, 8, bold, muted)
  draw(movement.detalle || (movement.tipo === 'ABONO' ? 'Abono a cartera' : 'Compra a credito'), 170, 511, 10, regular, green, 350)
  draw('Codigo', 58, 485, 8, bold, muted)
  draw(movement.codigo || 'No aplica', 170, 485, 9, regular, green, 160)
  draw('Cantidad', 345, 485, 8, bold, muted)
  draw(numberFormat(movement.cantidad), 425, 485, 9, regular, green)
  draw('Negocio', 58, 460, 8, bold, muted)
  draw(movement.negocio || 'Sin categoria', 170, 460, 9, regular, green, 350)

  page.drawRectangle({ x: cardX, y: 328, width: cardWidth, height: 94, color: pale, borderColor: border, borderWidth: 0.8 })
  draw(movement.tipo === 'ABONO' ? 'VALOR DEL ABONO' : 'VALOR DEL CREDITO', 60, 396, 9, bold, accent)
  draw(`$ ${currency.format(amount)}`, 60, 364, 22, bold, green)
  draw(movement.tipo === 'ABONO' ? 'SALDO DESPUES DEL ABONO' : 'SALDO DESPUES DEL CREDITO', 340, 396, 8, bold, accent)
  draw(`$ ${currency.format(movement.debe)}`, 340, 365, 16, bold, green)
  if (movement.tipo !== 'ABONO') {
    draw(`${numberFormat(movement.cantidad)} x $ ${currency.format(movement.valor)}  -  descuento $ ${currency.format(movement.descuento)}`, 60, 343, 8, regular, muted, 460)
  }

  page.drawLine({ start: { x: cardX, y: 286 }, end: { x: width - cardX, y: 286 }, thickness: 0.8, color: border })
  draw('Este documento es un comprobante informativo del movimiento registrado en VALIDACION CREDITOS.', cardX, 266, 8, regular, muted, cardWidth)
  draw(`Generado el ${new Date().toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}`, cardX, 248, 8, regular, muted)
  page.drawRectangle({ x: 0, y: 0, width, height: 50, color: green })
  draw("SPORTIVO'S  |  Validacion de creditos", cardX, 20, 8, bold, white)
  draw('Conserve este comprobante para sus registros', 340, 20, 8, regular, white)

  const bytes = await pdf.save()
  const blob = new Blob([new Uint8Array(bytes).buffer as ArrayBuffer], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `comprobante-${filenameName}-${filenameDate}.pdf`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function numberFormat(value: number): string {
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(value)
}
