/**
 * How many requests each model has left today.
 *
 * THE PROBLEM THIS SOLVES
 *
 * Charter runs on free model allowances, and those allowances are counted **per
 * day, per model name**. The main provider gives 500 requests a day on each small
 * model and only 20 a day on each large one. One complete Charter run is twenty to
 * sixty turns, so a large model cannot even finish a single run.
 *
 * Without a counter, the way you learn the allowance is spent is by getting an
 * error in the middle of something. The allowance does not come back until
 * midnight in the vendor's own time zone, so a mistake at ten in the morning costs
 * the rest of the day. On a project with a fixed deadline that is the single most
 * expensive kind of surprise, and it is entirely avoidable: the number of requests
 * sent is something we can simply count.
 *
 * So this counts forward and refuses before sending, rather than reacting after a
 * rejection.
 *
 * WHAT IT CAN AND CANNOT KNOW, STATED PLAINLY
 *
 * It counts what THIS installation has sent. It cannot see requests sent from
 * another machine, by another person, or by a script somebody ran last night, and
 * with one provider the allowance is counted per organisation rather than per key,
 * so those really do share a pool.
 *
 * That means its count can be lower than the truth, never higher. Two things
 * close the gap:
 *
 *   1. When the provider itself says the daily allowance is spent, that model is
 *      marked spent for the rest of its day immediately. One real rejection is
 *      worth more than any amount of counting, and it is not ignored.
 *   2. The count is shown rather than hidden, so a number that looks wrong can be
 *      noticed by a person.
 *
 * It is a guard rail, not a contract, and the code says so where it matters.
 *
 * WHERE THE DAY BOUNDARY IS, AND WHY THAT IS NOT OBVIOUS
 *
 * "Per day" means the vendor's day, not ours. The main provider resets at midnight
 * Pacific time, which is the middle of the working day in India, where this is
 * being built. Getting that wrong by one time zone means either throwing away
 * hours of allowance that had already returned, or believing in allowance that has
 * not.
 *
 * Each allowance therefore names its own time zone, and the day is worked out with
 * the time zone rules built into the language rather than by adding hours. Those
 * rules already know about daylight saving; hand-written hour arithmetic does not,
 * and would be quietly wrong for part of the year.
 *
 * Where a vendor does not state its reset time, that is recorded as an assumption
 * rather than dressed up as a fact, and the report says which is which.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'

// ─────────────────────────────────────────────────────────────────────────────
// What a model is allowed
// ─────────────────────────────────────────────────────────────────────────────

export interface Allowance {
  /** Written as provider:model, matching the provider identifiers everywhere else. */
  readonly modelId: string
  /** Requests permitted in one of the vendor's days. */
  readonly perDay: number
  /** The time zone whose midnight begins a new allowance. */
  readonly zone: string
  /**
   * True when the vendor states the reset time. False when we assumed it, in
   * which case the report says so rather than presenting a guess as measured.
   */
  readonly resetStated: boolean
  /** Where the number came from, so nobody has to go and find out again. */
  readonly source: string
}

/**
 * The allowances, as measured on this project rather than as advertised.
 *
 * The main provider does not publish these anywhere. They are visible only after
 * signing in, on the rate-limit page, and they change without notice. The numbers
 * below were read there on 26 August 2026.
 *
 * A test requires that every model named in the routing table appears here, so the
 * two cannot drift apart. A model routed to but not counted would be exactly the
 * surprise this file exists to prevent.
 */
