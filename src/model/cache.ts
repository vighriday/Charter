/**
 * Record and replay — the same question in, the saved answer out, no call made.
 *
 * WHY THIS EXISTS, AND WHY IT WAS BUILT BEFORE THE AGENT
 *
 * Charter's brain is a free tier. The measured allowance is about five hundred
 * requests a day on the models that do the work. That is comfortable in total and
 * unforgiving in bursts: a debugging session that reruns one stage two hundred
 * times spends forty per cent of the day in about twenty minutes, and when a daily
 * limit runs out it does not come back until midnight Pacific time, which is the
 * middle of the afternoon here.
 *
 * A cache is exactly the right shape of fix for exactly that problem. It reads
 * like an optimisation and it is not — it is the difference between finishing and
 * running out of calls on day five.
 *
 * THREE THINGS IT BUYS BEYOND SURVIVING
 *
 *   Everything downstream of the model becomes repeatable while it is being
 *   debugged. The same input gives the same reply every time, so a bug in the
 *   document step stops being tangled up with the model changing its mind.
 *
 *   Anyone can run the whole project with no accounts and no keys. Three of the
 *   challenges this project enters require exactly that, and this is how it is
 *   actually met rather than promised.
 *
 *   Tests run against real recorded behaviour instead of behaviour we imagined. A
 *   test written against a made-up reply only proves the code agrees with our
 *   imagination.
 *
 * THE RULE THAT COMES WITH IT, AND IT IS NOT NEGOTIABLE
 *
 * Demonstration runs are always real calls. This exists to protect development,
 * never to fake a live run. A recorded run may be shown if it is clearly labelled
 * as a recorded run. It may never be presented as live.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { canonicalText, fingerprint, type JsonValue } from '../record/canonical.js'

/** How the cache behaves on a miss. */
export type CacheMode =
  /** Serve what is saved. On a miss, refuse — never reach the network. */
  | 'replay'
  /** Call for real, and save the answer for next time. */
  | 'record'
  /** Serve what is saved; call for real and save it only when nothing is saved. */
  | 'auto'
  /** Ignore the cache entirely. What a demonstration run uses. */
  | 'live'

export class CacheMissError extends Error {
  constructor(
    readonly key: string,
    readonly describe: string,
  ) {
    super(
      `Nothing saved for this request, and replay mode never reaches the network.\n\n` +
        `  ${describe}\n  key ${key}\n\n` +
        `Either record it once with REPLAY_MODE=false, or check whether something about\n` +
        `the request changed — a different model, a different tool list, or an extra\n` +
        `space in a prompt all make a different key.`,
    )
    this.name = 'CacheMissError'
  }
}

export interface CacheEntry {
  readonly v: '1'
  readonly key: string
  /** What this was a request for, in plain words, so a saved file is readable. */
  readonly describe: string
  /** When it was recorded. Not part of the key. */
  readonly recordedAt: string
  /** Exactly what came back, kept as it arrived. */
  readonly response: JsonValue
}

/**
 * Turn a request into a key.
 *
 * Uses the same canonical text form as the record, so the project has exactly one
 * way of turning data into text. Two implementations would eventually disagree,
 * and the disagreement would be silent.
 *
 * Volatile fields are removed first — anything that changes between two runs that
 * should be considered the same request. A timestamp inside a request would make
 * every request unique and the cache would never hit anything.
 */
export function cacheKey(request: unknown, ignore: readonly string[] = []): string {
  return fingerprint(stripVolatile(request, ignore))
}

function stripVolatile(value: unknown, ignore: readonly string[]): unknown {
  if (Array.isArray(value)) return value.map((v) => stripVolatile(v, ignore))
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as object)) {
      if (ignore.includes(k)) continue
      out[k] = stripVolatile(v, ignore)
    }
    return out
  }
  return value
}

