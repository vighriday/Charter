/**
 * Proving the check a stranger runs against a finished pack.
 *
 * WHAT IS BEING PROVED
 *
 * Somebody is handed a pack and the record of the run that made it. The check
 * tells them whether either can be believed, using nothing but those two files and
 * a public key committed to this repository.
 *
 * Every test below runs it twice: once against a good pack, where every answer
 * must be yes, and once against the same pack with something changed, where the
 * answer must be no and must name what broke. A checker that has only ever seen
 * good input has never been shown to catch anything and would pass just as
 * happily if it were broken.
 *
 * WHY THE KEY COMES FROM OUTSIDE
 *
 * The attestation is checked against `keys/attestation.pub`, never against a key
 * found in the pack. A checker that read its key out of the thing it was checking
 * would prove nothing at all: anybody could invent a key, vouch for anything with
 * it, and ship both together. There is a test for that below, and it is the most
 * important one in this file.
 */

import { readFileSync } from 'node:fs'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { beforeAll, describe, expect, it } from 'vitest'
import { attest, generateKeyPair, type Attestation } from '../src/record/attestation.js'
import { nextPrevHash, sealEvent, type ChainedEvent, type EventContent } from '../src/record/chain.js'
import { fingerprintBytes } from '../src/record/canonical.js'
import { makeSealCertificate } from '../src/seal/certificate.js'
import { sealPack } from '../src/seal/seal.js'
import {
  packFingerprintFromRecord,
  verifyEverything,
  describeVerification,
  type WhatToCheck,
} from '../src/verify/check.js'

const RUN = 'verify-me'

let pack: Uint8Array
let packFingerprint: string
let events: ChainedEvent[]
let payloads: Map<string, Record<string, unknown>>
let attestation: Attestation
let publicKeyPem: string

/** Build a chained record the same way the real one is built. */
function buildRecord(entries: readonly { kind: string; payload: Record<string, unknown> }[]) {
  const built: ChainedEvent[] = []
  const bag = new Map<string, Record<string, unknown>>()
  let previous: ChainedEvent | undefined

  for (const [index, entry] of entries.entries()) {
    const content: EventContent = {
      runId: RUN,
      seq: String(index + 1),
      kind: entry.kind,
      actor: 'system',
      stage: null,
      ts: `2026-08-30T09:00:0${index}.000Z`,
      payloadHash: fingerprintBytes(new TextEncoder().encode(JSON.stringify(entry.payload))),
    }
    const chained = sealEvent(content, nextPrevHash(RUN, previous))

    built.push(chained)
    bag.set(chained.seq, entry.payload)
    previous = chained
  }

  return { built, bag }
}

beforeAll(async () => {
  const certificate = makeSealCertificate({
    notBefore: new Date(Date.UTC(2026, 0, 1)),
    password: 'a-long-enough-password',
  })

  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let page = 1; page <= 3; page += 1) {
    doc.addPage([595, 842]).drawText(`page ${page}`, { x: 60, y: 760, size: 14, font })
  }

  const sealed = await sealPack(await doc.save(), certificate, {
    at: new Date(Date.UTC(2026, 7, 30, 12)),
  })
  pack = sealed.bytes
  packFingerprint = sealed.fingerprint

  const record = buildRecord([
    { kind: 'stage.entered', payload: { to: 'assemble' } },
    { kind: 'pack.sealed', payload: { fingerprint: packFingerprint, sizeBytes: sealed.sizeBytes } },
  ])
  events = record.built
  payloads = record.bag

  const keys = generateKeyPair()
  publicKeyPem = keys.publicKeyPem
  attestation = attest(
    {
      runId: RUN,
      head: (events[events.length - 1] as ChainedEvent).hash,
      count: String(events.length),
      attestedAt: '2026-08-30T12:00:00.000Z',
    },
    keys.privateKeyPem,
  )
}, 120_000)

const check = (over: Partial<WhatToCheck> = {}) =>
  verifyEverything({
    pack,
    events,
    runId: RUN,
    attestation,
    publicKeyPem,
    recordedPackFingerprint: packFingerprintFromRecord(
      events,
      (event) => payloads.get(event.seq) ?? null,
    ),
    ...over,
  })

const answerTo = (result: ReturnType<typeof check>, fragment: string) =>
  result.findings.find((one) => one.question.includes(fragment))

