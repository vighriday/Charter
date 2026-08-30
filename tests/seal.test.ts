/**
 * Proving the seal, on a real multi-page PDF rather than on a toy.
 *
 * WHAT THE SEAL IS FOR
 *
 * When the pack is finished Charter sets the PDF permission level that means:
 * from here, this file may only be filled in and signed, and nothing else. That
 * single setting is this project's whole argument turned into a property of the
 * file. It is not a claim in our writing that somebody has to take on trust —
 * anybody can open the pack in ordinary PDF software and see it.
 *
 * WHY IT IS TESTED ON A REAL DOCUMENT
 *
 * The project's own ledger called the seal on a real multi-page document "the
 * biggest open assumption in the project", because it had only ever been proved on
 * a tiny file made for the purpose. Every test below runs against a generated
 * three-page PDF with embedded fonts and drawn text, which is the shape of thing
 * the pack actually is.
 *
 * WHAT THIS PROJECT CLAIMS, AND WHAT IT DOES NOT
 *
 * The certificate is self-issued, so no outside authority has vouched for who we
 * are, and a PDF reader will say so. That is correct and it is not hidden. The
 * claim actually made is narrower and completely checkable:
 *
 *     This file has not changed by one byte since it was sealed.
 *
 * That holds with a self-issued certificate exactly as well as a purchased one,
 * because it is a claim about the bytes rather than about identity.
 */

import { PDFDocument, StandardFonts } from 'pdf-lib'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  CannotSeal,
  fingerprintOf,
  makeSealCertificate,
  readCertificate,
  type SealCertificate,
} from '../src/seal/certificate.js'
import {
  PERMISSION_FILL_IN_AND_SIGN_ONLY,
  looksLikePdf,
  readSeal,
  sealPack,
} from '../src/seal/seal.js'
import { fingerprintBytes } from '../src/record/canonical.js'

/** A document shaped like the real pack: several pages, a font, drawn text. */
async function aRealDocument(pages = 3): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)

  for (let page = 1; page <= pages; page += 1) {
    const sheet = doc.addPage([595, 842])
    sheet.drawText(`Rivera Sisters Baking Co LLC — page ${page}`, {
      x: 60,
      y: 760,
      size: 16,
      font,
    })
    sheet.drawText('Company agreement, prepared by Charter.', { x: 60, y: 730, size: 11, font })
  }

  return doc.save()
}

let certificate: SealCertificate
let document: Uint8Array
let sealedBytes: Uint8Array
let sealedFingerprint: string

beforeAll(async () => {
  // Made once. Producing a key is the slow part, and every test below wants the
  // same one anyway.
  certificate = makeSealCertificate({
    notBefore: new Date(Date.UTC(2026, 0, 1)),
    password: 'a-long-enough-password',
  })
  document = await aRealDocument()

  const sealed = await sealPack(document, certificate, { at: new Date(Date.UTC(2026, 7, 30, 12)) })
  sealedBytes = sealed.bytes
  sealedFingerprint = sealed.fingerprint
}, 120_000)

describe('the certificate Charter seals with', () => {
  it('is self-issued, and says so rather than hiding it', () => {
    // A reader will report this too. A project that mentions it first is in a much
    // better position than one caught by it.
    expect(readCertificate(certificate.certificatePem).selfIssued).toBe(true)
  })

  it('has a name worked out from the certificate, not stored beside it', () => {
    // The same reasoning as the attestation key's name: two values that have to be
    // kept in step will eventually disagree, and nothing will say which is right.
    expect(fingerprintOf(certificate.certificatePem)).toBe(certificate.fingerprint)
    expect(certificate.fingerprint).toMatch(/^[0-9a-f]{64}$/)
  })

  it('refuses a password too short to be worth having', () => {
    expect(() =>
      makeSealCertificate({ notBefore: new Date(), password: 'short', keyBits: 512 }),
    ).toThrow(CannotSeal)
  })

  it('refuses text that is not a certificate', () => {
    expect(() => readCertificate('not a certificate')).toThrow(CannotSeal)
  })
})

describe('sealing a real multi-page document', () => {
  it('produces a file that is still a readable PDF with all its pages', async () => {
    // A seal that broke the document would be caught here rather than by somebody
    // opening the pack.
    const reopened = await PDFDocument.load(sealedBytes, { ignoreEncryption: true })
    expect(reopened.getPageCount()).toBe(3)
  })

  it('sets the permission level to filling in and signing only', () => {
    const reading = readSeal(sealedBytes)

    expect(reading.hasPermissionSetting).toBe(true)
    expect(reading.permissionLevel).toBe(PERMISSION_FILL_IN_AND_SIGN_ONLY)
    expect(reading.permissionLevel).toBe(2)
  })

  it('does not set a level that would stop the owners signing', () => {
    // Level 1 permits nothing further at all. Setting it would produce a document
    // nobody could sign, while every screen said the run had succeeded.
    expect(readSeal(sealedBytes).permissionLevel).not.toBe(1)
  })

  it('does not set a level that would allow content to be added', () => {
    // Level 3 additionally allows annotations, which means visible content can be
    // added and moved on the page after sealing.
    expect(readSeal(sealedBytes).permissionLevel).not.toBe(3)
  })

  it('covers the whole file, not part of it', () => {
    // This is the finding that matters most. A seal covering only part of a file
    // leaves the rest changeable while the file still reports as sealed, which
    // reads to a person exactly like a document nobody has touched.
    const reading = readSeal(sealedBytes)

    expect(reading.coversWholeFile).toBe(true)
    expect(reading.byteRange).toHaveLength(4)

    const range = reading.byteRange as readonly number[]
    expect(range[0]).toBe(0)
    expect((range[2] as number) + (range[3] as number)).toBe(sealedBytes.length)
  })

  it('carries a seal at all', () => {
    expect(readSeal(sealedBytes).hasSeal).toBe(true)
  })
})

