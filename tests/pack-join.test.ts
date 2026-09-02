/**
 * The page that says what Charter did not do, and the join that puts it in.
 *
 * WHY THIS PAGE EXISTS AT ALL
 *
 * Charter prepares everything around the government filing. It does not make the
 * filing. A packet that looks finished, in the hands of somebody who does not know
 * it is not finished, is the most expensive failure this project could produce:
 * their company would not exist, and they would find out when a bank or a court
 * asked them to prove that it did.
 *
 * So the packet carries its own correction, sealed with everything else, and these
 * tests are what keep it saying the right thing.
 *
 * THE TWO RULES THAT MATTER MOST HERE
 *
 * **It never guesses at a filing office.** Charter reasons about Texas law
 * specifically, so Texas is the only state it can honestly name an office for. For
 * anything else it says plainly that it does not hold the details. A guessed office
 * address in a legal packet is a person driving to the wrong building with the
 * wrong form.
 *
 * **It never prints a fee or a processing time.** Those change. A number that was
 * right on the day the packet was sealed and wrong on the day somebody reads it is
 * worse than no number, and a sealed document cannot be corrected.
 *
 * AND THE JOIN
 *
 * Two documents genuinely exist and are genuinely joined. Without a key that
 * happens here, with the same result, because a fresh clone of this project has to
 * produce a real packet — otherwise nobody can evaluate it without signing up to
 * four companies first. What the local join cannot do is read the finished text
 * back out, and it says so rather than pretending.
 */

import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { constants, inflateSync } from 'node:zlib'

import { buildNextStepsDocument, officeFor, FILING_OFFICES } from '../src/pack/next-steps.js'
import { joinHere, JOINED_HERE } from '../src/pack/join.js'

const STAMPED_AT = new Date(Date.UTC(2026, 7, 28, 9, 0, 0))

const contents = (over: Partial<Parameters<typeof buildNextStepsDocument>[0]> = {}) => ({
  companyName: 'Rivera Sisters Baking Co',
  state: 'TX',
  owners: ['Ana Rivera', 'Lucia Rivera'],
  addressRegistered: undefined,
  stampedAt: STAMPED_AT,
  ...over,
})

/**
 * Everything the page says, run together, so a test can look for a sentence.
 *
 * A PDF keeps its drawn text inside compressed streams, so reading the raw bytes
 * finds nothing. Each stream is unpacked, the ones that unpack are kept, and the
 * pieces of text a page is drawn from are pulled out of them. That is enough to
 * ask "does this document contain this sentence", which is all these tests need.
 */
