/**
 * Sealing the finished pack, and reading back what a sealed file says.
 *
 * WHAT THE SEAL ACTUALLY DOES
 *
 * The PDF format has a setting that says what may be done to a file from this point
 * on. Charter sets it to the level meaning:
 *
 *     From here, this file may only be filled in and signed. Nothing else.
 *
 * That single setting is this project's whole argument turned into a property of
 * the file. It is not a claim in our writing that somebody has to believe. Anybody
 * can open the pack in ordinary PDF software and see it, and any change beyond
 * filling in and signing shows up as broken.
 *
 * THE THREE WORDS, AND WHY THIS FILE IS CAREFUL WITH THEM
 *
 *   A **seal** is what the machine puts on a document it made.
 *   An **attestation** is what the machine puts over its own record.
 *   A **signature** is what a person does. Only a person.
 *
 * This file only ever seals. It has no way to produce a signature, and the module
 * that carries a document to a person and asks them to sign it lives somewhere
 * else on purpose — somewhere nothing the model can trigger is able to reach.
 *
 * WHY MERGE, THEN SEAL, THEN FINGERPRINT — IN THAT ORDER
 *
 * The sealing library rewrites the whole file rather than adding to the end of it.
 * That is harmless here, because our seal is the first one on the document and
 * there is no earlier version to preserve. But it fixes the order permanently: the
 * fingerprint has to be taken of the sealed bytes, never of the file before
 * sealing. A fingerprint of the unsealed file would not match the file anybody is
 * actually handed.
 *
 * ONE THING THIS CANNOT DO, SAID PLAINLY
 *
 * **Sealing the same document twice does not produce the same bytes.** Measured,
 * not assumed: two seals of one file, with the same certificate and the same
 * stated date, differ inside the signature — and the difference is in the digest
 * of the document, which means the document being digested differed. The library
 * stamps the file's own identifier from the clock, and there is no setting for it.
 *
 * That matters because reproducibility is one of this project's arguments, so it
 * is worth being exact about which part is reproducible.
 *
 *   The RECORD is reproducible. The same case produces the same entries and the
 *   same chain of fingerprints, every time, on any machine.
 *
 *   The sealed PACK is not. Building it twice gives two different files, each
 *   correctly sealed, each with its own fingerprint.
 *
 * Nothing depends on the second being true. A person is handed one pack and checks
 * that pack against the fingerprint written in the record at the moment it was
 * sealed. They never rebuild it. Claiming byte-for-byte reproducibility of a signed
 * document would be a claim this code cannot back, so it is not made.
 */

import zga from 'zgapdfsigner'
import { fingerprintBytes } from '../record/canonical.js'
import { CannotSeal, type SealCertificate } from './certificate.js'

/**
 * The permission level Charter sets.
 *
 * The PDF standard defines three. Level 1 allows nothing further at all, which
 * would stop the owners signing. Level 3 additionally allows annotations, which
 * means somebody can add and move visible content on the page. Level 2 is the one
 * that says filling in and signing and nothing else — exactly the boundary this
 * project exists to draw.
 */
export const PERMISSION_FILL_IN_AND_SIGN_ONLY = 2

/** What sealing produced. */
export interface Sealed {
  /** The sealed file. */
  readonly bytes: Uint8Array
  /** The fingerprint of exactly these bytes. */
  readonly fingerprint: string
  /** The certificate that made the seal, by its short name. */
  readonly certificateFingerprint: string
  readonly sizeBytes: string
}

/**
 * Seal a PDF so that only filling in and signing remain possible.
 *
 * `at` is passed in rather than read from the clock so that the date written into
 * the seal is a decision rather than an accident, and so a test can assert on it.
 *
 * It does NOT make the output reproducible. See the note at the top of this file:
 * the library stamps the file's own identifier from the clock, so two seals of one
 * document differ. That was measured rather than assumed, and it is why this
 * comment does not claim otherwise.
 */
