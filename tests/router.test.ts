import { describe, it, expect, vi } from 'vitest'
import { Router, mayReceive, NoProviderAvailable, DEFAULT_ROUTES } from '../src/model/router.js'
import {
  ContextTooLarge,
  RateLimited,
  ProviderDown,
  MAX_REQUEST_TOKENS,
  estimateTurnTokens,
  type Capabilities,
  type ModelProvider,
  type TurnRequest,
  type TurnResult,
} from '../src/model/types.js'

/** A stand-in provider whose behaviour each test sets exactly. */
function fakeProvider(
  id: string,
  over: Partial<Capabilities> = {},
  behaviour: () => Promise<TurnResult> = async () => ({
    kind: 'tool_call',
    name: 'ask_question',
    args: { question: 'who owns it?' },
    raw: { from: id },
    usage: { inputTokens: 10, outputTokens: 5 },
  }),
): ModelProvider {
  return {
    id,
    capabilities: {
      forcedToolChoice: true,
      allowedToolsServerSide: true,
      schemaWithTools: true,
      maxRequestTokens: 1_000_000,
      retainsInput: false,
      trainsOnInput: false,
      ...over,
    },
    turn: behaviour,
    extract: async () => ({ ok: true }),
  }
}

const request = (over: Partial<TurnRequest> = {}): TurnRequest => ({
  stage: 'understand',
  sensitivity: 'public',
  situation: 'Two sisters, a bakery, one put in cash and one put in an oven.',
  history: [],
  tools: [{ name: 'ask_question', description: 'ask one thing', parameters: { type: 'object' } }],
  toolChoice: 'required',
  ...over,
})

describe('the rule about a person\'s details', () => {
  // The most important rule in this file. Our main provider's free tier learns
  // from what it is sent, and its own terms warn against sending personal
  // information. This is what makes that a property of the code rather than
  // something somebody has to remember.

  it('lets anything through when nothing personal is involved', () => {
    const learns = fakeProvider('learns', { trainsOnInput: true, retainsInput: true })
    expect(mayReceive(learns, 'public').allowed).toBe(true)
  })

  it('refuses a provider that learns from what it is sent', () => {
    const learns = fakeProvider('learns', { trainsOnInput: true })
    const verdict = mayReceive(learns, 'personal')
    expect(verdict.allowed).toBe(false)
    if (!verdict.allowed) expect(verdict.reason).toMatch(/learns from what it is sent/)
  })

  it('refuses a provider that merely keeps what it is sent', () => {
    const keeps = fakeProvider('keeps', { retainsInput: true })
    const verdict = mayReceive(keeps, 'personal')
    expect(verdict.allowed).toBe(false)
    if (!verdict.allowed) expect(verdict.reason).toMatch(/keeps what it is sent/)
  })

  it('allows a provider that keeps nothing and learns nothing', () => {
    expect(mayReceive(fakeProvider('clean'), 'personal').allowed).toBe(true)
  })

  it('skips the ineligible provider and uses the next one that qualifies', async () => {
    const attempts: string[] = []
    const router = new Router({
      providers: [
        fakeProvider('gemini:free', { trainsOnInput: true }),
        fakeProvider('groq:qwen'),
      ],
      routes: { verify: ['gemini:free', 'groq:qwen'] },
      fallback: [],
      onAttempt: (a) => attempts.push(`${a.providerId}:${a.outcome}`),
    })

    const result = await router.turn(request({ stage: 'verify', sensitivity: 'personal' }))

    expect(result.providerId).toBe('groq:qwen')
    expect(attempts).toEqual(['gemini:free:skipped-sensitivity', 'groq:qwen:answered'])
  })

  it('fails rather than sending, when no eligible provider exists', async () => {
    const router = new Router({
      providers: [fakeProvider('gemini:free', { trainsOnInput: true })],
      routes: { verify: ['gemini:free'] },
      fallback: [],
    })

    await expect(router.turn(request({ stage: 'verify', sensitivity: 'personal' }))).rejects.toBeInstanceOf(
      NoProviderAvailable,
    )
  })

  it('never calls a provider it is not allowed to call', async () => {
    const called = vi.fn()
    const router = new Router({
      providers: [fakeProvider('learns', { trainsOnInput: true }, async () => { called(); throw new Error('should never run') })],
      routes: { verify: ['learns'] },
      fallback: [],
    })

    await expect(router.turn(request({ stage: 'verify', sensitivity: 'personal' }))).rejects.toThrow()
    expect(called).not.toHaveBeenCalled()
  })
})

describe('the size ceiling', () => {
  it('refuses an oversized request here, before anything is sent', async () => {
    const called = vi.fn()
    const router = new Router({
      providers: [fakeProvider('p', {}, async () => { called(); throw new Error('should never run') })],
      routes: { understand: ['p'] },
      fallback: [],
    })

    // Well past the ceiling once estimated at three characters per token.
    const huge = 'x'.repeat(MAX_REQUEST_TOKENS * 4)
    await expect(router.turn(request({ situation: huge }))).rejects.toBeInstanceOf(ContextTooLarge)
    expect(called).not.toHaveBeenCalled()
  })

  it('uses whichever ceiling is smaller — ours or the provider\'s', async () => {
    const router = new Router({
      providers: [fakeProvider('tight', { maxRequestTokens: 100 })],
      routes: { understand: ['tight'] },
      fallback: [],
    })

    const text = 'x'.repeat(600) // about 200 tokens: under ours, over theirs
    await expect(router.turn(request({ situation: text }))).rejects.toBeInstanceOf(ContextTooLarge)
  })

  it('says what to do about it', async () => {
    const router = new Router({
      providers: [fakeProvider('p', { maxRequestTokens: 50 })],
      routes: { understand: ['p'] },
      fallback: [],
    })
    await expect(router.turn(request({ situation: 'x'.repeat(1000) }))).rejects.toThrow(
      /reference and a summary/,
    )
  })

  it('estimates high rather than low, because the opposite mistake is worse', () => {
    // Erring high refuses a few requests that would have fit. Erring low lets
    // through one that cannot succeed at all, which is the failure this prevents.
    const size = estimateTurnTokens(request({ situation: 'x'.repeat(300) }))
    expect(size).toBeGreaterThanOrEqual(100)
  })
})