async function wordsIn(bytes: Uint8Array): Promise<string> {
  const raw = Buffer.from(bytes)
  const pieces: string[] = []

  let at = 0
  for (;;) {
    const start = raw.indexOf('stream', at)
    if (start === -1) break
    const end = raw.indexOf('endstream', start)
    if (end === -1) break

    // Past "stream" and whatever line ending follows it.
    let from = start + 'stream'.length
    if (raw[from] === 0x0d) from += 1
    if (raw[from] === 0x0a) from += 1

    try {
      // Z_SYNC_FLUSH rather than the default, because the bytes between "stream"
      // and "endstream" carry a line ending the compressed data does not account
      // for, and the strict setting treats that as a broken stream.
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

  // A page draws its text as pieces written either in round brackets or as pairs
  // of hex digits in angle brackets. This writer uses the second. Both are read,
  // and running the pieces together is close enough to the sentence on the page
  // for a test to ask whether the document says something.
  const drawn = pieces.join('\n')

  const bracketed = [...drawn.matchAll(/\((?:[^()\\]|\\.)*\)/g)]
    .map((one) => one[0].slice(1, -1).replace(/\\([()\\])/g, '$1'))
    .join('')

  // Joined with a space rather than run together. Each piece is one line of the
  // page, so a sentence that wrapped would otherwise come back with two words
  // stuck together, and a test looking for that sentence would never find it.
  const hex = [...drawn.matchAll(/<([0-9A-Fa-f\s]+)>/g)]
    .map((one) => fromHex((one[1] as string).replace(/\s+/g, '')))
    .join(' ')

  return `${bracketed} ${hex}`.replace(/\s+/g, ' ')
}

/** Hex digits back into letters, in whichever of the two ways a PDF means them. */
function fromHex(digits: string): string {
  if (digits.length % 2 !== 0) return ''
  const bytes = Buffer.from(digits, 'hex')
  // A leading FEFF marks the pair-of-bytes form, which is what a title uses.
  return bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff
    ? bytes.subarray(2).swap16().toString('utf16le')
    : bytes.toString('latin1')
}

describe('which filing office a state has', () => {
  it('knows Texas, because that is the law Charter actually reasons about', () => {
    const office = officeFor('TX')
    expect(office?.office).toContain('Texas Secretary of State')
    expect(office?.form).toContain('205')
    expect(office?.readItHere).toBe('sos.texas.gov')
  })

  it('does not care how the state was written', () => {
    expect(officeFor('tx')).toBeDefined()
    expect(officeFor('  TX  ')).toBeDefined()
  })

  it('gives back nothing for a state it does not hold, rather than guessing', () => {
    expect(officeFor('CA')).toBeUndefined()
    expect(officeFor('DE')).toBeUndefined()
    expect(officeFor('')).toBeUndefined()
  })

  it('holds exactly one state, and says so by being one', () => {
    // If this ever grows, the page's wording about "the state Charter knows" has to
    // grow with it. The count is asserted so that adding a state fails here first.
    expect(Object.keys(FILING_OFFICES)).toEqual(['TX'])
  })
})

describe('the page itself', () => {
  it('says signing does not create the company', async () => {
    const page = await wordsIn(await buildNextStepsDocument(contents()))
    expect(page).toContain('does not create')
    expect(page).toContain('Rivera Sisters Baking Co')
  })

  it('names the office and the form for a state it knows', async () => {
    const page = await wordsIn(await buildNextStepsDocument(contents()))
    expect(page).toContain('Texas Secretary of State')
    expect(page).toContain('sos.texas.gov')
  })

  it('says it does not hold the details for a state it does not know', async () => {
    const page = await wordsIn(await buildNextStepsDocument(contents({ state: 'CA' })))
    expect(page).toContain('does not hold the filing office details')
    // And nothing that would send somebody to the wrong building.
    expect(page).not.toContain('Texas Secretary of State')
  })

  it('never prints a fee, a price, or a processing time', async () => {
    // The rule this page is most likely to be broken by later. A sealed document
    // cannot be corrected, so a stale number in it stays wrong forever.
    for (const state of ['TX', 'CA']) {
      const page = await wordsIn(await buildNextStepsDocument(contents({ state })))
      expect(page, `${state}: no money figure`).not.toMatch(/\$\s?\d/)
      expect(page, `${state}: no number of days`).not.toMatch(/\d+\s*(business\s*)?days/i)
    }
  })

  it('names every owner who has to sign', async () => {
    const page = await wordsIn(await buildNextStepsDocument(contents()))
    expect(page).toContain('Ana Rivera')
    expect(page).toContain('Lucia Rivera')
  })

  it('mentions a registered web address only when one was really registered', async () => {
    const without = await wordsIn(await buildNextStepsDocument(contents()))
    expect(without).not.toContain('riverasisters')

    const with_ = await wordsIn(
      await buildNextStepsDocument(contents({ addressRegistered: 'riverasisters.com' })),
    )
    expect(with_).toContain('riverasisters.com')
    // And it says the address has nothing to do with whether the company exists.
    expect(with_).toContain('nothing to do with whether the company exists')
  })

  it('is the same bytes every time it is built from the same facts', async () => {
    // A packet that changes every time it is built is a packet nobody can compare
    // against anybody else's copy.
    const once = await buildNextStepsDocument(contents())
    const twice = await buildNextStepsDocument(contents())
    expect(Buffer.from(once).equals(Buffer.from(twice))).toBe(true)
  })
})

describe('joining the packet together without an account', () => {
  const service = joinHere({ whyNotTheService: 'This is a test and reaches nothing.' })

  async function pagesIn(bytes: Uint8Array): Promise<number> {
    return (await PDFDocument.load(new Uint8Array(bytes))).getPageCount()
  }

  it('really joins, keeping every page of both documents', async () => {
    const first = await buildNextStepsDocument(contents())
    const second = await buildNextStepsDocument(contents({ companyName: 'Another Co' }))

    const joined = await service.join([
      { name: 'one', bytes: first },
      { name: 'two', bytes: second },
    ])

    expect(await pagesIn(joined.bytes)).toBe(
      (await pagesIn(first)) + (await pagesIn(second)),
    )
    expect(joined.joinedBy).toBe(JOINED_HERE)
    expect(joined.partNames).toEqual(['one', 'two'])
  })

  it('hands back the one document untouched when there is only one', async () => {
    const only = await buildNextStepsDocument(contents())
    const joined = await service.join([{ name: 'the only one', bytes: only }])
    expect(joined.bytes).toBe(only)
    expect(joined.joinedBy).toContain('nothing to join')
  })

  it('joins to the same bytes every time, even a second later', async () => {
    // THIS TEST USED TO PASS BY LUCK, AND THE LUCK WAS THE CLOCK.
    //
    // It joined twice in a row and compared. Two joins in the same second stamp
    // the same second, so it passed almost always and failed whenever the two
    // landed either side of a tick. What it was really asserting was "the clock
    // did not move", not "the join does not depend on the clock".
    //
    // The bug underneath was real and had two halves. pdf-lib writes the current
    // time into a document as its modification date when it CREATES one, and
    // again when it LOADS one. The second half is the nasty one: the joined file
    // takes its date from the first part, so opening that part restamped it, and
    // the date copied across was the moment of opening rather than the moment the
    // part was made.
    //
    // Why it matters here more than in most projects: this whole thing rests on
    // fingerprints. A packet whose bytes change every time it is built has a
    // fingerprint that changes every time it is built, and cannot be compared to
    // anything, checked against a record, or approved by name.
    //
    // So the clock is made to move, on purpose, between the two builds.
    const build = async () => {
      const first = await buildNextStepsDocument(contents())
      const second = await buildNextStepsDocument(contents({ companyName: 'Another Co' }))
      return await service.join([
        { name: 'one', bytes: first },
        { name: 'two', bytes: second },
      ])
    }

    const once = await build()
    await new Promise((wake) => setTimeout(wake, 1100))
    const twice = await build()

    expect(Buffer.from(once.bytes).equals(Buffer.from(twice.bytes))).toBe(true)
  })

  it('says the text was NOT read back, rather than pretending it was', async () => {
    // The whole difference between joining here and using the outside service.
    // Reading back is worth something because the reader is a different program
    // than the writer, and a reader living in this project would not be.
    const read = await service.readBack(new Uint8Array([1, 2, 3]))
    expect(read.happened).toBe(false)
    expect(read.readBy).toMatch(/nothing here says it was checked/i)
    expect(read.readBy).toContain('This is a test and reaches nothing.')
  })

  it('hands the file back unchanged when asked to make it smaller', async () => {
    const original = new Uint8Array([1, 2, 3])
    const shrunk = await service.shrink(original)
    expect(shrunk.bytes).toBe(original)
    expect(shrunk.wasShrunk).toBe(false)
  })

  it('refuses to pretend it joined nothing', async () => {
    await expect(service.join([])).rejects.toThrow(/nothing to join/i)
  })
})
