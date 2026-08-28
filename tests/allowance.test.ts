import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DailyAllowance,
  dayIn,
  memoryAllowanceStore,
  fileAllowanceStore,
  MEASURED_ALLOWANCES,
  type Allowance,
} from '../src/model/allowance.js'
import { Router, DEFAULT_ROUTES, DEFAULT_FALLBACK, NoProviderAvailable } from '../src/model/router.js'
import { RateLimited, type Capabilities, type ModelProvider, type TurnRequest } from '../src/model/types.js'

/**
 * The daily allowance counter.
 *
 * Charter runs on free model allowances counted per day, per model name: 500
 * requests a day on each small model, 20 a day on each large one. The allowance
 * does not return until midnight in the vendor's own time zone, so discovering it
 * is spent by getting an error in the middle of the morning costs the rest of the
 * day. This counts forward and refuses before sending instead.
 */

const TEST_ALLOWANCES: readonly Allowance[] = [
  {
    modelId: 'west:small',
    perDay: 3,
    zone: 'America/Los_Angeles',
    resetStated: true,
    source: 'invented for this test',
  },
  {
    modelId: 'utc:big',
    perDay: 2,
    zone: 'UTC',
    resetStated: false,
    source: 'invented for this test, reset time not stated by the vendor',
  },
]

const at = (iso: string) => () => new Date(iso)

describe('which day it is where the vendor is', () => {
  it('uses the vendor time zone, not ours', () => {
    // Five in the morning UTC on 28 August is still the 27th in California, and
    // already the 28th in India. Counting against the wrong one of those either
    // throws away allowance that had returned, or spends allowance that had not.
    const instant = new Date('2026-08-28T05:00:00Z')
    expect(dayIn('America/Los_Angeles', instant)).toBe('2026-08-27')
    expect(dayIn('UTC', instant)).toBe('2026-08-28')
    expect(dayIn('Asia/Kolkata', instant)).toBe('2026-08-28')
  })

  it('rolls over at the vendor midnight and not a minute before', () => {
    expect(dayIn('America/Los_Angeles', new Date('2026-08-28T06:59:59Z'))).toBe('2026-08-27')
    expect(dayIn('America/Los_Angeles', new Date('2026-08-28T07:00:00Z'))).toBe('2026-08-28')
  })

  it('gets daylight saving right, which fixed hour arithmetic cannot', () => {
    // The same clock time in UTC, six months apart. California is eight hours
    // behind in January and seven in August, so these fall on different dates
    // relative to their own midnight. Adding a fixed offset would get one wrong.
    expect(dayIn('America/Los_Angeles', new Date('2026-01-15T07:30:00Z'))).toBe('2026-01-14')
    expect(dayIn('America/Los_Angeles', new Date('2026-08-15T07:30:00Z'))).toBe('2026-08-15')
  })
})

describe('counting requests against an allowance', () => {
  const counter = (now = at('2026-08-28T18:00:00Z')) =>
    new DailyAllowance({ allowances: TEST_ALLOWANCES, store: memoryAllowanceStore(), now })

  it('allows a model that has sent nothing', () => {
    expect(counter().check('west:small')).toEqual({ allowed: true, left: 3 })
  })

  it('counts down as requests are sent', () => {
    const c = counter()
    c.spend('west:small')
    expect(c.check('west:small')).toEqual({ allowed: true, left: 2 })
    c.spend('west:small')
    c.spend('west:small')
    expect(c.check('west:small').allowed).toBe(false)
  })

  it('says why it refused, and when the allowance comes back', () => {
    const c = counter()
    for (let i = 0; i < 3; i++) c.spend('west:small')
    const verdict = c.check('west:small')
    expect(verdict.allowed).toBe(false)
    if (verdict.allowed) return
    expect(verdict.reason).toContain('all 3')
    expect(verdict.returnsAt).toBe('midnight America/Los_Angeles')
  })

  it('counts each model separately, because the vendor does', () => {
    // The reason the routing table lists several model names: each name carries
    // its own whole allowance, so adding one adds capacity.
    const c = counter()
    for (let i = 0; i < 3; i++) c.spend('west:small')
    expect(c.check('west:small').allowed).toBe(false)
    expect(c.check('utc:big').allowed).toBe(true)
  })

  it('lets a model it has never heard of through, rather than blocking it', () => {
    // A model added to the routing table but not to the allowance table must not
    // stop working. A test elsewhere in this file fails the build when the two
    // drift apart, which is where that gap belongs.
    expect(counter().check('someone:new')).toEqual({ allowed: true, left: Number.POSITIVE_INFINITY })
  })
})

