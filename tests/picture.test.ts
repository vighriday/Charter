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
 * THE THREE THINGS CHECKED HARDEST
 *
 * **That the owners' own sentence survives, untouched.** Not a summary of it, not
 * a model's words about them. If the sentence they typed is not what was sent, the
 * picture is of something else. This is also why their prompt rewriting is turned
 * off, and a test below asserts that it stays off.
 *
 * **Where the two refusals are put.** The picture is asked for with nobody in it
 * and no lettering, and both are refusals rather than styling. A picture of a shop
 * with invented people in it is a picture of staff the business does not employ. A
 * picture with invented lettering on the window is a sign saying something nobody
 * chose. Their service takes a separate description of what must NOT appear, so
 * the refusals go there. Writing "no people" into the description of what you want
 * is a known way to get people.
 *
 * **That a shape nobody draws is refused here, not by them.** They accept five
 * exact sizes and refuse the rest, so a wrong one is caught before it is sent.
 *
 * WHAT THIS DOES NOT PROVE
 *
 * That it works against their service. Nothing in this project may say otherwise
 * until somebody has run npm run picture:proof and seen the address of a picture.
 */

import { describe, expect, it } from 'vitest'

import {
  perfectCorpImagery,
  describeThePicture,
  whatToKeepOut,
  firstUrlIn,
  sizeFor,
  CouldNotDraw,
  DRAWN_BY,
  DRAW_PATH,
  MOST_WORDS,
  PICTURE_MODEL,
  SIZES,
} from '../src/vendors/perfectcorp.js'

const BASE = 'https://pictures.example.invalid'
const KEY = 'sk-a-key-that-is-not-real'
const AT = 1_756_000_000_000

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

      // Longest match first, so that waiting on a task is told apart from asking
      // for one: the two addresses share a prefix and the shorter one would
      // otherwise answer both.
      const found = Object.entries(answers)
        .sort(([a], [b]) => b.length - a.length)
        .find(([part]) => url.includes(part))

      return new Response(
        JSON.stringify(found === undefined ? { error: 'nothing here' } : found[1]),
        {
          status: found === undefined ? 404 : 200,
          headers: { 'content-type': 'application/json' },
        },
      )
    },
  }
}

const service = (fetcher: (url: string, init: RequestInit) => Promise<Response>) =>
  perfectCorpImagery({
    apiKey: KEY,
    baseUrl: BASE,
    fetcher,
    now: () => AT,
    betweenAsks: 0,
    drawingPatience: 40,
  })

const FINISHED = {
  [`${DRAW_PATH}/task-1`]: {
    status: 200,
    data: { status: 'success', results: [{ url: 'https://pictures.example.invalid/one.png' }] },
  },
  [DRAW_PATH]: { status: 200, data: { task_id: 'task-1' } },
}

describe('what is actually asked for', () => {
  it('keeps the owners’ own sentence, word for word', () => {
    const said = describeThePicture('A neighbourhood bakery in East Austin, open early')
    expect(said).toBe('A neighbourhood bakery in East Austin, open early')
  })

  it('adds nothing at all to it', () => {
    // Everything Charter wants to say is a refusal, and refusals belong in the
    // other description. Anything added here would be words the owners did not
    // write, in a picture of their business.
    expect(describeThePicture('a bike shop')).toBe('a bike shop')
  })

  it('does not mind how the owners spaced their sentence', () => {
    expect(describeThePicture('  a bike shop  ')).toBe('a bike shop')
  })

  it('cuts a very long description at their own limit', () => {
    expect(describeThePicture('x'.repeat(MOST_WORDS + 200))).toHaveLength(MOST_WORDS)
  })
})

describe('what is refused', () => {
  it('asks for nobody in the picture', () => {
    // Invented people in a photograph of a shop are staff the business does not
    // employ, on the website of a company formed this morning.
    expect(whatToKeepOut()).toMatch(/people/)
    expect(whatToKeepOut()).toMatch(/faces/)
  })

  it('asks for no lettering anywhere in it', () => {
    // Invented lettering on a window is a sign saying something nobody chose, on
    // a business that has just spent an hour being careful about its wording.
    expect(whatToKeepOut()).toMatch(/words/)
    expect(whatToKeepOut()).toMatch(/signage/)
  })

  it('puts the refusals in the description of what must NOT appear', async () => {
    const net = pretendNetwork(FINISHED)
    await service(net.fetcher).draw('a neighbourhood bakery', '4:3')

    const sent = net.asked[0]?.body as { prompt: string; negative_prompt: string }
    expect(sent.prompt).toBe('a neighbourhood bakery')
    expect(sent.negative_prompt).toMatch(/people/)
    expect(sent.prompt, 'a refusal in the positive description is a way to get it').not.toMatch(
      /people/,
    )
  })
})

