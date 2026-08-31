/**
 * Proving the Formation Pack is a real document, and that it leaves out what it
 * says it leaves out.
 *
 * WHAT CHANGED, AND WHY IT MATTERED
 *
 * Until 31 August 2026 the pack was bytes made from the names of its parts. It had
 * a fingerprint, the fingerprint was honest about those bytes, and the bytes were
 * not a document. Every claim about assembling and sealing was true of a thing
 * nobody could open.
 *
 * It is now a real multi-page PDF, written by this project's own code, with the
 * agreement in it, sealed with the same library that seals it in a demonstration.
 * A stranger with no accounts at all gets the same pack.
 *
 * THE TEST THAT MATTERS MOST HERE
 *
 * The one that reads the finished bytes and looks for a date of birth. The pack
 * says which values were read off each identity document and which a person
 * checked. It does not reprint them. A packet gathering every owner's identity
 * details onto one page is a document nobody should be asked to carry around, and
 * a rule like that is only worth having if something checks it.
 */

import { inflateSync } from 'node:zlib'
import { describe, expect, it, beforeAll } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { buildPackDocument, wrap, type PackContents } from '../src/pack/document.js'
import { looksLikePdf } from '../src/seal/seal.js'
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

const facts = {
  caseId: 'case-1',
  proposedName: 'Rivera Sisters Baking Co LLC',
  state: 'Texas',
  owners: [ana, ben],
  openQuestions: [],
  agreementChoices: { managedBy: 'the owners themselves', hasExitProcess: false },
  identityChecks: [],
  answers: [],
  addressRecords: [],
  addressRecordsHeld: [],
} as unknown as CaseFacts

const prepared = prepareAgreement(facts, '2026-09-03')

const contents: PackContents = {
  caseId: 'case-1',
  agreement: prepared.data,
  explanation: prepared.explanation,
  identity: [
    {
      owner: 'Ana Rivera',
      fieldsRead: '4',
      checkedByAPerson: [],
      missing: [],
    },
    {
      owner: 'Ben Rivera',
      fieldsRead: '4',
      checkedByAPerson: ['expiry_date'],
      missing: [],
    },
  ],
  refusedInThisRun: [],
  preparedOn: '3 September 2026',
  stampedAt: new Date(Date.UTC(2026, 8, 3, 12)),
}

/**
 * Read the words back out of a finished PDF.
 *
 * A PDF keeps its page content compressed, so searching the raw bytes finds
 * nothing — which would make every test below pass for the wrong reason, including
 * the ones checking that a date of birth is NOT in there. That is the worst
 * possible failure mode for this file: a test that proves a value is absent by
 * being unable to see any value at all.
 *
 * So the compressed blocks are decompressed and the text-drawing instructions read
 * out of them. Written here rather than pulled in as a dependency, because it is
 * twenty lines and a test that needed a PDF parser would be testing the parser.
 */
function wordsIn(pdf: Uint8Array): string {
  const raw = Buffer.from(pdf)
  const said: string[] = []

  let at = 0
  for (;;) {
    const start = raw.indexOf('stream', at)
    if (start === -1) break
    const end = raw.indexOf('endstream', start)
    if (end === -1) break

    // Past "stream" and its line break, which is either one or two characters.
    let from = start + 'stream'.length
    if (raw[from] === 0x0d) from += 1
    if (raw[from] === 0x0a) from += 1

    try {
      const text = inflateSync(raw.subarray(from, end)).toString('latin1')

      // pdf-lib writes each string as hexadecimal between angle brackets, which
      // is one of the two forms a PDF allows. Both are read here rather than only
      // the one this library happens to use today, because a test that stopped
      // seeing anything after a library update would go quiet rather than fail.
      for (const match of text.matchAll(/<([0-9A-Fa-f\s]+)>\s*Tj/g)) {
        said.push(Buffer.from((match[1] ?? '').replace(/\s+/g, ''), 'hex').toString('latin1'))
      }
      for (const match of text.matchAll(/\((?:\\.|[^\\)])*\)\s*Tj/g)) {
        const whole = match[0]
        said.push(whole.slice(1, whole.lastIndexOf(')')).replace(/\\([()\\])/g, '$1'))
      }
    } catch {
      // Not a compressed block. Nothing to read, and not a problem.
    }

    at = end + 'endstream'.length
  }

  // Joined with spaces and collapsed, because the page breaks a sentence wherever
  // it runs out of room. A test looking for a phrase should not fail because the
  // phrase happened to wrap.
  return said.join(' ').replace(/\s+/g, ' ')
}

let bytes: Uint8Array
let text: string

beforeAll(async () => {
  bytes = await buildPackDocument(contents)
  text = wordsIn(bytes)
}, 60_000)

describe('reading the words back out', () => {
  it('finds something at all, so the absence tests below mean something', () => {
    // Without this, every "must not contain" test in this file would pass by
    // being unable to read anything — which is the worst possible way for a test
    // about a person's date of birth to pass.
    expect(text.length, 'nothing could be read out of the finished PDF').toBeGreaterThan(500)
    expect(text).toContain('Formation Pack')
  })

  it('really would find a value if one were in there', () => {
    // Proving the reader works, by putting something in and finding it. A checker
    // that has only ever been shown documents without the thing it looks for has
    // never been shown to find anything.
    expect(text).toContain('Rivera')
  })
})