describe('the day turning over', () => {
  it('starts again at the vendor midnight', () => {
    const store = memoryAllowanceStore()
    const before = new DailyAllowance({
      allowances: TEST_ALLOWANCES,
      store,
      now: at('2026-08-28T06:00:00Z'), // still the 27th in California
    })
    for (let i = 0; i < 3; i++) before.spend('west:small')
    expect(before.check('west:small').allowed).toBe(false)

    const after = new DailyAllowance({
      allowances: TEST_ALLOWANCES,
      store,
      now: at('2026-08-28T07:00:00Z'), // the 28th in California, one hour later
    })
    expect(after.check('west:small')).toEqual({ allowed: true, left: 3 })
  })

  it('does not start again at our own midnight', () => {
    const store = memoryAllowanceStore()
    const evening = new DailyAllowance({
      allowances: TEST_ALLOWANCES,
      store,
      now: at('2026-08-28T05:00:00Z'), // the 27th in California, the 28th in India
    })
    for (let i = 0; i < 3; i++) evening.spend('west:small')

    const later = new DailyAllowance({
      allowances: TEST_ALLOWANCES,
      store,
      now: at('2026-08-28T06:30:00Z'), // still the 27th in California
    })
    expect(later.check('west:small').allowed).toBe(false)
  })

  it('needs no timer or clean-up, even after nothing ran for a week', () => {
    const store = memoryAllowanceStore({
      'west:small': { day: '2026-08-01', used: 999, providerSaidSpent: true },
    })
    const c = new DailyAllowance({
      allowances: TEST_ALLOWANCES,
      store,
      now: at('2026-08-28T18:00:00Z'),
    })
    expect(c.check('west:small')).toEqual({ allowed: true, left: 3 })
  })
})

describe('when the provider says the allowance is gone', () => {
  it('is believed immediately, whatever our own count says', () => {
    // Our count only sees what this machine sent. One provider counts per
    // organisation rather than per key, so requests from anywhere else share the
    // same pool and we cannot see them.
    const c = new DailyAllowance({
      allowances: TEST_ALLOWANCES,
      store: memoryAllowanceStore(),
      now: at('2026-08-28T18:00:00Z'),
    })
    expect(c.check('west:small').allowed).toBe(true)
    c.markSpentByProvider('west:small')
    const verdict = c.check('west:small')
    expect(verdict.allowed).toBe(false)
    if (verdict.allowed) return
    expect(verdict.reason).toContain('refused by the provider')
  })

  it('still comes back the next day', () => {
    const store = memoryAllowanceStore()
    const today = new DailyAllowance({
      allowances: TEST_ALLOWANCES,
      store,
      now: at('2026-08-28T06:00:00Z'),
    })
    today.markSpentByProvider('west:small')
    const tomorrow = new DailyAllowance({
      allowances: TEST_ALLOWANCES,
      store,
      now: at('2026-08-28T07:00:00Z'),
    })
    expect(tomorrow.check('west:small').allowed).toBe(true)
  })
})

describe('the count a person actually sees', () => {
  const c = new DailyAllowance({
    allowances: TEST_ALLOWANCES,
    store: memoryAllowanceStore(),
    now: at('2026-08-28T18:00:00Z'),
  })

  it('shows every model, used and left', () => {
    c.spend('west:small')
    const report = c.report()
    expect(report).toContain('west:small')
    expect(report).toContain('2 left of 3')
    expect(report).toContain('utc:big')
  })

  it('says which reset times are the vendor\'s and which are our assumption', () => {
    // Presenting a guess as a measurement is exactly the kind of thing that
    // survives to the moment it matters.
    expect(c.report()).toContain('assumed')
    expect(c.report()).toContain('utc:big')
  })

  it('reports a model the provider refused as spent, not as having room', () => {
    const other = new DailyAllowance({
      allowances: TEST_ALLOWANCES,
      store: memoryAllowanceStore(),
      now: at('2026-08-28T18:00:00Z'),
    })
    other.markSpentByProvider('utc:big')
    expect(other.report()).toContain('the provider said so')
    expect(other.remaining().find((r) => r.modelId === 'utc:big')?.left).toBe(0)
  })
})