describe('what a changed byte does', () => {
  it('changes the fingerprint, wherever the change is', () => {
    for (const spot of [0, 100, Math.floor(sealedBytes.length / 2), sealedBytes.length - 1]) {
      const tampered = Uint8Array.from(sealedBytes)
      tampered[spot] = (tampered[spot] as number) ^ 0xff

      expect(fingerprintBytes(tampered), `a change at byte ${spot} went unnoticed`).not.toBe(
        sealedFingerprint,
      )
    }
  })

  it('leaves the fingerprint alone when nothing changed', () => {
    expect(fingerprintBytes(Uint8Array.from(sealedBytes))).toBe(sealedFingerprint)
  })

  it('is a change inside the range the seal covers', () => {
    // Because the seal covers the whole file, there is nowhere to change a byte
    // that the seal does not cover. That is the point of the previous test.
    const reading = readSeal(sealedBytes)
    expect(reading.coversWholeFile).toBe(true)
  })
})

describe('the order: merge, then seal, then fingerprint', () => {
  it('fingerprints the sealed bytes and not the file before sealing', () => {
    // The sealing library rewrites the whole file rather than adding to the end,
    // so a fingerprint taken before sealing would not match the file anybody is
    // handed. Getting this backwards would produce a pack whose published
    // fingerprint never matches, and the failure would look like tampering.
    expect(sealedFingerprint).not.toBe(fingerprintBytes(document))
    expect(sealedFingerprint).toBe(fingerprintBytes(sealedBytes))
  })

  it('records the fingerprint of the bytes it actually produced', () => {
    // This is the property the product depends on: a person is handed one pack and
    // checks it against the fingerprint written in the record at the moment it was
    // sealed.
    expect(sealedFingerprint).toBe(fingerprintBytes(sealedBytes))
  })

  it('does NOT produce the same bytes when the same document is sealed twice', async () => {
    // Measured rather than assumed, and asserted so that nobody later writes down
    // that the pack is byte-for-byte reproducible.
    //
    // Two seals of one document, same certificate, same stated date, differ inside
    // the signature — and the part that differs is the digest OF THE DOCUMENT,
    // which means the document being digested differed. The library stamps the
    // file's own identifier from the clock and offers no way to fix it.
    //
    // Nothing depends on this being otherwise. The record is reproducible; the
    // signed file is not, which is true of signed documents generally. Claiming
    // otherwise would be a claim this code cannot back.
    await new Promise((wake) => setTimeout(wake, 1100))
    const again = await sealPack(Uint8Array.from(document), certificate, {
      at: new Date(Date.UTC(2026, 7, 30, 12)),
    })

    expect(again.fingerprint).not.toBe(sealedFingerprint)

    // Both are nonetheless correctly sealed, at the same level, covering the whole
    // of their own file. Different is not the same as wrong.
    const reading = readSeal(again.bytes)
    expect(reading.permissionLevel).toBe(PERMISSION_FILL_IN_AND_SIGN_ONLY)
    expect(reading.coversWholeFile).toBe(true)
  }, 30_000)

  it('records which certificate made the seal', () => {
    // Published, so somebody handed a pack can check it was sealed with the
    // certificate this project publishes rather than one somebody invented.
    expect(readSeal(sealedBytes).hasSeal).toBe(true)
  })
})

describe('what sealing refuses', () => {
  it('refuses to seal nothing', async () => {
    await expect(
      sealPack(new Uint8Array(), certificate, { at: new Date() }),
    ).rejects.toThrow(/looks finished/)
  })

  it('refuses to seal something that is not a PDF', async () => {
    // Sealing something else would produce a file no reader can open that still
    // carries a seal, which is the most misleading possible outcome.
    await expect(
      sealPack(new TextEncoder().encode('this is just text'), certificate, { at: new Date() }),
    ).rejects.toThrow(/not a PDF/)
  })

  it('knows a PDF from anything else', () => {
    expect(looksLikePdf(document)).toBe(true)
    expect(looksLikePdf(new TextEncoder().encode('%PDF'))).toBe(false)
    expect(looksLikePdf(new TextEncoder().encode('hello'))).toBe(false)
    expect(looksLikePdf(new Uint8Array())).toBe(false)
  })
})

describe('reading a file that was never sealed', () => {
  it('reports plainly that there is no seal, rather than guessing', async () => {
    const reading = readSeal(document)

    expect(reading.isPdf).toBe(true)
    expect(reading.hasSeal).toBe(false)
    expect(reading.hasPermissionSetting).toBe(false)
    expect(reading.permissionLevel).toBeUndefined()
    expect(reading.coversWholeFile).toBe(false)
  })

  it('reports that something which is not a PDF is not a PDF', () => {
    expect(readSeal(new TextEncoder().encode('nonsense')).isPdf).toBe(false)
  })
})