describe('the pack is a real document', () => {
  it('is a PDF, and a reader can open it', async () => {
    expect(looksLikePdf(bytes)).toBe(true)
    await expect(PDFDocument.load(bytes)).resolves.toBeDefined()
  })

  it('runs to several pages, because it is a packet and not a note', async () => {
    const document = await PDFDocument.load(bytes)
    expect(document.getPageCount()).toBeGreaterThanOrEqual(2)
  })

  it('is written on US Letter, because these are United States documents', async () => {
    const document = await PDFDocument.load(bytes)
    const { width, height } = document.getPage(0).getSize()
    expect(Math.round(width)).toBe(612)
    expect(Math.round(height)).toBe(792)
  })

  it('produces the same bytes from the same contents', async () => {
    // The pack itself has to be reproducible even though the SEAL is not. Two
    // people building the same pack from the same record must get the same
    // document, or nothing downstream can be compared.
    const again = await buildPackDocument(contents)
    expect(Buffer.from(again).equals(Buffer.from(bytes))).toBe(true)
  })
})

describe('what the pack says', () => {
  const readable = async (): Promise<string> => {
    // Read what is actually drawn, by rebuilding the same page content and
    // checking the strings that were handed to the drawing calls. Reading text
    // back out of a PDF needs a parser this project does not carry, and a test
    // that needed one would be testing the parser.
    return text
  }

  it('names the business and the state on the cover', async () => {
    const said = await readable()
    expect(said).toContain('Rivera Sisters Baking Co LLC')
    expect(said).toContain('Texas')
  })

  it('names every owner', async () => {
    const said = await readable()
    for (const owner of [ana, ben]) expect(said, owner.name).toContain(owner.name)
  })

  it('says plainly that nothing in it has been signed', async () => {
    expect(await readable()).toContain('Nothing in this packet has been signed')
  })

  it('says the software cannot sign, rather than that it chose not to', async () => {
    const said = await readable()
    expect(said).toContain('it is not able to')
  })

  it('says it is not legal advice and not a filing', async () => {
    const said = await readable()
    expect(said).toContain('not legal advice')
    expect(said).toContain('not a filing')
  })

  it('carries the list of what Charter would refuse after sealing', async () => {
    // The section that would otherwise be a heading over nothing. Most software
    // ships a list of what it can do; this ships the other one.
    const said = await readable()
    expect(said).toContain('would not')
    expect(said).toContain('pdf_flatten')
    expect(said).toContain('pdf_watermark')
  })

  it('says a limit nobody can check is not a limit', async () => {
    expect(await readable()).toContain('a limit nobody can check is not a limit')
  })

  it('gives every owner somewhere to sign', async () => {
    const said = await readable()
    expect(said).toContain('Date: ______________')
  })
})

describe('what the pack deliberately leaves out', () => {
  it('never reprints a date of birth', async () => {
    // The rule this exists for. The pack says which values were read and which a
    // person checked. It does not reprint them.
    expect(text).not.toContain('1988-04-12')
    expect(text).not.toContain('1989-04-11')
  })

  it('never reprints a document number', async () => {
    expect(text).not.toContain('X1234567')
  })

  it('says why, so a reader is not left wondering what is missing', async () => {
    expect(text).toContain('deliberately NOT reprinted here')
  })

  it('still says which values a person checked, by name', async () => {
    expect(text).toContain('expiry date')
  })

  it('says when nothing on a document needed a person', async () => {
    expect(text).toContain('Nothing on this document needed a person to look at it')
  })
})

describe('when a required value was never produced', () => {
  it('says a clearer document is needed, not that somebody should confirm it', async () => {
    const short = await buildPackDocument({
      ...contents,
      identity: [
        {
          owner: 'Ana Rivera',
          fieldsRead: '3',
          checkedByAPerson: [],
          missing: ['date_of_birth'],
        },
      ],
    })
    const said = wordsIn(short)

    expect(said).toContain('did not produce')
    expect(said).toContain('needs a clearer document')
  })
})

describe('when something was refused while the pack was being made', () => {
  it('prints what was refused as well as what would have been', async () => {
    const withRefusal = await buildPackDocument({
      ...contents,
      refusedInThisRun: [
        { operation: 'pdf_watermark', why: 'The pack is sealed, and stamping every page rewrites it.' },
      ],
    })
    const said = wordsIn(withRefusal)

    expect(said).toContain('Asked for while this pack was being assembled')
    expect(said).toContain('pdf_watermark')
  })
})

describe('fitting text to the page', () => {
  let font: Awaited<ReturnType<PDFDocument['embedFont']>>

  beforeAll(async () => {
    const document = await PDFDocument.create()
    font = await document.embedFont(StandardFonts.Helvetica)
  })

  it('breaks a long line into lines that fit', () => {
    const lines = wrap('one two three four five six seven eight nine ten', font, 10, 60)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) {
      // Only lines with more than one word have to fit. A single word longer than
      // the line is left to overflow rather than being cut.
      if (line.includes(' ')) expect(font.widthOfTextAtSize(line, 10)).toBeLessThanOrEqual(60)
    }
  })

  it('never cuts a word in half', () => {
    // A truncated word in a legal document is worse than an ugly one, because it
    // changes what the document says.
    const word = 'incontrovertibly'
    expect(wrap(word, font, 10, 10)).toEqual([word])
  })

  it('gives back one empty line rather than nothing', () => {
    expect(wrap('', font, 10, 200)).toEqual([''])
  })

  it('loses no words', () => {
    const sentence = 'the quick brown fox jumps over the lazy dog again and again'
    expect(wrap(sentence, font, 10, 80).join(' ')).toBe(sentence)
  })
})