export async function sealPack(
  pdf: Uint8Array,
  certificate: SealCertificate,
  options: { readonly at: Date; readonly reason?: string },
): Promise<Sealed> {
  if (pdf.length === 0) {
    throw new CannotSeal(
      'There is nothing to seal. An empty file carrying a valid seal is worse than ' +
        'no file at all, because it looks finished.',
    )
  }
  if (!looksLikePdf(pdf)) {
    throw new CannotSeal(
      'That is not a PDF. Sealing something else would produce a file that no ' +
        'reader can open and that still carries a seal, which is the most ' +
        'misleading possible outcome.',
    )
  }

  const signer = new zga.PdfSigner({
    p12cert: certificate.bundle,
    pwd: certificate.password,
    permission: PERMISSION_FILL_IN_AND_SIGN_ONLY,
    reason:
      options.reason ??
      'Sealed by Charter. From this point only filling in and signing are permitted.',
    location: 'Charter',
    signame: 'Charter document seal',
    signdate: options.at,
  })

  const bytes = await signer.sign(pdf)

  return {
    bytes,
    // Of the SEALED bytes. Never of the file before sealing.
    fingerprint: fingerprintBytes(bytes),
    certificateFingerprint: certificate.fingerprint,
    sizeBytes: String(bytes.length),
  }
}

/** Does this even start like a PDF? */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return (
    bytes.length > 5 &&
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46 && // F
    bytes[4] === 0x2d //   -
  )
}

/** What a sealed file says about itself, read without trusting anybody. */
export interface SealReading {
  readonly isPdf: boolean
  /** Whether the file carries a permission setting at all. */
  readonly hasPermissionSetting: boolean
  /** The level, when there is one. */
  readonly permissionLevel: number | undefined
  /** Whether it carries a seal at all. */
  readonly hasSeal: boolean
  /**
   * Whether the sealed region covers the whole file.
   *
   * This is the finding that matters. A seal covering only part of a file leaves
   * the rest changeable while the file still reports as sealed, which reads to a
   * person exactly like a document that has not been touched.
   */
  readonly coversWholeFile: boolean
  /** The four numbers describing what was covered, for somebody checking by hand. */
  readonly byteRange: readonly number[] | undefined
  readonly sizeBytes: number
}

/**
 * Read a PDF and report what its seal says, making no claim about identity.
 *
 * Deliberately reads the file's own structure rather than asking a library whether
 * it is "valid". Validity in a PDF reader mixes two different questions — has this
 * file changed, and do I trust who sealed it — and this project only ever claims
 * the first. Keeping them apart in the code is what lets the checker keep them
 * apart when it prints its findings.
 */
export function readSeal(bytes: Uint8Array): SealReading {
  const text = Buffer.from(bytes).toString('latin1')

  const permission = /\/DocMDP[\s\S]{0,400}?\/P\s+(\d)/.exec(text) ?? /\/P\s+(\d)[\s\S]{0,400}?\/DocMDP/.exec(text)
  const range = /\/ByteRange\s*\[\s*([\d\s]+?)\s*\]/.exec(text)
  const numbers = range === null ? undefined : range[1]?.trim().split(/\s+/).map(Number)

  // The four numbers are: start, length, start again, length again. Together they
  // are every byte of the file except the hole where the seal itself sits. If they
  // do not add up to the file's size, part of the file is outside the seal.
  const covers =
    numbers !== undefined &&
    numbers.length === 4 &&
    numbers[0] === 0 &&
    (numbers[2] as number) + (numbers[3] as number) === bytes.length

  return {
    isPdf: looksLikePdf(bytes),
    hasPermissionSetting: text.includes('/DocMDP'),
    permissionLevel: permission === null ? undefined : Number(permission[1]),
    hasSeal: text.includes('/ByteRange') && /\/SubFilter\s*\/adbe\.pkcs7/.test(text),
    coversWholeFile: covers,
    byteRange: numbers,
    sizeBytes: bytes.length,
  }
}