describe('the shapes they will draw', () => {
  it('turns an ordinary name for a shape into their exact size', () => {
    expect(sizeFor('4:3')).toBe(SIZES['4:3'])
    expect(sizeFor('16:9')).toBe(SIZES['16:9'])
  })

  it('takes their own exact size straight through', () => {
    expect(sizeFor('1472*1104')).toBe('1472*1104')
    expect(sizeFor('1472x1104')).toBe('1472*1104')
  })

  it('gives back nothing for a shape they do not draw', () => {
    expect(sizeFor('7:5')).toBeNull()
    expect(sizeFor('1920x1080')).toBeNull()
  })

  it('refuses that shape here rather than sending it', async () => {
    const net = pretendNetwork(FINISHED)
    await expect(service(net.fetcher).draw('a bakery', '7:5')).rejects.toThrow(/not a shape/)
    expect(net.asked, 'nothing was sent').toHaveLength(0)
  })
})

describe('drawing one picture', () => {
  it('asks, waits, and gives back where the picture is', async () => {
    const net = pretendNetwork(FINISHED)
    const drawn = await service(net.fetcher).draw('a neighbourhood bakery', '4:3')

    expect(drawn.url).toBe('https://pictures.example.invalid/one.png')
    expect(drawn.drawnBy).toBe(DRAWN_BY)
    expect(drawn.shape).toBe('4:3')
    // The exact words that produced it, kept so the record can show both.
    expect(drawn.fromWords).toBe('a neighbourhood bakery')
  })

  it('names the one model they accept, rather than leaving it to a default', async () => {
    const net = pretendNetwork(FINISHED)
    await service(net.fetcher).draw('a bakery', '4:3')
    expect((net.asked[0]?.body as { model: string }).model).toBe(PICTURE_MODEL)
  })

  it('turns their prompt rewriting OFF, which is a policy and not a setting', async () => {
    // Their service will happily rewrite the description to add detail. That
    // would make it a picture of what a model thought the owners meant, while the
    // record holds the owners' own sentence beside it.
    const net = pretendNetwork(FINISHED)
    await service(net.fetcher).draw('a bakery', '4:3')
    expect((net.asked[0]?.body as { prompt_extend: boolean }).prompt_extend).toBe(false)
  })

  it('carries the key on every call', async () => {
    const net = pretendNetwork(FINISHED)
    await service(net.fetcher).draw('a bakery', '4:3')

    expect(net.asked.length).toBeGreaterThan(1)
    for (const one of net.asked) {
      expect(one.headers['authorization']).toBe(`Bearer ${KEY}`)
    }
  })

  it('refuses when the owners have not said what their business is', async () => {
    const net = pretendNetwork(FINISHED)
    await expect(service(net.fetcher).draw('   ', '4:3')).rejects.toThrow(/nothing to draw/)
    expect(net.asked).toHaveLength(0)
  })

  it('says so when there is no task to wait on', async () => {
    const net = pretendNetwork({ [DRAW_PATH]: { status: 200, data: {} } })
    await expect(service(net.fetcher).draw('a bakery', '4:3')).rejects.toThrow(/no task to wait on/)
  })

  it('gives up honestly when it is still drawing', async () => {
    const net = pretendNetwork({
      [`${DRAW_PATH}/task-1`]: { status: 200, data: { status: 'running' } },
      [DRAW_PATH]: { status: 200, data: { task_id: 'task-1' } },
    })

    // A clock that moves, so the patience really runs out. With a clock that
    // stands still the wait is endless, which is the correct behaviour for a
    // clock that stands still and useless as a test.
    let ticking = AT
    const patient = perfectCorpImagery({
      apiKey: KEY,
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
      [`${DRAW_PATH}/task-1`]: { status: 200, data: { status: 'error', error: 'quota exceeded' } },
      [DRAW_PATH]: { status: 200, data: { task_id: 'task-1' } },
    })

    const failure = await service(net.fetcher)
      .draw('a bakery', '4:3')
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(CouldNotDraw)
    expect((failure as Error).message).toContain('quota exceeded')
  })

  it('says so when it finished without saying where the picture is', async () => {
    const net = pretendNetwork({
      [`${DRAW_PATH}/task-1`]: { status: 200, data: { status: 'success', results: [] } },
      [DRAW_PATH]: { status: 200, data: { task_id: 'task-1' } },
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