describe('counts that survive the process ending', () => {
  const dirs: string[] = []
  const scratch = () => {
    const dir = mkdtempSync(join(tmpdir(), 'charter-allowance-'))
    dirs.push(dir)
    return join(dir, 'allowance.json')
  }
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('remembers across two separate counters, which is the whole point', () => {
    // During development a person runs dozens of short processes in a day. A count
    // that resets with each one would count nothing at all.
    const path = scratch()
    const first = new DailyAllowance({
      allowances: TEST_ALLOWANCES,
      store: fileAllowanceStore(path),
      now: at('2026-08-28T18:00:00Z'),
    })
    first.spend('west:small')
    first.spend('west:small')

    const second = new DailyAllowance({
      allowances: TEST_ALLOWANCES,
      store: fileAllowanceStore(path),
      now: at('2026-08-28T18:00:00Z'),
    })
    expect(second.check('west:small')).toEqual({ allowed: true, left: 1 })
  })

  it('creates the folder it needs', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'charter-allowance-')), 'deep', 'allowance.json')
    dirs.push(join(path, '..', '..'))
    const c = new DailyAllowance({
      allowances: TEST_ALLOWANCES,
      store: fileAllowanceStore(path),
      now: at('2026-08-28T18:00:00Z'),
    })
    c.spend('west:small')
    expect(existsSync(path)).toBe(true)
  })

  it('starts from zero rather than crashing on a damaged file', () => {
    // A count file is a convenience. Stopping the whole program because it got
    // truncated would be a far bigger cost than one day of undercounting, and the
    // provider's own answer is still the backstop.
    const path = scratch()
    writeFileSync(path, '{ this is not json', 'utf8')
    const c = new DailyAllowance({
      allowances: TEST_ALLOWANCES,
      store: fileAllowanceStore(path),
      now: at('2026-08-28T18:00:00Z'),
    })
    expect(c.check('west:small')).toEqual({ allowed: true, left: 3 })
  })

  it('writes nothing secret', () => {
    const path = scratch()
    const c = new DailyAllowance({
      allowances: TEST_ALLOWANCES,
      store: fileAllowanceStore(path),
      now: at('2026-08-28T18:00:00Z'),
    })
    c.spend('west:small')
    const written = readFileSync(path, 'utf8')
    expect(written).toContain('west:small')
    // Eleven in the morning in California, so the vendor's day is the 28th.
    expect(written).toContain('2026-08-28')
    expect(written).not.toMatch(/key|token|secret/i)
  })
})

