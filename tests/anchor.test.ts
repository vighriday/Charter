/**
 * Proving that an outside timestamp is read correctly, and that a wrong one is
 * refused.
 *
 * THE CRITICISM THIS ANSWERS
 *
 * Charter holds the record AND the key that attests over it. So in principle we
 * could throw the record away, produce a different one, attest over that, and
 * nothing inside the record would show it. Every link in that chain is made by us.
 *
 * A timestamp authority is somebody who is not us. They take a fingerprint — never
 * the record — and hand back a statement that they were shown it at a moment. That
 * does not stop us rewriting the record. It means a rewritten record has to produce
 * a different head, while the outside statement about the old head still exists,
 * held by somebody else. The past can still be rewritten. It can no longer be
 * rewritten quietly.
 *
 * WHY NO REQUEST IS MADE HERE
 *
 * These are free services run as a public good, and their own guidance asks people
 * not to hammer them. A test suite that stamped a fingerprint on every run would be
 * abusing a service somebody pays for out of goodwill.
 *
 * So the tokens below are built here, with the same library and the same structure
 * a real authority produces. That exercises everything this project does with a
 * token — finding the statement inside the nesting, reading what was stamped and
 * when, refusing one about a different fingerprint — without sending anything
 * anywhere.
 *
 * THE TEST THAT MATTERS MOST
 *
 * The one that refuses a token about somebody else's fingerprint. A token can be
 * completely genuine, correctly signed by a real authority, and about a different
 * record entirely. It would look right in every way that is easy to check, and it
 * would prove nothing about ours.
 */

import forge from 'node-forge'
import { describe, expect, it } from 'vitest'
import {
  AUTHORITIES,
  CONTENT_TYPE_REQUEST,
  CannotAnchor,
  anchorCovers,
  anchorHead,
  buildRequest,
  generalizedTime,
  howToCheckTheSignature,
  readToken,
  type Anchor,
} from '../src/record/anchor.js'

const HEAD = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)

const SHA256_OID = '2.16.840.1.101.3.4.2.1'
const TST_INFO_OID = '1.2.840.113549.1.9.16.1.4'
const SIGNED_DATA_OID = '1.2.840.113549.1.7.2'

const { asn1 } = forge

/**
 * Build a timestamp token with the same shape a real authority returns.
 *
 * The nesting is the part worth reproducing: the statement about what was stamped
 * sits several layers down, inside a block of bytes that is itself a structure, and
 * a reader that counted steps rather than looking for the marker would break
 * against a different authority.
 *
 * The signature is not made, because nothing in this project checks it — see the
 * note in `anchor.ts` about why that is left to tools that already do it well.
 */
function tokenFor(
  stamped: string,
  at: string,
  nonce?: string,
): Uint8Array {
  const tstInfo = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, forge.util.hexToBytes('01')),
    asn1.create(
      asn1.Class.UNIVERSAL,
      asn1.Type.OID,
      false,
      asn1.oidToDer('1.2.3.4.1').getBytes(),
    ),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(SHA256_OID).getBytes()),
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, ''),
      ]),
      asn1.create(
        asn1.Class.UNIVERSAL,
        asn1.Type.OCTETSTRING,
        false,
        forge.util.hexToBytes(stamped),
      ),
    ]),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, forge.util.hexToBytes('0f')),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.GENERALIZEDTIME, false, at),
    ...(nonce === undefined
      ? []
      : [
          asn1.create(
            asn1.Class.UNIVERSAL,
            asn1.Type.INTEGER,
            false,
            forge.util.hexToBytes(
              BigInt(nonce).toString(16).length % 2 === 0
                ? BigInt(nonce).toString(16)
                : `0${BigInt(nonce).toString(16)}`,
            ),
          ),
        ]),
  ])

  const encapsulated = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(TST_INFO_OID).getBytes()),
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
      asn1.create(
        asn1.Class.UNIVERSAL,
        asn1.Type.OCTETSTRING,
        false,
        asn1.toDer(tstInfo).getBytes(),
      ),
    ]),
  ])

  const signedData = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, forge.util.hexToBytes('03')),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, []),
    encapsulated,
  ])

  const contentInfo = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(SIGNED_DATA_OID).getBytes()),
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [signedData]),
  ])

  const der = asn1.toDer(contentInfo).getBytes()
  return Uint8Array.from(der, (character) => character.charCodeAt(0) & 0xff)
}

