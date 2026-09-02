/**
 * Drawing the first picture, checked without an account.
 *
 * WHAT IT IS FOR
 *
 * A business formed this morning owns no photographs. No shopfront yet, nothing
 * photographed, no staff pictures, and no money to hire anybody. The one thing it
 * has is the sentence its owners typed when they described what they were
 * building, and that sentence is already in the record, because it is what started
 * the legal work.
 *
 * THE TWO THINGS CHECKED HARDEST
 *
 * **What is added to the owners' words, and why.** The picture is asked for with
 * nobody in it and no lettering. Both are refusals rather than styling. A picture
 * of a shop with invented people in it is a picture of staff the business does not
 * employ. A picture with invented lettering on the window is a sign saying
 * something nobody chose, on a business that has just spent an hour being careful
 * about what it says in writing.
 *
 * **That the owners' own sentence survives.** Not a summary of it, not a model's
 * words about them. If the sentence they typed does not appear in what was sent,
 * the picture is of something else.
 *
 * WHAT THIS DOES NOT PROVE
 *
 * That it works against their service. It has never been called, because there is
 * no key. Nothing in this project may say otherwise until somebody has run
 * npm run picture:proof and seen the address of a picture.
 */

import { describe, expect, it } from 'vitest'
import forge from 'node-forge'

import {
  perfectCorpImagery,
  asPem,
  describeThePicture,
  proofOfKey,
  firstUrlIn,
  CouldNotDraw,
  DRAWN_BY,
} from '../src/vendors/perfectcorp.js'

const BASE = 'https://pictures.example.invalid'
const KEY = 'a-key-that-is-not-real'
const AT = 1_756_000_000_000

/** A key pair made here, so nothing real is involved and nothing is committed. */
const pair = forge.pki.rsa.generateKeyPair({ bits: 1024 })
const PUBLIC_PEM = forge.pki.publicKeyToPem(pair.publicKey)

