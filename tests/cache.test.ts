import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  through,
  cacheKey,
  memoryStore,
  fileStore,
  modeFromEnv,
  CacheMissError,
  type CacheStore,
} from '../src/model/cache.js'

let store: CacheStore
const at = () => new Date('2026-08-27T09:00:00.000Z')

beforeEach(() => {
  store = memoryStore()
})

const request = { model: 'gemini-2.5-flash-lite', prompt: 'who owns the bakery?', tools: ['ask'] }

describe('the key', () => {
  it('does not change when fields are written in a different order', () => {
    expect(cacheKey({ a: 1, b: 2 })).toBe(cacheKey({ b: 2, a: 1 }))
  })

  it('changes when anything about the request changes', () => {
    const base = cacheKey(request)
    expect(cacheKey({ ...request, model: 'gemini-3.5-flash-lite' })).not.toBe(base)
    expect(cacheKey({ ...request, prompt: 'who owns the bakery? ' })).not.toBe(base)
    expect(cacheKey({ ...request, tools: ['ask', 'answer'] })).not.toBe(base)
  })

  it('ignores fields that would make every request unique', () => {
    // A timestamp inside a request would mean the cache never hit anything.
    const a = { ...request, sentAt: '2026-08-27T09:00:00.000Z' }
    const b = { ...request, sentAt: '2026-08-27T11:30:00.000Z' }
    expect(cacheKey(a, ['sentAt'])).toBe(cacheKey(b, ['sentAt']))
    expect(cacheKey(a)).not.toBe(cacheKey(b))
  })

  it('ignores those fields at any depth', () => {
    const a = { outer: { inner: { keep: 1, sentAt: 'x' } } }
    const b = { outer: { inner: { keep: 1, sentAt: 'y' } } }
    expect(cacheKey(a, ['sentAt'])).toBe(cacheKey(b, ['sentAt']))
  })
})

describe('replay mode — the one that must never reach the network', () => {
  it('serves what is saved and makes no call', async () => {
    let calls = 0
    await through(request, 'first turn', async () => { calls++; return { text: 'saved' } }, {
      mode: 'record', store, now: at,
    })
    expect(calls).toBe(1)

    const again = await through(request, 'first turn', async () => { calls++; return { text: 'live' } }, {
      mode: 'replay', store, now: at,
    })

    expect(again.value).toEqual({ text: 'saved' })
    expect(again.from).toBe('cache')
    expect(calls).toBe(1)
  })

  it('refuses on a miss rather than quietly reaching out', async () => {
    // This is the property that makes "runs with no keys at all" true rather than
    // hoped for: in replay mode there is no path from here to the network.
    let called = false
    await expect(
      through(request, 'a turn nobody recorded', async () => { called = true; return { x: 1 } }, {
        mode: 'replay', store, now: at,
      }),
    ).rejects.toBeInstanceOf(CacheMissError)
    expect(called).toBe(false)
  })

  it('says something useful when it misses', async () => {
    try {
      await through(request, 'stage 1, first turn', async () => ({ x: 1 }), {
        mode: 'replay', store, now: at,
      })
      expect.unreachable()
    } catch (error) {
      const message = (error as Error).message
      expect(message).toMatch(/stage 1, first turn/)
      expect(message).toMatch(/REPLAY_MODE=false/)
      expect(message).toMatch(/a different model, a different tool list/)
    }
  })
})

describe('the other modes', () => {
  it('record always calls, and overwrites what was saved', async () => {
    let n = 0
    for (const expected of [1, 2, 3]) {
      const result = await through(request, 'turn', async () => ({ n: ++n }), {
        mode: 'record', store, now: at,
      })
      expect(result.from).toBe('network')
      expect(result.value).toEqual({ n: expected })
    }
    expect(store.count()).toBe(1)
  })

  it('auto calls once, then serves the saved answer', async () => {
    let calls = 0
    const options = { mode: 'auto' as const, store, now: at }

    const first = await through(request, 'turn', async () => { calls++; return { text: 'real' } }, options)
    const second = await through(request, 'turn', async () => { calls++; return { text: 'real' } }, options)

    expect(first.from).toBe('network')
    expect(second.from).toBe('cache')
    expect(calls).toBe(1)
  })

  it('live ignores the cache entirely — what a demonstration uses', async () => {
    let calls = 0
    await through(request, 'turn', async () => { calls++; return { n: calls } }, { mode: 'record', store, now: at })

    const result = await through(request, 'turn', async () => { calls++; return { n: calls } }, {
      mode: 'live', store, now: at,
    })

    // The rule: a demonstration run is always a real call. The cache protects
    // development; it never fakes a live run.
    expect(result.from).toBe('network')
    expect(calls).toBe(2)
  })

  it('live does not save, so a demonstration cannot pollute the recordings', async () => {
    await through(request, 'turn', async () => ({ x: 1 }), { mode: 'live', store, now: at })
    expect(store.count()).toBe(0)
  })
})