export interface CacheStore {
  get(key: string): CacheEntry | undefined
  put(entry: CacheEntry): void
  has(key: string): boolean
  count(): number
}

/**
 * Saved responses as plain files on disk, one per request.
 *
 * Plain files rather than a database, deliberately. They can be committed, read in
 * a code review, and diffed when a vendor changes something. A judge can open one
 * and see exactly what a service really returned — which is the point of recording
 * real responses instead of writing imagined ones.
 */
export function fileStore(root = 'fixtures/model'): CacheStore {
  const pathFor = (key: string) => join(root, key.slice(0, 2), `${key}.json`)

  return {
    has(key) {
      return existsSync(pathFor(key))
    },
    get(key) {
      const path = pathFor(key)
      if (!existsSync(path)) return undefined
      return JSON.parse(readFileSync(path, 'utf8')) as CacheEntry
    },
    put(entry) {
      const path = pathFor(entry.key)
      mkdirSync(dirname(path), { recursive: true })
      // Written in the canonical form, so a recorded file is byte-identical no
      // matter which machine recorded it. That keeps them reviewable in a diff.
      writeFileSync(path, `${canonicalText(entry)}\n`, 'utf8')
    },
    count() {
      if (!existsSync(root)) return 0
      let n = 0
      for (const bucket of readdirSync(root)) {
        const dir = join(root, bucket)
        try {
          n += readdirSync(dir).filter((f) => f.endsWith('.json')).length
        } catch {
          // Not a directory. Skip it.
        }
      }
      return n
    },
  }
}

/** Saved responses in memory. For tests. */
export function memoryStore(): CacheStore {
  const map = new Map<string, CacheEntry>()
  return {
    has: (key) => map.has(key),
    get: (key) => map.get(key),
    put: (entry) => void map.set(entry.key, entry),
    count: () => map.size,
  }
}

export interface CacheOptions {
  readonly mode: CacheMode
  readonly store: CacheStore
  /** Fields that should not affect the key. */
  readonly ignore?: readonly string[]
  /** Reads the current time. Passed in so tests are exact. */
  readonly now?: () => Date
}

export interface CacheOutcome<T> {
  readonly value: T
  /** Where the answer came from. The activity feed shows this honestly. */
  readonly from: 'cache' | 'network'
  readonly key: string
}

/**
 * Run something through the cache.
 *
 * `call` is only ever invoked when the mode allows it AND nothing is saved. In
 * replay mode it is never invoked at all — which is what makes "runs with no keys"
 * a fact rather than a hope, since there is no path from here to the network.
 */
export async function through<T extends JsonValue>(
  request: unknown,
  describe: string,
  call: () => Promise<T>,
  options: CacheOptions,
): Promise<CacheOutcome<T>> {
  const key = cacheKey(request, options.ignore)
  const clock = options.now ?? (() => new Date())

  if (options.mode === 'live') {
    return { value: await call(), from: 'network', key }
  }

  if (options.mode !== 'record') {
    const saved = options.store.get(key)
    if (saved) {
      return { value: saved.response as T, from: 'cache', key }
    }
    if (options.mode === 'replay') {
      throw new CacheMissError(key, describe)
    }
  }

  const value = await call()
  options.store.put({
    v: '1',
    key,
    describe,
    recordedAt: clock().toISOString(),
    response: value,
  })
  return { value, from: 'network', key }
}

/**
 * Which mode the environment asks for.
 *
 * REPLAY_MODE=true is the default in the example environment file, so a fresh
 * clone runs from saved responses and reaches nothing.
 */
export function modeFromEnv(env: NodeJS.ProcessEnv = process.env): CacheMode {
  const explicit = env['CACHE_MODE']?.trim().toLowerCase()
  if (explicit === 'replay' || explicit === 'record' || explicit === 'auto' || explicit === 'live') {
    return explicit
  }
  return env['REPLAY_MODE']?.trim().toLowerCase() === 'false' ? 'auto' : 'replay'
}