function pretendNetwork(answers: Readonly<Record<string, unknown>>): {
  readonly fetcher: (url: string, init: RequestInit) => Promise<Response>
  readonly asked: Array<{ url: string; body: unknown; headers: Record<string, string> }>
} {
  const asked: Array<{ url: string; body: unknown; headers: Record<string, string> }> = []

  return {
    asked,
    fetcher: async (url, init) => {
      const raw = typeof init.body === 'string' ? init.body : ''
      asked.push({
        url,
        body: raw.startsWith('{') ? JSON.parse(raw) : raw,
        headers: (init.headers ?? {}) as Record<string, string>,
      })

      const found = Object.entries(answers).find(([part]) => url.includes(part))
      return new Response(JSON.stringify(found === undefined ? { error: 'nothing here' } : found[1]), {
        status: found === undefined ? 404 : 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  }
}

const service = (fetcher: (url: string, init: RequestInit) => Promise<Response>) =>
  perfectCorpImagery({
    apiKey: KEY,
    publicKeyPem: PUBLIC_PEM,
    baseUrl: BASE,
    fetcher,
    now: () => AT,
    betweenAsks: 0,
    drawingPatience: 40,
  })

const FINISHED = {
  '/client/auth': { result: { access_token: 'a-token' } },
  '/s2s/v2.0/task/image-generator': { result: { task_id: 'task-1' } },
  '/s2s/v1.0/task/image-generator': {
    result: { status: 'success', results: [{ url: 'https://pictures.example.invalid/one.png' }] },
  },
}

describe('what is actually asked for', () => {
  it('keeps the owners’ own sentence, word for word', () => {
    const said = describeThePicture('A neighbourhood bakery in East Austin, open early')
    expect(said).toContain('A neighbourhood bakery in East Austin, open early')
  })

  it('asks for nobody in the picture', () => {
    // Invented people in a photograph of a shop are staff the business does not
    // employ, on the website of a company formed this morning.
    expect(describeThePicture('a bike shop')).toMatch(/nobody in the picture/)
  })

  it('asks for no lettering anywhere in it', () => {
    // Invented lettering on a window is a sign saying something nobody chose, on
    // a business that has just spent an hour being careful about its wording.
    expect(describeThePicture('a bike shop')).toMatch(/no words, letters or signs/)
  })

  it('does not mind how the owners spaced their sentence', () => {
    expect(describeThePicture('  a bike shop  ')).toContain('a bike shop.')
  })
})

describe('the public key, in whatever shape their console handed it over', () => {
  // Found with a real key in hand. Their console gives the key as one long run of
  // letters and numbers with no wrapper and no line breaks, and every encryption
  // library expects the wrapper. A key copied out correctly failed to parse, and
  // the error a person saw was about bad formatting, which reads as "you copied
  // it wrong". Both shapes are accepted now, so nobody has to know any of that.
  const bare = PUBLIC_PEM.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '')

  it('takes it with the wrapper already on, and changes nothing', () => {
    expect(asPem(PUBLIC_PEM)).toBe(PUBLIC_PEM.trim())
  })

  it('takes it bare, and puts the wrapper back', () => {
    const wrapped = asPem(bare)
    expect(wrapped.startsWith('-----BEGIN PUBLIC KEY-----\n')).toBe(true)
    expect(wrapped.trimEnd().endsWith('-----END PUBLIC KEY-----')).toBe(true)
  })

  it('produces a key the encryption library actually accepts', () => {
    // The only check that matters. The shape looking right and the shape parsing
    // are different facts, and this asserts the second one.
    const opened = pair.privateKey.decrypt(
      forge.util.decode64(proofOfKey(KEY, bare, AT)),
      'RSAES-PKCS1-V1_5',
    )
    expect(opened).toBe(`${KEY};${AT}`)
  })

  it('does not mind how the bare form was wrapped when it was pasted', () => {
    const acrossLines = (bare.match(/.{1,40}/g) ?? []).join('\n')
    expect(asPem(acrossLines)).toBe(asPem(bare))
  })
})

describe('proving the caller holds the arrangement', () => {
  it('encrypts the key and the time together, so an old block is useless', () => {
    const proof = proofOfKey(KEY, PUBLIC_PEM, AT)
    const opened = pair.privateKey.decrypt(forge.util.decode64(proof), 'RSAES-PKCS1-V1_5')
    expect(opened).toBe(`${KEY};${AT}`)
  })

  it('produces something different every time the clock moves', () => {
    expect(proofOfKey(KEY, PUBLIC_PEM, AT)).not.toBe(proofOfKey(KEY, PUBLIC_PEM, AT + 1))
  })
})

describe('drawing one picture', () => {
  it('signs in, asks, waits, and gives back where the picture is', async () => {
    const net = pretendNetwork(FINISHED)
    const drawn = await service(net.fetcher).draw('a neighbourhood bakery', '4:3')

    expect(drawn.url).toBe('https://pictures.example.invalid/one.png')
    expect(drawn.drawnBy).toBe(DRAWN_BY)
    expect(drawn.shape).toBe('4:3')
    // The exact words that produced it, kept so the record can show both.
    expect(drawn.fromWords).toContain('a neighbourhood bakery')
  })

  it('sends the owners’ words and nothing about anybody', async () => {
    const net = pretendNetwork(FINISHED)
    await service(net.fetcher).draw('a neighbourhood bakery', '4:3')

    const asked = net.asked.find((one) => one.url.includes('/s2s/v2.0/task'))
    const payload = (asked?.body as { payload: { prompt: string } }).payload
    expect(payload.prompt).toContain('a neighbourhood bakery')
    expect(payload.prompt).toContain('nobody in the picture')
  })

  it('carries the token on everything after the sign-in', async () => {
    const net = pretendNetwork(FINISHED)
    await service(net.fetcher).draw('a bakery', '4:3')

    const signIn = net.asked[0]
    expect(signIn?.headers['authorization'], 'the sign-in itself carries none').toBeUndefined()
    for (const later of net.asked.slice(1)) {
      expect(later.headers['authorization']).toBe('Bearer a-token')
    }
  })

  it('says so when the sign-in came back without a token', async () => {
    const net = pretendNetwork({ '/client/auth': { result: {} } })
    await expect(service(net.fetcher).draw('a bakery', '4:3')).rejects.toThrow(/no access_token/)
  })

  it('says so when there is no task to wait on', async () => {
    const net = pretendNetwork({
      '/client/auth': { result: { access_token: 'a-token' } },
      '/s2s/v2.0/task/image-generator': { result: {} },
    })
    await expect(service(net.fetcher).draw('a bakery', '4:3')).rejects.toThrow(/no task to wait on/)
  })

  it('gives up honestly when it is still drawing', async () => {
    const net = pretendNetwork({
      '/client/auth': { result: { access_token: 'a-token' } },
      '/s2s/v2.0/task/image-generator': { result: { task_id: 'task-1' } },
      '/s2s/v1.0/task/image-generator': { result: { status: 'running' } },
    })

    // A clock that moves, so the patience really runs out. With a clock that
    // stands still the wait is endless, which is the correct behaviour for a
    // clock that stands still and useless as a test.
    let ticking = AT
    const patient = perfectCorpImagery({
      apiKey: KEY,
      publicKeyPem: PUBLIC_PEM,
      baseUrl: BASE,
      fetcher: net.fetcher,
      now: () => (ticking += 25),
      betweenAsks: 0,
      drawingPatience: 40,
    })

    await expect(patient.draw('a bakery', '4:3')).rejects.toThrow(/still "running"/)
  })

  it('reports their failure in their own words', async () => {
    const net = pretendNetwork({
      '/client/auth': { result: { access_token: 'a-token' } },
      '/s2s/v2.0/task/image-generator': { result: { task_id: 'task-1' } },
      '/s2s/v1.0/task/image-generator': { result: { status: 'error', error: 'quota exceeded' } },
    })

    const failure = await service(net.fetcher)
      .draw('a bakery', '4:3')
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(CouldNotDraw)
    expect((failure as Error).message).toContain('quota exceeded')
  })

  it('says so when it finished without saying where the picture is', async () => {
    const net = pretendNetwork({
      '/client/auth': { result: { access_token: 'a-token' } },
      '/s2s/v2.0/task/image-generator': { result: { task_id: 'task-1' } },
      '/s2s/v1.0/task/image-generator': { result: { status: 'success', results: [] } },
    })
    await expect(service(net.fetcher).draw('a bakery', '4:3')).rejects.toThrow(
      /without saying where the picture is/,
    )
  })
})

describe('finding the picture in whatever shape the reply used', () => {
  it('finds it however deeply it is buried', () => {
    // Their own examples have put it under more than one name. Guessing at one and
    // failing silently when it is the other is the failure this avoids.
    expect(firstUrlIn({ results: [{ url: 'https://a.test/x.png' }] })).toBe('https://a.test/x.png')
    expect(firstUrlIn({ data: { output: ['https://a.test/y.png'] } })).toBe('https://a.test/y.png')
    expect(firstUrlIn('https://a.test/z.png')).toBe('https://a.test/z.png')
  })

  it('gives back nothing rather than something that is not an address', () => {
    expect(firstUrlIn({ results: [{ id: 'task-1', status: 'success' }] })).toBeNull()
    expect(firstUrlIn({})).toBeNull()
    expect(firstUrlIn(null)).toBeNull()
    expect(firstUrlIn('not-an-address')).toBeNull()
  })
})