describe('trying the next model when one will not answer', () => {
  it('moves on when a provider has hit a limit', async () => {
    const router = new Router({
      providers: [
        fakeProvider('spent', {}, async () => {
          throw new RateLimited('spent', 'requests-per-day', 60_000)
        }),
        fakeProvider('fresh'),
      ],
      routes: { understand: ['spent', 'fresh'] },
      fallback: [],
    })

    const result = await router.turn(request())
    expect(result.providerId).toBe('fresh')
  })

  it('sets a spent provider aside instead of retrying it into the ground', async () => {
    const spent = vi.fn(async (): Promise<TurnResult> => {
      throw new RateLimited('spent', 'requests-per-day', 3_600_000)
    })
    let clock = 1_000_000
    const router = new Router({
      providers: [fakeProvider('spent', {}, spent), fakeProvider('fresh')],
      routes: { understand: ['spent', 'fresh'] },
      fallback: [],
      now: () => clock,
    })

    await router.turn(request())
    expect(spent).toHaveBeenCalledTimes(1)

    // Asked again a minute later, the spent provider is not troubled at all.
    clock += 60_000
    const second = await router.turn(request())
    expect(spent).toHaveBeenCalledTimes(1)
    expect(second.providerId).toBe('fresh')
  })

  it('tries a spent provider again once its limit has reset', async () => {
    let fail = true
    const flaky = vi.fn(async (): Promise<TurnResult> => {
      if (fail) throw new RateLimited('flaky', 'requests-per-minute', 60_000)
      return { kind: 'text', text: 'back', raw: {}, usage: { inputTokens: 1, outputTokens: 1 } }
    })
    let clock = 1_000_000
    const router = new Router({
      providers: [fakeProvider('flaky', {}, flaky), fakeProvider('fresh')],
      routes: { understand: ['flaky', 'fresh'] },
      fallback: [],
      now: () => clock,
    })

    await router.turn(request())
    fail = false
    clock += 61_000
    const result = await router.turn(request())
    expect(result.providerId).toBe('flaky')
  })

  it('moves on when a provider is unavailable', async () => {
    const router = new Router({
      providers: [
        fakeProvider('broken', {}, async () => { throw new ProviderDown('broken', 503, 'unavailable') }),
        fakeProvider('working'),
      ],
      routes: { understand: ['broken', 'working'] },
      fallback: [],
    })
    expect((await router.turn(request())).providerId).toBe('working')
  })

  it('does NOT swallow a bug of our own', async () => {
    // A rate limit is expected and handled. A programming error is not, and
    // hiding it behind a retry would be worse than failing.
    const router = new Router({
      providers: [
        fakeProvider('buggy', {}, async () => { throw new TypeError('cannot read property of undefined') }),
        fakeProvider('working'),
      ],
      routes: { understand: ['buggy', 'working'] },
      fallback: [],
    })
    await expect(router.turn(request())).rejects.toBeInstanceOf(TypeError)
  })

  it('explains what it tried when nothing could answer', async () => {
    const router = new Router({
      providers: [
        fakeProvider('a', {}, async () => { throw new RateLimited('a', 'requests-per-day', 1000) }),
        fakeProvider('b', {}, async () => { throw new RateLimited('b', 'tokens-per-minute', 1000) }),
      ],
      routes: { understand: ['a', 'b'] },
      fallback: [],
    })

    try {
      await router.turn(request())
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(NoProviderAvailable)
      const message = (error as Error).message
      expect(message).toMatch(/a: rate-limited \(requests-per-day\)/)
      expect(message).toMatch(/b: rate-limited \(tokens-per-minute\)/)
      expect(message).toMatch(/a demonstration is always a real call/)
    }
  })
})

describe('the routing table', () => {
  it('uses the stage\'s own list', () => {
    const router = new Router({ providers: [], routes: { research: ['x', 'y'] }, fallback: ['z'] })
    expect(router.candidatesFor('research')).toEqual(['x', 'y'])
  })

  it('falls back for a stage with no list of its own', () => {
    const router = new Router({ providers: [], routes: {}, fallback: ['z'] })
    expect(router.candidatesFor('anything')).toEqual(['z'])
  })

  it('spends the scarce large models only where the judgement is hard', () => {
    // Twenty requests a day each on the large models against five hundred on the
    // small ones, so this allocation is a real decision rather than an accident.
    expect(DEFAULT_ROUTES['understand']?.[0]).toBe('gemini:gemini-3.5-flash')
    expect(DEFAULT_ROUTES['draft']?.[0]).toBe('gemini:gemini-3.5-flash')

    for (const stage of ['research', 'address', 'verify', 'assemble', 'publish']) {
      expect(DEFAULT_ROUTES[stage]?.[0]).toMatch(/flash-lite$/)
    }
  })

  it('gives the boundary stage no model at all, because it asks nothing', () => {
    // Stage seven has no tools and makes no judgement. The empty list says so.
    expect(DEFAULT_ROUTES['boundary']).toEqual([])
  })

  it('ignores a named model that is not configured', async () => {
    const router = new Router({
      providers: [fakeProvider('real')],
      routes: { understand: ['missing', 'real'] },
      fallback: [],
    })
    expect((await router.turn(request())).providerId).toBe('real')
  })
})
