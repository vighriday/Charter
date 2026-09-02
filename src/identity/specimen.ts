/**
 * The identity document Charter reads, and why it is one Charter wrote itself.
 *
 * THE PROBLEM THIS SOLVES
 *
 * Charter checks the owners' identity documents. To do that it has to send a
 * document to a reading service. On a demonstration that strangers can run from a
 * website, on the open internet, there is exactly one document it must never ask
 * for: a real person's.
 *
 * Asking a stranger to upload their passport so that a demonstration can read it
 * would be a worse thing than anything this project prevents. It would mean a real
 * identity document travelling to us, sitting in our process, going out to a third
 * company, and existing in whatever either of us keeps. For a demonstration.
 *
 * So Charter writes the document. One page, clearly marked a specimen on its face,
 * for the owner named in the run, carrying the four values a formation packet
 * needs and nothing else.
 *
 * WHAT IS REAL ABOUT THIS AND WHAT IS NOT
 *
 * **The reading is completely real.** A real document goes to the real service. It
 * really reads the page, really reports which values it found and where on the
 * page it found them, and really says how sure it was. The rule that decides which
 * values a person has to look at then runs on that real answer, unchanged.
 *
 * **The person is not real.** So the fact that it is a specimen travels with the
 * result, into the record, and onto the screen. A run that read a made up document
 * can never be mistaken for a run that read somebody's passport, and no sentence
 * anywhere in this project may say identity was confirmed.
 *
 * WHY THE VALUES ARE WORKED OUT FROM THE NAME
 *
 * The date of birth, the document number and the expiry date are derived from the
 * owner's name, so the same name always produces the same document. Two people
 * running the same case get the same bytes and can compare them. A document made
 * from the clock or from chance would be a different document every time, and
 * nothing about the run would be checkable.
 *
 * They are also unmistakably not real. The document number begins SPECIMEN, the
 * page says so twice, and the issuing authority is named as this software.
 */

import { createHash } from 'node:crypto'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

/** The values the specimen carries, worked out before anything is drawn. */
export interface SpecimenDetails {
  readonly fullName: string
  readonly dateOfBirth: string
  readonly documentNumber: string
  readonly expiryDate: string
}

const MONTHS = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
] as const

/**
 * Work out one specimen's details from a name.
 *
 * The same name always gives the same details. Nothing here reads the clock or
 * asks for a random number, because a document that changes every time it is built
 * is a document nobody can check against anybody else's copy.
 */
export function detailsFor(fullName: string): SpecimenDetails {
  const name = fullName.trim()
  const digest = createHash('sha256').update(name.toLowerCase(), 'utf8').digest()

  // Read a few bytes and turn them into a plausible date. The ranges keep the
  // person an adult and the document current, so the run exercises the ordinary
  // path rather than the expired-document path by accident.
  const day = 1 + (digest[0] as number) % 28
  const month = MONTHS[(digest[1] as number) % 12] as string
  const birthYear = 1970 + ((digest[2] as number) % 30)
  const expiryYear = 2029 + ((digest[3] as number) % 6)

  const number = digest.subarray(4, 8).toString('hex').toUpperCase()

  return {
    fullName: name.toUpperCase(),
    dateOfBirth: `${String(day).padStart(2, '0')} ${month} ${birthYear}`,
    // Begins with the word, so that the number cannot be mistaken for a real one
    // even if it is copied out of the document on its own.
    documentNumber: `SPECIMEN-${number}`,
    expiryDate: `${String(day).padStart(2, '0')} ${month} ${expiryYear}`,
  }
}

/** How the document describes itself, in the words the record uses. */
export const SPECIMEN_KIND =
  'a specimen identity document, written by Charter for a made up person'

/**
 * Draw the specimen and hand back the bytes.
 *
 * Laid out like an identity card, because that is what the reading service is
 * good at and because a page of plain text would be an easier read than a real
 * document and would make the check look better than it is.
 */
export async function buildSpecimenDocument(fullName: string): Promise<Uint8Array> {
  const details = detailsFor(fullName)

  const document = await PDFDocument.create()
  const page = document.addPage([440, 280])
  const bold = await document.embedFont(StandardFonts.HelveticaBold)
  const body = await document.embedFont(StandardFonts.Helvetica)

  // Fixed, never from the clock. See the note at the top of this file.
  const stamped = new Date(Date.UTC(2026, 0, 1))
  document.setCreationDate(stamped)
  document.setModificationDate(stamped)
  document.setProducer('Charter')
  document.setCreator('Charter')
  document.setTitle(`SPECIMEN identity document — ${details.fullName}`)
  document.setSubject(
    'Not a real identity document and not a real person. Written by Charter so ' +
      'that a reading service has something to read without anybody being asked ' +
      'to hand over their own document.',
  )

  const INK = rgb(0.1, 0.1, 0.12)
  const QUIET = rgb(0.42, 0.42, 0.46)
  const WARN = rgb(0.62, 0.12, 0.12)

  // Said at the top, before anything that looks like a credential.
  page.drawText('SPECIMEN — NOT A REAL DOCUMENT', {
    x: 28,
    y: 240,
    size: 12,
    font: bold,
    color: WARN,
  })
  page.drawText('Issued by Charter for a made up person, so that a reading', {
    x: 28,
    y: 224,
    size: 8,
    font: body,
    color: QUIET,
  })
  page.drawText('service has something to read. It proves nothing about anybody.', {
    x: 28,
    y: 214,
    size: 8,
    font: body,
    color: QUIET,
  })

  page.drawLine({
    start: { x: 28, y: 202 },
    end: { x: 412, y: 202 },
    thickness: 0.75,
    color: rgb(0.85, 0.85, 0.88),
  })

  page.drawText('IDENTITY DOCUMENT', { x: 28, y: 182, size: 13, font: bold, color: INK })

  const rows: readonly (readonly [string, string])[] = [
    ['Name', details.fullName],
    ['Date of Birth', details.dateOfBirth],
    ['Document Number', details.documentNumber],
    ['Expires', details.expiryDate],
  ]

  let y = 150
  for (const [label, value] of rows) {
    page.drawText(label, { x: 28, y: y + 12, size: 8, font: body, color: QUIET })
    page.drawText(value, { x: 28, y, size: 14, font: bold, color: INK })
    y -= 34
  }

  // And again at the bottom, because the top of a page is the part that gets
  // cropped off when somebody photographs it.
  page.drawText('SPECIMEN — NOT A REAL DOCUMENT', {
    x: 28,
    y: 22,
    size: 9,
    font: bold,
    color: WARN,
  })

  return document.save()
}
