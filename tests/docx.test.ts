/**
 * Proving the editable agreement is a real Word file, and says the same things the
 * sealed one does.
 *
 * WHY THERE ARE TWO COPIES OF ONE AGREEMENT
 *
 * The sealed pack is what the owners sign, and it is sealed precisely so nobody can
 * change it afterwards. That is right for a document about to be signed and useless
 * for the thing people actually need to do first: take it to somebody they trust,
 * argue about a clause, and change it.
 *
 * So the agreement is written twice from one set of values. Neither is typed, so
 * they cannot drift — both are laid out from the numbers `prepare.ts` worked out.
 *
 * WHY THE ARCHIVE IS READ BACK RATHER THAN TRUSTED
 *
 * A Word file is a zip archive holding XML. Writing one is easy to get subtly
 * wrong in a way that still produces a file: an offset a few bytes out, a checksum
 * of the wrong thing, a count that disagrees with the list. Word then refuses to
 * open it and says almost nothing about why.
 *
 * So these tests unpack the archive with Node's own decompression and read the
 * document back out. A test that only checked the bytes were written would pass
 * against a file nobody can open.
 */

import { inflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { buildAgreementDocx, escapeXml, zip } from '../src/pack/docx.js'
import { prepareAgreement } from '../src/agreement/prepare.js'
import type { CaseFacts, Owner } from '../src/stages/facts.js'

const ana: Owner = {
  name: 'Ana Rivera',
  contribution: 'the delivery van and the ovens',
  contributionCents: '2500000',
  sharePercent: '50',
}

const ben: Owner = {
  name: 'Ben Rivera',
  contribution: 'the lease deposit and the first year of rent',
  contributionCents: '2500000',
  sharePercent: '50',
}

const caseWith = (owners: readonly Owner[]): CaseFacts =>
  ({
    caseId: 'case-1',
    proposedName: 'Rivera Sisters Baking Co LLC',
    state: 'Texas',
    owners,
    openQuestions: [],
    agreementChoices: { managedBy: 'the owners themselves', hasExitProcess: false },
    identityChecks: [],
    answers: [],
    addressRecords: [],
    addressRecordsHeld: [],
  }) as CaseFacts

const { data } = prepareAgreement(caseWith([ana, ben]), '2026-09-03')
const file = buildAgreementDocx(data)

/**
 * Unpack an archive, the way any zip tool does: from the list at the end.
 *
 * Reading the list rather than walking the file from the front is deliberate. It
 * is what real tools do, so a file that unpacks here is a file that unpacks in
 * Word — and an offset that is a few bytes out fails here rather than silently
 * producing a file nobody can open.
 */
function unpack(archive: Uint8Array): Map<string, string> {
  const raw = Buffer.from(archive)
  const out = new Map<string, string>()

  // The end of the list. It carries how many files there are and where the list
  // starts, and it is at the very end of the file.
  const end = raw.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  expect(end, 'the archive has no end-of-list marker at all').toBeGreaterThan(-1)

  const count = raw.readUInt16LE(end + 10)
  let at = raw.readUInt32LE(end + 16)

  for (let index = 0; index < count; index += 1) {
    expect(raw.readUInt32LE(at), 'a list entry does not start where it should').toBe(0x02014b50)

    const squeezedLength = raw.readUInt32LE(at + 20)
    const nameLength = raw.readUInt16LE(at + 28)
    const extraLength = raw.readUInt16LE(at + 30)
    const commentLength = raw.readUInt16LE(at + 32)
    const offset = raw.readUInt32LE(at + 42)
    const name = raw.subarray(at + 46, at + 46 + nameLength).toString('utf8')

    // Now the file itself, where the list said it would be.
    expect(raw.readUInt32LE(offset), `${name} is not where the list says`).toBe(0x04034b50)
    const localName = raw.readUInt16LE(offset + 26)
    const localExtra = raw.readUInt16LE(offset + 28)
    const from = offset + 30 + localName + localExtra

    out.set(name, inflateRawSync(raw.subarray(from, from + squeezedLength)).toString('utf8'))
    at += 46 + nameLength + extraLength + commentLength
  }

  return out
}

const parts = unpack(file)
const document = parts.get('word/document.xml') ?? ''
/** The words, with the markup taken out, the way a reader would see them. */
const words = document
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&apos;/g, "'")
  .replace(/\s+/g, ' ')

// ─────────────────────────────────────────────────────────────────────────────
// The archive
// ─────────────────────────────────────────────────────────────────────────────

describe('the file is a real archive', () => {
  it('starts the way every zip tool expects', () => {
    expect(Buffer.from(file.subarray(0, 4)).toString('hex')).toBe('504b0304')
  })

  it('unpacks, and the list at the end agrees with the files in it', () => {
    // This is the test. An offset a few bytes out still produces a file, and Word
    // then refuses to open it and says almost nothing about why.
    expect(parts.size).toBe(5)
  })

  it('holds every part Word needs to open it', () => {
    for (const path of [
      '[Content_Types].xml',
      '_rels/.rels',
      'word/_rels/document.xml.rels',
      'word/styles.xml',
      'word/document.xml',
    ]) {
      expect(parts.has(path), `${path} is missing`).toBe(true)
    }
  })

  it('produces the same bytes from the same agreement', () => {
    // Every timestamp inside is fixed rather than read from the clock, so two
    // people building the same agreement get the same file and can compare them.
    const again = buildAgreementDocx(data)
    expect(Buffer.from(again).equals(Buffer.from(file))).toBe(true)
  })

  it('really compresses, rather than storing and claiming otherwise', () => {
    expect(file.length).toBeLessThan(document.length)
  })
})