describe('a good pack, with its record', () => {
  it('answers yes to everything', () => {
    const result = check()
    expect(result.ok, describeVerification(result)).toBe(true)
  })

  it('confirms the seal allows only filling in and signing', () => {
    expect(answerTo(check(), 'only filling in and signing')?.answer).toBe('yes')
  })

  it('confirms the seal covers the whole file', () => {
    expect(answerTo(check(), 'cover the whole file')?.answer).toBe('yes')
  })

  it('confirms this is the pack the record describes', () => {
    expect(answerTo(check(), 'same pack the record describes')?.answer).toBe('yes')
  })

  it('confirms the record is unbroken', () => {
    expect(answerTo(check(), 'unbroken')?.answer).toBe('yes')
  })

  it('confirms the attestation vouches for the end of it', () => {
    expect(answerTo(check(), 'attestation match')?.answer).toBe('yes')
  })
})

describe('one byte changed by hand', () => {
  it('goes red, and names the pack as the thing that no longer matches', () => {
    const tampered = Uint8Array.from(pack)
    const spot = Math.floor(tampered.length / 2)
    tampered[spot] = (tampered[spot] as number) ^ 0xff

    const result = check({ pack: tampered })

    expect(result.ok).toBe(false)
    expect(answerTo(result, 'same pack the record describes')?.answer).toBe('no')
    expect(answerTo(result, 'same pack the record describes')?.detail ?? '').toMatch(
      /different files/,
    )
  })

  it('still says the record itself is fine, because it is', () => {
    // A checker that failed everything on one problem would be no use for finding
    // out WHAT went wrong.
    const tampered = Uint8Array.from(pack)
    tampered[0] = (tampered[0] as number) ^ 0xff

    expect(answerTo(check({ pack: tampered }), 'unbroken')?.answer).toBe('yes')
  })
})

describe('an altered record', () => {
  it('goes red, and names the entry that broke', () => {
    const altered = events.map((one, index) =>
      index === 0 ? { ...one, kind: 'something.else' } : one,
    )

    const result = check({ events: altered })

    expect(result.ok).toBe(false)
    const finding = answerTo(result, 'unbroken')
    expect(finding?.answer).toBe('no')
    expect(finding?.detail ?? '').toMatch(/breaks at entry/)
  })

  it('notices a shortened record through the attestation, which the chain cannot', () => {
    // The one thing a chain of fingerprints cannot catch on its own: a shortened
    // chain is still a valid chain. This is what the attestation is for, and this
    // test is the proof that it earns its place.
    const shortened = events.slice(0, 1)

    const result = check({ events: shortened })

    expect(answerTo(result, 'unbroken')?.answer, 'the chain should still be happy').toBe('yes')
    expect(answerTo(result, 'cover the record that was handed over')?.answer).toBe('no')
    expect(result.ok).toBe(false)
  })
})

describe('the key comes from outside the pack', () => {
  it('refuses an attestation made with somebody else’s key', () => {
    // The most important test here. If a checker accepted a key shipped alongside
    // the thing it was checking, anybody could invent a key, vouch for anything
    // with it, and the check would say yes to all of it.
    const impostor = generateKeyPair()
    const forged = attest(
      {
        runId: RUN,
        head: (events[events.length - 1] as ChainedEvent).hash,
        count: String(events.length),
        attestedAt: '2026-08-30T12:00:00.000Z',
      },
      impostor.privateKeyPem,
    )

    const result = check({ attestation: forged })

    expect(answerTo(result, 'attestation match')?.answer).toBe('no')
    expect(result.ok).toBe(false)
  })

  it('checks against the key committed to this repository', () => {
    // The file the command actually reads. If this ever stops existing, the check
    // has nothing to check against and says so rather than passing.
    const committed = readFileSync('keys/attestation.pub', 'utf8')
    expect(committed).toContain('BEGIN PUBLIC KEY')
  })
})

describe('what it says it cannot prove', () => {
  it('says the certificate is self-issued rather than hiding it', () => {
    // A PDF reader will report the same thing. A project that says it first is in
    // a much better position than one caught by it.
    const said = check().cannotProve.join(' ')
    expect(said).toMatch(/issued by Charter to Charter/)
  })

  it('says it is not a review of the document and not a legal opinion', () => {
    expect(check().cannotProve.join(' ')).toMatch(/not a review of the document/)
  })

  it('prints those limits in what a person reads, not only in the data', () => {
    expect(describeVerification(check())).toMatch(/What this check cannot prove/)
  })
})

describe('a pack that was never sealed', () => {
  it('says so plainly instead of guessing', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([595, 842])
    const plain = await doc.save()

    const result = check({ pack: plain, recordedPackFingerprint: fingerprintBytes(plain) })

    expect(answerTo(result, 'carries a seal')?.answer).toBe('no')
    expect(answerTo(result, 'carries a seal')?.detail ?? '').toMatch(/nothing has sealed it/)
    expect(result.ok).toBe(false)
  })
})