const answering = (body: Uint8Array, status = 200) =>
  (async () =>
    new Response(Buffer.from(body), {
      status,
      headers: { 'content-type': 'application/timestamp-reply' },
    })) as (url: string, init: RequestInit) => Promise<Response>

// ─────────────────────────────────────────────────────────────────────────────
// Asking
// ─────────────────────────────────────────────────────────────────────────────

describe('the request that asks for a stamp', () => {
  it('is a structure an authority can read', () => {
    const request = buildRequest(HEAD, '12345')
    expect(request.length).toBeGreaterThan(40)
    expect(() =>
      asn1.fromDer(forge.util.createBuffer(Buffer.from(request).toString('binary'))),
    ).not.toThrow()
  })

  it('carries the fingerprint and nothing else about the record', () => {
    // The authority never sees the record. Only a fingerprint of the end of it, so
    // nothing private goes anywhere at all.
    const request = Buffer.from(buildRequest(HEAD, '1')).toString('hex')
    expect(request).toContain(HEAD)
  })

  it('names sha256, because that is the fingerprint this project uses', () => {
    const request = buildRequest(HEAD, '1')
    const tree = asn1.fromDer(forge.util.createBuffer(Buffer.from(request).toString('binary')))
    const said = JSON.stringify(asn1.toDer(tree).toHex())
    // The identifier for sha256, as bytes.
    expect(said).toContain('608648016503040201')
  })

  it('refuses anything that is not a fingerprint', () => {
    // A stamp of something that is not a fingerprint is a token nobody can match
    // against anything.
    for (const bad of ['', 'hello', 'a'.repeat(63), 'z'.repeat(64)]) {
      expect(() => buildRequest(bad, '1'), bad).toThrow(CannotAnchor)
    }
  })

  it('refuses a nonce that is not a whole number', () => {
    expect(() => buildRequest(HEAD, 'abc')).toThrow(CannotAnchor)
    expect(() => buildRequest(HEAD, '')).toThrow(CannotAnchor)
  })

  it('offers more than one authority, because these are free services', () => {
    // Run as a public good, and any of them may be down on the day.
    expect(AUTHORITIES.length).toBeGreaterThan(1)
    for (const one of AUTHORITIES) {
      expect(one.url, one.name).toMatch(/^https?:\/\//)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Reading what came back
// ─────────────────────────────────────────────────────────────────────────────

describe('reading a token', () => {
  it('finds what was stamped, several layers down', () => {
    const contents = readToken(tokenFor(HEAD, '20260903120000Z'))
    expect(contents.stamped).toBe(HEAD)
  })

  it('reads the time into the form the record uses', () => {
    const contents = readToken(tokenFor(HEAD, '20260903120000Z'))
    expect(contents.at).toBe('2026-09-03T12:00:00.000Z')
  })

  it('reads the nonce back, when the authority copied one', () => {
    expect(readToken(tokenFor(HEAD, '20260903120000Z', '4242')).nonce).toBe('4242')
  })

  it('says plainly when the reply is not a token at all', () => {
    expect(() => readToken(new Uint8Array([1, 2, 3]))).toThrow(CannotAnchor)
  })

  it('says plainly when a token carries no statement of what was stamped', () => {
    // A token without that part cannot be matched against any record, so it proves
    // nothing — and an empty answer here would look exactly like a good one.
    const empty = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, forge.util.hexToBytes('01')),
    ])
    const der = asn1.toDer(empty).getBytes()
    const bytes = Uint8Array.from(der, (character) => character.charCodeAt(0) & 0xff)

    expect(() => readToken(bytes)).toThrow(/proves nothing/)
  })

  it('turns the time form these tokens use into the one the record uses', () => {
    expect(generalizedTime('20260903120000Z')).toBe('2026-09-03T12:00:00.000Z')
    expect(generalizedTime('20260903120000.123Z')).toBe('2026-09-03T12:00:00.000Z')
  })

  it('passes an unfamiliar time through rather than guessing at it', () => {
    // A wrong time is worse than an unfamiliar one.
    expect(generalizedTime('sometime on Tuesday')).toBe('sometime on Tuesday')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Anchoring
// ─────────────────────────────────────────────────────────────────────────────

describe('anchoring the head of a record', () => {
  it('keeps the token exactly as it arrived', async () => {
    const token = tokenFor(HEAD, '20260903120000Z')
    const attempt = await anchorHead(HEAD, {
      nonce: '1',
      fetcher: answering(token),
      authorities: [{ name: 'a-stand-in', url: 'https://example.test/tsr' }],
    })

    expect(attempt.anchor).toBeDefined()
    expect(Buffer.from(attempt.anchor?.token ?? '', 'base64').equals(Buffer.from(token))).toBe(true)
  })

  it('records which authority answered, and when they say it was', async () => {
    const attempt = await anchorHead(HEAD, {
      nonce: '1',
      fetcher: answering(tokenFor(HEAD, '20260903120000Z')),
      authorities: [{ name: 'a-stand-in', url: 'https://example.test/tsr' }],
    })

    expect(attempt.anchor?.authority).toBe('a-stand-in')
    expect(attempt.anchor?.at).toBe('2026-09-03T12:00:00.000Z')
  })

  it('says the authority was shown a fingerprint and never the record', async () => {
    const attempt = await anchorHead(HEAD, {
      nonce: '1',
      fetcher: answering(tokenFor(HEAD, '20260903120000Z')),
      authorities: [{ name: 'a-stand-in', url: 'https://example.test/tsr' }],
    })
    expect(attempt.why).toMatch(/never the record/)
  })

  it('sends the request as a timestamp query', async () => {
    let seen: RequestInit | undefined
    await anchorHead(HEAD, {
      nonce: '1',
      authorities: [{ name: 'a-stand-in', url: 'https://example.test/tsr' }],
      fetcher: async (_url, init) => {
        seen = init
        return new Response(Buffer.from(tokenFor(HEAD, '20260903120000Z')), { status: 200 })
      },
    })

    const headers = seen?.headers as Record<string, string>
    expect(headers['content-type']).toBe(CONTENT_TYPE_REQUEST)
  })

  it('REFUSES a token about somebody else’s fingerprint', async () => {
    // The most important test in this file. A token can be completely genuine,
    // correctly signed by a real authority, and about a different record entirely.
    // It would look right in every way that is easy to check.
    const attempt = await anchorHead(HEAD, {
      nonce: '1',
      fetcher: answering(tokenFor(OTHER, '20260903120000Z')),
      authorities: [{ name: 'a-stand-in', url: 'https://example.test/tsr' }],
    })

    expect(attempt.anchor).toBeUndefined()
    expect(attempt.why).toMatch(/stamped a different fingerprint/)
  })

  it('refuses a token answering a different question', async () => {
    // The nonce is what separates a fresh answer from a saved one handed back.
    const attempt = await anchorHead(HEAD, {
      nonce: '1',
      fetcher: answering(tokenFor(HEAD, '20260903120000Z', '999')),
      authorities: [{ name: 'a-stand-in', url: 'https://example.test/tsr' }],
    })

    expect(attempt.anchor).toBeUndefined()
    expect(attempt.why).toMatch(/different question/)
  })

  it('tries the next authority when the first is down', async () => {
    // These are free services run as a public good. One being unavailable on the
    // day is not a fault in this program.
    const attempt = await anchorHead(HEAD, {
      nonce: '1',
      authorities: [
        { name: 'down', url: 'https://down.test/tsr' },
        { name: 'up', url: 'https://up.test/tsr' },
      ],
      fetcher: async (url) => {
        if (url.includes('down')) throw new Error('connection refused')
        return new Response(Buffer.from(tokenFor(HEAD, '20260903120000Z')), { status: 200 })
      },
    })

    expect(attempt.anchor?.authority).toBe('up')
    expect(attempt.why).toContain('down')
  })

  it('never throws when nobody answers, and says what is missing', async () => {
    // An anchor that quietly failed and left the claim standing would be worse
    // than no anchor at all.
    const attempt = await anchorHead(HEAD, {
      nonce: '1',
      authorities: [{ name: 'down', url: 'https://down.test/tsr' }],
      fetcher: async () => {
        throw new Error('connection refused')
      },
    })

    expect(attempt.anchor).toBeUndefined()
    expect(attempt.why).toMatch(/Nothing is wrong with the record/)
    expect(attempt.why).toMatch(/somebody who is not us/)
  })

  it('treats a refusal as a refusal rather than as an answer', async () => {
    const attempt = await anchorHead(HEAD, {
      nonce: '1',
      authorities: [{ name: 'busy', url: 'https://busy.test/tsr' }],
      fetcher: answering(new Uint8Array(), 503),
    })
    expect(attempt.anchor).toBeUndefined()
    expect(attempt.why).toContain('503')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Checking one afterwards
// ─────────────────────────────────────────────────────────────────────────────

describe('checking an anchor that came with a record', () => {
  const anchorFor = (stamped: string, at: string, said = at): Anchor => ({
    v: '1',
    authority: 'a-stand-in',
    head: stamped,
    at: said,
    token: Buffer.from(tokenFor(stamped, at)).toString('base64'),
  })

  it('agrees when the token really is about this record', () => {
    const result = anchorCovers(anchorFor(HEAD, '20260903120000Z', '2026-09-03T12:00:00.000Z'), HEAD)
    expect(result.ok).toBe(true)
  })

  it('reads what was stamped out of the token, not out of what we wrote beside it', () => {
    // The fields beside the token are ours and could say anything. The token is
    // theirs. So a record claiming an anchor covers it, with a token that says
    // otherwise, is refused — and the message says which one counts.
    const lying: Anchor = {
      ...anchorFor(OTHER, '20260903120000Z', '2026-09-03T12:00:00.000Z'),
      head: HEAD,
    }
    const result = anchorCovers(lying, HEAD)

    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/real timestamp of a different thing/)
  })

  it('refuses when the time beside the token disagrees with the token', () => {
    const lying = anchorFor(HEAD, '20260903120000Z', '2020-01-01T00:00:00.000Z')
    const result = anchorCovers(lying, HEAD)

    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/token is the one that counts/)
  })

  it('says plainly when the token cannot be read', () => {
    const broken: Anchor = {
      v: '1',
      authority: 'a-stand-in',
      head: HEAD,
      at: '2026-09-03T12:00:00.000Z',
      token: Buffer.from([1, 2, 3]).toString('base64'),
    }
    expect(anchorCovers(broken, HEAD).ok).toBe(false)
  })

  it('tells somebody how to check the authority’s own signature', () => {
    // Charter does not check it, and says so rather than leaving the impression
    // that it did. Validating a certificate chain properly is something every
    // operating system already does well.
    const said = howToCheckTheSignature('out/anchor.tsr')
    expect(said).toContain('openssl ts -reply')
    expect(said).toContain('out/anchor.tsr')
    expect(said).toMatch(/does not check/)
  })
})