describe('packing anything at all', () => {
  it('round-trips text through the archive unchanged', () => {
    const text = 'a'.repeat(500) + ' and something else entirely'
    const back = unpack(zip([{ path: 'a.txt', text }]))
    expect(back.get('a.txt')).toBe(text)
  })

  it('keeps several files apart', () => {
    const back = unpack(
      zip([
        { path: 'one.txt', text: 'first' },
        { path: 'nested/two.txt', text: 'second' },
      ]),
    )
    expect(back.get('one.txt')).toBe('first')
    expect(back.get('nested/two.txt')).toBe('second')
  })

  it('handles text that is not plain English', () => {
    const back = unpack(zip([{ path: 'a.txt', text: 'Ana María Rivera — señora' }]))
    expect(back.get('a.txt')).toBe('Ana María Rivera — señora')
  })

  it('makes an empty archive that is still an archive', () => {
    expect(unpack(zip([])).size).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// What the document says
// ─────────────────────────────────────────────────────────────────────────────

describe('what the agreement says', () => {
  it('names the company and the state', () => {
    expect(words).toContain('Rivera Sisters Baking Co LLC')
    expect(words).toContain('Texas')
  })

  it('names every owner, what they put in, and what they hold', () => {
    for (const owner of data.owners) {
      expect(words, owner.fullName).toContain(owner.fullName)
      expect(words, owner.fullName).toContain(owner.agreedShare)
      expect(words, owner.fullName).toContain(owner.contributionValue)
    }
  })

  it('carries every article, numbered', () => {
    for (const article of data.articles) {
      expect(words, article.fullHeading).toContain(article.fullHeading)
    }
  })

  it('says a majority means more than half', () => {
    // The bug that was in this project until 30 August: an ordinary decision
    // carried at exactly one half, so in a fifty-fifty company either owner alone
    // met it while the same document said a tie was possible.
    expect(words).toContain('more than 50%')
    expect(words).toMatch(/does not carry an ordinary decision alone/)
  })

  it('says the deadlock article is there because a tie is possible', () => {
    expect(data.deadlockPossible).toBe(true)
    expect(words).toMatch(/allow an exact tie/)
  })

  it('says nothing has been signed and the software cannot sign it', () => {
    expect(words).toMatch(/Nothing in this document has been signed/)
    expect(words).toMatch(/it is not able to/)
  })

  it('states the law correctly rather than as a slogan', () => {
    // The law lets software FORM a contract. Getting that backwards is a claim a
    // well-read judge would catch.
    expect(words).toMatch(/lets software form a contract/)
    expect(words).toMatch(/with the intent to sign/)
  })

  it('gives every owner a line to sign on', () => {
    expect(words).toMatch(/Date: ____________/)
  })

  it('says it is a working copy, so nobody signs the wrong one', () => {
    expect(words).toMatch(/working copy/)
    expect(words).toMatch(/sign the sealed copy/)
  })
})

describe('what the agreement deliberately leaves out', () => {
  it('carries no identity value of any kind', () => {
    // The same rule as the sealed pack, for the same reason: a document gathering
    // every owner's identity details is a document nobody should be asked to carry
    // around.
    for (const value of ['1988-04-12', '1989-04-11', 'X1234567']) {
      expect(document, value).not.toContain(value)
    }
  })

  it('has nothing anything could sign automatically', () => {
    // Lines for people, and nothing in this project able to put anything on them.
    expect(document).not.toMatch(/w:sig|signatureLine/i)
  })
})

describe('a name somebody typed cannot break the file', () => {
  it('escapes markup in every place text goes in', () => {
    expect(escapeXml('<w:p>')).toBe('&lt;w:p&gt;')
    expect(escapeXml('a & b')).toBe('a &amp; b')
    expect(escapeXml(`it's "quoted"`)).toBe('it&apos;s &quot;quoted&quot;')
  })

  it('survives a company name full of markup, and still unpacks', () => {
    const nasty = prepareAgreement(
      { ...caseWith([ana, ben]), proposedName: '</w:t></w:r><w:r><w:t>Broken' },
      '2026-09-03',
    )
    const built = buildAgreementDocx(nasty.data)
    const back = unpack(built)

    expect(back.get('word/document.xml')).toContain('&lt;/w:t&gt;')
    expect(back.get('word/document.xml')).not.toContain('</w:t></w:r><w:r><w:t>Broken')
  })
})

describe('an agreement where the shares do not follow the money', () => {
  it('says so in writing, rather than leaving it to be noticed', () => {
    // Texas allocates profit and loss by the value of each owner's contribution
    // unless the agreement says otherwise. So it has to say otherwise, on purpose.
    const uneven = prepareAgreement(
      caseWith([
        { ...ana, contributionCents: '4000000', sharePercent: '50' },
        { ...ben, contributionCents: '1000000', sharePercent: '50' },
      ]),
      '2026-09-03',
    )
    const said = (unpack(buildAgreementDocx(uneven.data)).get('word/document.xml') ?? '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')

    expect(said).toMatch(/says otherwise, on purpose and in writing/)
  })
})