export const MEASURED_ALLOWANCES: readonly Allowance[] = [
  // The workhorses. Nearly every turn goes to one of these.
  {
    modelId: 'gemini:gemini-3.5-flash-lite',
    perDay: 500,
    zone: 'America/Los_Angeles',
    resetStated: true,
    source: 'aistudio.google.com/rate-limit, signed in, read 26 August 2026',
  },
  {
    modelId: 'gemini:gemini-3.1-flash-lite',
    perDay: 500,
    zone: 'America/Los_Angeles',
    resetStated: true,
    source: 'aistudio.google.com/rate-limit, signed in, read 26 August 2026',
  },
  // The scarce reserve. Twenty a day each, spent only on the hardest judgements.
  {
    modelId: 'gemini:gemini-3.5-flash',
    perDay: 20,
    zone: 'America/Los_Angeles',
    resetStated: true,
    source: 'aistudio.google.com/rate-limit, signed in, read 26 August 2026',
  },
  {
    modelId: 'gemini:gemini-3-flash',
    perDay: 20,
    zone: 'America/Los_Angeles',
    resetStated: true,
    source: 'aistudio.google.com/rate-limit, signed in, read 26 August 2026',
  },
  {
    modelId: 'gemini:gemini-2.5-flash',
    perDay: 20,
    zone: 'America/Los_Angeles',
    resetStated: true,
    source: 'aistudio.google.com/rate-limit, signed in, read 26 August 2026',
  },
  // The fallback, and the only provider a person's details may reach.
  {
    modelId: 'groq:qwen/qwen3.8-27b',
    perDay: 1000,
    zone: 'UTC',
    resetStated: false,
    source:
      'console.groq.com published limits: 1,000 requests a day, counted per ' +
      'organisation rather than per key. Their documentation does not say when the ' +
      'day starts, so midnight UTC is assumed here and marked as an assumption.',
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Which day it is, where the vendor is
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The date in a given time zone, written as `2026-08-28`.
 *
 * Uses the language's own time zone database, which already knows when daylight
 * saving starts and ends in each place. Adding a fixed number of hours instead
 * would be wrong for several months of the year, and wrong in the direction that
 * silently hands back allowance that has not returned.
 */
export function dayIn(zone: string, at: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
  // 'en-CA' formats as 2026-08-28 already, which is the form we want to store.
  return parts
}

// ─────────────────────────────────────────────────────────────────────────────
// Where the counts are kept
// ─────────────────────────────────────────────────────────────────────────────

/** One model's position within one of the vendor's days. */
export interface Counted {
  readonly day: string
  readonly used: number
  /** Set when the provider itself said the daily allowance is spent. */
  readonly providerSaidSpent: boolean
}

export type CountedState = Record<string, Counted>

/**
 * Somewhere to keep the counts between runs.
 *
 * It must survive the process ending, because during development a person runs
 * dozens of short processes in a day and a count that resets with each one would
 * count nothing.
 */
export interface AllowanceStore {
  read(): CountedState
  write(state: CountedState): void
}

/** Counts kept only in memory. Used by tests, and by anything short-lived. */
export function memoryAllowanceStore(initial: CountedState = {}): AllowanceStore {
  let state: CountedState = { ...initial }
  return {
    read: () => ({ ...state }),
    write: (next) => {
      state = { ...next }
    },
  }
}

/**
 * Counts kept in a file, so they survive the process ending.
 *
 * The file lives in the local cache folder, which is never committed. It holds no
 * secrets — only model names, dates and numbers.
 *
 * **One honest limit.** Two processes writing at the same instant can lose a
 * count, because each reads, changes and writes the whole file. The consequence is
 * an undercount, which is the direction that matters, so it is not left at that:
 * a real rejection from the provider marks the model spent regardless of what the
 * file says. Proper locking would be the wrong trade here — it would add a failure
 * mode of its own to a guard rail whose backstop is the provider's own answer.
 */
export function fileAllowanceStore(path = '.charter-cache/allowance.json'): AllowanceStore {
  return {
    read(): CountedState {
      if (!existsSync(path)) return {}
      try {
        const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
        return parsed as CountedState
      } catch {
        // A damaged count file is not worth stopping for. Starting from zero
        // undercounts for one day, and the provider's own answer still binds.
        return {}
      }
    },
    write(state: CountedState): void {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The counter
// ─────────────────────────────────────────────────────────────────────────────

/** What is left for one model, today. */
export interface Remaining {
  readonly modelId: string
  /** The vendor's day this count belongs to. */
  readonly day: string
  readonly used: number
  readonly perDay: number
  readonly left: number
  readonly providerSaidSpent: boolean
}

export type Verdict =
  | { readonly allowed: true; readonly left: number }
  | { readonly allowed: false; readonly reason: string; readonly returnsAt: string }

export interface AllowanceOptions {
  readonly allowances?: readonly Allowance[]
  readonly store?: AllowanceStore
  /** Reads the current time. Passed in so tests are exact. */
  readonly now?: () => Date
}

export class DailyAllowance {
  private readonly byId: Map<string, Allowance>
  private readonly store: AllowanceStore
  private readonly now: () => Date

  constructor(options: AllowanceOptions = {}) {
    this.byId = new Map((options.allowances ?? MEASURED_ALLOWANCES).map((a) => [a.modelId, a]))
    this.store = options.store ?? memoryAllowanceStore()
    this.now = options.now ?? (() => new Date())
  }

  /** Every model we have an allowance for, whether or not it has been used. */
  known(): string[] {
    return [...this.byId.keys()].sort()
  }

  /**
   * May this model be asked for one more request today?
   *
   * A model with no written-down allowance is permitted, and reported as
   * uncounted. Refusing it would mean a model added to the routing table stops
   * working until somebody remembers this file — a failure that looks like a bug
   * in the router. Instead a test requires every routed model to appear here, so
   * the gap is caught when the code is checked rather than while it is running.
   */
  check(modelId: string): Verdict {
    const allowance = this.byId.get(modelId)
    if (allowance === undefined) return { allowed: true, left: Number.POSITIVE_INFINITY }

    const state = this.positionOf(modelId, allowance)

    if (state.providerSaidSpent) {
      return {
        allowed: false,
        reason:
          `${modelId} was refused by the provider today for having spent its daily ` +
          `allowance. Counting our own requests cannot see what was sent from ` +
          `elsewhere, so the provider's own answer is taken as final.`,
        returnsAt: this.returnsAt(allowance),
      }
    }

    if (state.used >= allowance.perDay) {
      return {
        allowed: false,
        reason:
          `${modelId} has used all ${allowance.perDay} of its requests for today. ` +
          `Allowance is counted per model name, so another model in the routing ` +
          `table still has its own.`,
        returnsAt: this.returnsAt(allowance),
      }
    }

    return { allowed: true, left: allowance.perDay - state.used }
  }

  /**
   * Count one request against a model.
   *
   * Called when a request is actually sent, not when one succeeds. A request the
   * provider rejected on its own terms has usually still been counted by them, and
   * counting fewer than they do is the mistake this whole file exists to avoid.
   */
  spend(modelId: string): void {
    const allowance = this.byId.get(modelId)
    if (allowance === undefined) return

    const all = this.store.read()
    const state = this.positionOf(modelId, allowance, all)
    all[modelId] = { ...state, used: state.used + 1 }
    this.store.write(all)
  }

  /**
   * The provider says this model's daily allowance is gone.
   *
   * Believed immediately and completely, whatever our own count says. It is the
   * one piece of information here that comes from the side that actually decides.
   */
  markSpentByProvider(modelId: string): void {
    const allowance = this.byId.get(modelId)
    if (allowance === undefined) return

    const all = this.store.read()
    const state = this.positionOf(modelId, allowance, all)
    all[modelId] = { ...state, providerSaidSpent: true }
    this.store.write(all)
  }

  /** Where every model stands today, for the screen and for the record. */
  remaining(): Remaining[] {
    const all = this.store.read()
    return [...this.byId.values()]
      .map((allowance) => {
        const state = this.positionOf(allowance.modelId, allowance, all)
        return {
          modelId: allowance.modelId,
          day: state.day,
          used: state.used,
          perDay: allowance.perDay,
          left: state.providerSaidSpent ? 0 : Math.max(0, allowance.perDay - state.used),
          providerSaidSpent: state.providerSaidSpent,
        }
      })
      .sort((a, b) => a.modelId.localeCompare(b.modelId))
  }

  /**
   * The count, written for a person to read while working.
   *
   * This is the whole point of the exercise. A number nobody sees prevents nothing.
   */
  report(): string {
    const rows = this.remaining()
    const width = Math.max(...rows.map((r) => r.modelId.length), 5)
    const lines = rows.map((row) => {
      const spent = row.providerSaidSpent
        ? 'spent — the provider said so'
        : `${row.left} left of ${row.perDay}`
      return `  ${row.modelId.padEnd(width)}  ${spent}  returns ${this.returnsOf(row.modelId)}`
    })
    const assumed = [...this.byId.values()].filter((a) => !a.resetStated)
    const footnote =
      assumed.length === 0
        ? ''
        : `\n  Reset time assumed rather than stated for: ` +
          `${assumed.map((a) => a.modelId).join(', ')}.`
    return `Today's model allowance\n${lines.join('\n')}${footnote}`
  }

  /** The same, looked up by name, for the report. */
  private returnsOf(modelId: string): string {
    const allowance = this.byId.get(modelId)
    return allowance === undefined ? 'unknown' : this.returnsAt(allowance)
  }

  /** When this model's allowance comes back, said the way a person would say it. */
  private returnsAt(allowance: Allowance): string {
    const stated = allowance.resetStated ? '' : ' (assumed)'
    return `midnight ${allowance.zone}${stated}`
  }

  /**
   * This model's position within the vendor's current day.
   *
   * A stored count belonging to an earlier day is not carried forward. That is the
   * reset: it needs no timer, no background task and no clean-up, and it is
   * correct even if nothing ran for a week.
   */
  private positionOf(modelId: string, allowance: Allowance, all?: CountedState): Counted {
    const state = (all ?? this.store.read())[modelId]
    const today = dayIn(allowance.zone, this.now())
    if (state === undefined || state.day !== today) {
      return { day: today, used: 0, providerSaidSpent: false }
    }
    return state
  }
}
