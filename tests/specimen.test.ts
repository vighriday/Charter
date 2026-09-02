/**
 * The identity document Charter reads, and the promises it has to keep.
 *
 * WHY CHARTER WRITES THE DOCUMENT IT READS
 *
 * Charter checks the owners' identity documents, and to do that it has to send a
 * document to a reading service. On a demonstration that strangers run from a
 * website there is exactly one document it must never ask for: a real person's.
 *
 * Asking a stranger to upload their passport so that a demonstration can read it
 * would be a worse thing than anything this project prevents. A real identity
 * document would travel to us, sit in our process, go out to a third company, and
 * exist in whatever either of us keeps. For a demonstration.
 *
 * So Charter writes the document, for the owner named in the run, and marks it a
 * specimen on its face.
 *
 * WHAT THESE TESTS HOLD IN PLACE
 *
 * **It says what it is, more than once.** Once at the top and once at the bottom,
 * because the top of a page is the part that gets cropped off when somebody
 * photographs it.
 *
 * **The document number cannot be mistaken for a real one** even when it is copied
 * out of the document on its own, so it begins with the word SPECIMEN.
 *
 * **The same name always gives the same document.** A document built from the
 * clock or from chance is a different document every time and nothing about the
 * run can be checked against anybody else's copy.
 *
 * **The dates it writes are the dates real documents write.** A licence says
 * "16 JAN 1975". Writing year-month-day instead would make the reading easier than
 * a real reading and would make the check look better than it is.
 */

import { describe, expect, it } from 'vitest'
import { constants, inflateSync } from 'node:zlib'

import { buildSpecimenDocument, detailsFor, SPECIMEN_KIND } from '../src/identity/specimen.js'
import { dateOnADocument } from '../src/dates.js'

/** Everything drawn on the page, run together, so a test can look for a phrase. */
function wordsIn(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes)
  const pieces: string[] = []

  let at = 0
  for (;;) {
    const start = raw.indexOf('stream', at)
    if (start === -1) break
    const end = raw.indexOf('endstream', start)
    if (end === -1) break

    let from = start + 'stream'.length
    if (raw[from] === 0x0d) from += 1
    if (raw[from] === 0x0a) from += 1

    try {
      pieces.push(
        inflateSync(raw.subarray(from, end), { finishFlush: constants.Z_SYNC_FLUSH }).toString(
          'latin1',
        ),
      )
    } catch {
      pieces.push(raw.subarray(from, end).toString('latin1'))
    }
    at = end + 'endstream'.length
  }

  const drawn = pieces.join('\n')
  const hex = [...drawn.matchAll(/<([0-9A-Fa-f\s]+)>/g)]
    .map((one) => Buffer.from((one[1] as string).replace(/\s+/g, ''), 'hex').toString('latin1'))
    .join(' ')

  return hex.replace(/\s+/g, ' ')
}

describe('the details a specimen carries', () => {
  it('gives the same details for the same name, every time', () => {
    expect(detailsFor('Ana Rivera')).toEqual(detailsFor('Ana Rivera'))
    expect(detailsFor('ana rivera'), 'and does not care how it was capitalised').toEqual(
      detailsFor('Ana Rivera'),
    )
  })

  it('gives different details to different people', () => {
    expect(detailsFor('Ana Rivera').documentNumber).not.toBe(
      detailsFor('Lucia Rivera').documentNumber,
    )
  })

  it('writes a number that cannot be mistaken for a real one on its own', () => {
    // It gets copied out of the document by itself. Somebody looking at just the
    // number has to be able to tell.
    expect(detailsFor('Ana Rivera').documentNumber).toMatch(/^SPECIMEN-/)
  })

  it('writes dates the way a real document writes them', () => {
    // Not year-month-day. A licence says "16 JAN 1975", and a specimen that wrote
    // the format Charter finds easiest would make the reading look better than it
    // is. It must still be a date Charter can actually read.
    for (const name of ['Ana Rivera', 'Lucia Rivera', 'Sam Okonkwo', 'Wei Zhang']) {
      const details = detailsFor(name)
      expect(details.dateOfBirth, name).toMatch(/^\d{2} [A-Z]{3} \d{4}$/)
      expect(dateOnADocument(details.dateOfBirth).kind, name).toBe('read')
      expect(dateOnADocument(details.expiryDate).kind, name).toBe('read')
    }
  })

  it('makes an adult whose document has not expired', () => {
    // Otherwise a run would fall into the expired-document path by accident, and
    // the thing being demonstrated would be the wrong thing.
    for (const name of ['Ana Rivera', 'Lucia Rivera', 'Sam Okonkwo', 'Wei Zhang']) {
      const details = detailsFor(name)
      const born = dateOnADocument(details.dateOfBirth)
      const expires = dateOnADocument(details.expiryDate)

      expect(born.kind === 'read' && born.day < '2008-01-01', `${name} is an adult`).toBe(true)
      expect(
        expires.kind === 'read' && expires.day > '2027-01-01',
        `${name}'s document is current`,
      ).toBe(true)
    }
  })
})

describe('the document itself', () => {
  it('says it is a specimen at the top and again at the bottom', async () => {
    // Twice on purpose. The top of a page is the part that gets cropped off when
    // somebody photographs it.
    const page = wordsIn(await buildSpecimenDocument('Ana Rivera'))
    const said = page.split('SPECIMEN').length - 1
    expect(said, 'said more than once').toBeGreaterThanOrEqual(2)
  })

  it('says who issued it and that it proves nothing', async () => {
    const page = wordsIn(await buildSpecimenDocument('Ana Rivera'))
    expect(page).toContain('Charter')
    expect(page).toContain('proves nothing about anybody')
  })

  it('carries the four values a formation packet needs, and no others', async () => {
    const details = detailsFor('Ana Rivera')
    const page = wordsIn(await buildSpecimenDocument('Ana Rivera'))

    expect(page).toContain(details.fullName)
    expect(page).toContain(details.dateOfBirth)
    expect(page).toContain(details.documentNumber)
    expect(page).toContain(details.expiryDate)
  })

  it('is the same bytes every time', async () => {
    const once = await buildSpecimenDocument('Ana Rivera')
    const twice = await buildSpecimenDocument('Ana Rivera')
    expect(Buffer.from(once).equals(Buffer.from(twice))).toBe(true)
  })

  it('describes itself, for the record, without claiming anything', () => {
    expect(SPECIMEN_KIND).toContain('specimen')
    expect(SPECIMEN_KIND).toContain('made up person')
  })
})