describe('what the caller is told', () => {
  it('says where the answer came from, so the activity feed can be honest', async () => {
    const recorded = await through(request, 'turn', async () => ({ x: 1 }), { mode: 'record', store, now: at })
    const replayed = await through(request, 'turn', async () => ({ x: 2 }), { mode: 'replay', store, now: at })

    expect(recorded.from).toBe('network')
    expect(replayed.from).toBe('cache')
    expect(recorded.key).toBe(replayed.key)
  })
})

describe('saved files on disk', () => {
  const root = join('tmp', 'cache-test')
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('writes something a person can open and read', async () => {
    rmSync(root, { recursive: true, force: true })
    const disk = fileStore(root)

    const result = await through(request, 'the first turn of stage one', async () => ({ tool: 'ask_question' }), {
      mode: 'record', store: disk, now: at,
    })

    const path = join(root, result.key.slice(0, 2), `${result.key}.json`)
    expect(existsSync(path)).toBe(true)

    const saved = JSON.parse(readFileSync(path, 'utf8'))
    expect(saved.describe).toBe('the first turn of stage one')
    expect(saved.response).toEqual({ tool: 'ask_question' })
    expect(saved.recordedAt).toBe('2026-08-27T09:00:00.000Z')
  })

  it('writes the same bytes on any machine, so recordings stay reviewable in a diff', async () => {
    rmSync(root, { recursive: true, force: true })
    const disk = fileStore(root)
    const result = await through(request, 'turn', async () => ({ b: 2, a: 1 }), {
      mode: 'record', store: disk, now: at,
    })
    const path = join(root, result.key.slice(0, 2), `${result.key}.json`)
    const text = readFileSync(path, 'utf8')

    // Canonical form: keys sorted, no incidental whitespace.
    expect(text).toContain('"response":{"a":1,"b":2}')
  })

  it('reads back what it wrote', async () => {
    rmSync(root, { recursive: true, force: true })
    const disk = fileStore(root)
    await through(request, 'turn', async () => ({ deep: { nested: [1, 2, 3] } }), {
      mode: 'record', store: disk, now: at,
    })

    let called = false
    const again = await through(request, 'turn', async () => { called = true; return {} }, {
      mode: 'replay', store: disk, now: at,
    })

    expect(called).toBe(false)
    expect(again.value).toEqual({ deep: { nested: [1, 2, 3] } })
    expect(disk.count()).toBe(1)
  })
})

describe('choosing the mode from the environment', () => {
  it('defaults to replay, so a fresh clone reaches nothing', () => {
    expect(modeFromEnv({})).toBe('replay')
    expect(modeFromEnv({ REPLAY_MODE: 'true' })).toBe('replay')
  })

  it('switches to auto when replay is turned off', () => {
    expect(modeFromEnv({ REPLAY_MODE: 'false' })).toBe('auto')
  })

  it('lets the mode be named outright', () => {
    expect(modeFromEnv({ CACHE_MODE: 'live' })).toBe('live')
    expect(modeFromEnv({ CACHE_MODE: 'record' })).toBe('record')
    // An explicit mode wins over the older switch.
    expect(modeFromEnv({ CACHE_MODE: 'live', REPLAY_MODE: 'true' })).toBe('live')
  })

  it('ignores a mode it does not recognise', () => {
    expect(modeFromEnv({ CACHE_MODE: 'nonsense' })).toBe('replay')
  })
})