describe('the allowance table against the routing table', () => {
  it('has a written-down allowance for every model any stage routes to', () => {
    // The failure this prevents: a model added to the routes, used all day,
    // counted by nobody, and discovered to be spent in the middle of a
    // demonstration. Caught when the code is checked instead.
    const routed = new Set([...Object.values(DEFAULT_ROUTES).flat(), ...DEFAULT_FALLBACK])
    const counted = new Set(MEASURED_ALLOWANCES.map((a) => a.modelId))
    const missing = [...routed].filter((id) => !counted.has(id)).sort()
    expect(
      missing,
      `These models are routed to but have no daily allowance written down in ` +
        `src/model/allowance.ts, so nothing counts them. Add each one with the ` +
        `number read from the vendor's own rate-limit page.`,
    ).toEqual([])
  })

  it('says where every number came from', () => {
    for (const allowance of MEASURED_ALLOWANCES) {
      expect(allowance.source.length, `${allowance.modelId} has no source`).toBeGreaterThan(20)
    }
  })

  it('marks the one reset time the vendor does not state', () => {
    // Groq publish the number but not when the day starts. Saying so is the
    // difference between a measurement and a guess wearing its clothes.
    const groq = MEASURED_ALLOWANCES.find((a) => a.modelId.startsWith('groq:'))
    expect(groq?.resetStated).toBe(false)
    expect(groq?.source).toContain('assum')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The router honouring it
// ─────────────────────────────────────────────────────────────────────────────

function provider(id: string, behaviour?: ModelProvider['turn']): ModelProvider {
  const capabilities: Capabilities = {
    forcedToolChoice: true,
    allowedToolsServerSide: true,
    schemaWithTools: true,
    maxRequestTokens: 1_000_000,
    retainsInput: false,
    trainsOnInput: false,
  }
  return {
    id,
    capabilities,
    turn:
      behaviour ??
      (async () => ({
        kind: 'tool_call',
        name: 'ask_question',
        args: {},
        raw: { from: id },
        usage: { inputTokens: 1, outputTokens: 1 },
      })),
    extract: async () => ({ ok: true }),
  }
}

const request: TurnRequest = {
  stage: 'understand',
  sensitivity: 'public',
  situation: 'two sisters and a bakery',
  history: [],
  tools: [{ name: 'ask_question', description: 'ask one thing', parameters: { type: 'object' } }],
  toolChoice: 'required',
}

describe('the router refusing before it sends', () => {
  const routes = { understand: ['west:small', 'utc:big'] }

  it('moves to the next model once one has spent its day', async () => {
    let asked = 0
    const allowance = new DailyAllowance({
      allowances: TEST_ALLOWANCES,
      store: memoryAllowanceStore(),
      now: at('2026-08-28T18:00:00Z'),
    })
    const router = new Router({
      providers: [
        provider('west:small', async () => {
          asked++
          return { kind: 'tool_call', name: 'ask_question', args: {}, raw: {}, usage: { inputTokens: 1, outputTokens: 1 } }
        }),
        provider('utc:big'),
      ],
      routes,
      fallback: [],
      allowance,
    })

    // Three turns fit. The fourth must go elsewhere without being sent.
    for (let i = 0; i < 3; i++) {
      const result = await router.turn(request)
      expect(result.providerId).toBe('west:small')
    }
    expect(asked).toBe(3)

    const fourth = await router.turn(request)
    expect(fourth.providerId).toBe('utc:big')
    expect(asked, 'the spent model must not be asked again').toBe(3)
  })

  it('records why it skipped, so the feed and the record stay honest', async () => {
    const seen: string[] = []
    const allowance = new DailyAllowance({
      allowances: TEST_ALLOWANCES,
      store: memoryAllowanceStore({
        'west:small': { day: '2026-08-27', used: 3, providerSaidSpent: false },
      }),
      now: at('2026-08-28T06:00:00Z'), // still the 27th in California
    })
    const router = new Router({
      providers: [provider('west:small'), provider('utc:big')],
      routes,
      fallback: [],
      allowance,
      onAttempt: (a) => seen.push(`${a.providerId}:${a.outcome}`),
    })
    await router.turn(request)
    expect(seen[0]).toBe('west:small:skipped-daily-allowance')
    expect(seen[1]).toBe('utc:big:answered')
  })

  it('believes a real daily rejection and does not send to that model again', async () => {
    // The gap our own counting cannot close: requests sent from somewhere else.
    let asked = 0
    const allowance = new DailyAllowance({
      allowances: TEST_ALLOWANCES,
      store: memoryAllowanceStore(),
      now: at('2026-08-28T18:00:00Z'),
    })
    const router = new Router({
      providers: [
        provider('west:small', async () => {
          asked++
          throw new RateLimited('west:small', 'requests-per-day', 1000)
        }),
        provider('utc:big'),
      ],
      routes,
      fallback: [],
      allowance,
    })

    const first = await router.turn(request)
    expect(first.providerId).toBe('utc:big')
    expect(asked).toBe(1)

    const second = await router.turn(request)
    expect(second.providerId).toBe('utc:big')
    expect(asked, 'a model the provider called spent must not be asked again today').toBe(1)
  })

  it('does not treat a per-minute limit as the day being spent', async () => {
    // Confusing the two would throw away hundreds of requests over a pause of
    // sixty seconds.
    const allowance = new DailyAllowance({
      allowances: TEST_ALLOWANCES,
      store: memoryAllowanceStore(),
      now: at('2026-08-28T18:00:00Z'),
    })
    const router = new Router({
      providers: [
        provider('west:small', async () => {
          throw new RateLimited('west:small', 'requests-per-minute', 1000)
        }),
        provider('utc:big'),
      ],
      routes,
      fallback: [],
      allowance,
    })
    await router.turn(request)
    const verdict = allowance.check('west:small')
    expect(verdict.allowed, 'a minute limit must not spend the day').toBe(true)
  })

  it('counts a request that was sent even though it failed', async () => {
    // The provider counts a request it rejected on its own terms. Counting fewer
    // than they do is the mistake the whole file exists to avoid.
    const allowance = new DailyAllowance({
      allowances: TEST_ALLOWANCES,
      store: memoryAllowanceStore(),
      now: at('2026-08-28T18:00:00Z'),
    })
    const router = new Router({
      providers: [
        provider('west:small', async () => {
          throw new RateLimited('west:small', 'requests-per-minute', 1000)
        }),
        provider('utc:big'),
      ],
      routes,
      fallback: [],
      allowance,
    })
    await router.turn(request)
    expect(allowance.remaining().find((r) => r.modelId === 'west:small')?.used).toBe(1)
  })

  it('says plainly when every model has spent its day', async () => {
    const allowance = new DailyAllowance({
      allowances: TEST_ALLOWANCES,
      store: memoryAllowanceStore({
        'west:small': { day: '2026-08-27', used: 3, providerSaidSpent: false },
        'utc:big': { day: '2026-08-28', used: 2, providerSaidSpent: false },
      }),
      now: at('2026-08-28T06:00:00Z'),
    })
    const router = new Router({
      providers: [provider('west:small'), provider('utc:big')],
      routes,
      fallback: [],
      allowance,
    })
    await expect(router.turn(request)).rejects.toThrow(NoProviderAvailable)
  })

  it('counts nothing at all when no counter was given', async () => {
    // Tests must not depend on what time of day it is, so this is the default.
    const router = new Router({ providers: [provider('west:small')], routes, fallback: [] })
    for (let i = 0; i < 10; i++) {
      const result = await router.turn(request)
      expect(result.providerId).toBe('west:small')
    }
  })
})
