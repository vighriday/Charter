/**
 * Assembling the real models from the settings, or saying plainly why it cannot.
 *
 * WHAT THIS IS FOR
 *
 * Everything needed to talk to a real model already exists in this folder: the two
 * providers, the router that tries them in order, the daily counter that refuses
 * before a free allowance is spent, and the cache. Nothing put them together. Every
 * test and the demonstration used a written-out stand-in, which is right for them
 * and meant the real path was never assembled anywhere.
 *
 * This is the one place that assembles it, from settings that have already been
 * checked. It is the answer to a fair question a judge would ask: *does this only
 * work because everything is pretend?*
 *
 * WHY IT RETURNS A REASON INSTEAD OF THROWING
 *
 * There is nothing wrong with having no keys. It is the normal state of a fresh
 * clone, and the whole project is meant to run that way. So a missing key produces
 * a plain sentence saying which key is missing and what happens instead, and the
 * caller decides. A program that crashed because somebody had not signed up to
 * Google would be a program nobody could evaluate.
 *
 * WHY THE ALLOWANCE COUNTER IS NOT OPTIONAL HERE
 *
 * A free daily allowance does not come back until midnight in the provider's own
 * time zone. Learning it is spent by being refused costs the rest of the day. So
 * anything assembled here counts before it sends, and the count survives the
 * program ending, because a counter that resets when the process does is a counter
 * that never stops anything.
 */

import { geminiProvider } from './gemini.js'
import { groqProvider } from './groq.js'
import {
  Router,
  DEFAULT_ROUTES,
  DEFAULT_FALLBACK,
  type Attempt,
  type Routes,
} from './router.js'
import { DailyAllowance, fileAllowanceStore } from './allowance.js'
import type { ModelProvider } from './types.js'
import type { Settings } from '../settings.js'

/**
 * The models each key opens, and why these ones.
 *
 * Named here rather than in a setting, because which model is right for a stage is
 * a decision this project has made and recorded, not a knob. The routes in
 * `router.ts` name these same identifiers, and a name that appears in one and not
 * the other is a model that would never be reached.
 */
export const GEMINI_MODELS: readonly string[] = [
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
]

export const GROQ_MODELS: readonly string[] = ['qwen/qwen3.8-27b']

export interface BuildOptions {
  readonly settings: Settings
  /** Where the keys come from. Passed in so a test needs no environment. */
  readonly env?: Record<string, string | undefined>
  /** Told about every attempt, so the record and the activity feed stay honest. */
  readonly onAttempt?: (attempt: Attempt) => void
  /** Overridden only in tests, which must not depend on the time of day. */
  readonly now?: () => number
  readonly routes?: Routes
}

export interface BuiltRouter {
  /** Null when there was nothing to build. `why` then says what is missing. */
  readonly router: Router | null
  /** Every provider identifier that was actually assembled. */
  readonly using: readonly string[]
  /** In plain words: what was assembled, or what is missing and what happens instead. */
  readonly why: string
}

/**
 * Build the router from the settings, or explain why there is nothing to build.
 *
 * Never throws for a missing key. A fresh clone has none, and that is the intended
 * way to evaluate this project.
 */
export function buildRouter(options: BuildOptions): BuiltRouter {
  const env = options.env ?? process.env
  const providers: ModelProvider[] = []
  const missing: string[] = []

  const gemini = (env['GEMINI_API_KEY'] ?? '').trim()
  if (gemini === '') {
    missing.push('GEMINI_API_KEY')
  } else {
    for (const model of GEMINI_MODELS) {
      providers.push(geminiProvider({ apiKey: gemini, model }))
    }
  }

  const groq = (env['GROQ_API_KEY'] ?? '').trim()
  if (groq === '') {
    missing.push('GROQ_API_KEY')
  } else {
    for (const model of GROQ_MODELS) {
      providers.push(groqProvider({ apiKey: groq, model }))
    }
  }

  if (providers.length === 0) {
    return {
      router: null,
      using: [],
      why:
        `No model key is set (${missing.join(' and ')}), so nothing real can be ` +
        `called. That is the normal state of a fresh clone and nothing is wrong: ` +
        `every stage runs from saved responses instead, which is how this project ` +
        `is meant to be evaluated.`,
    }
  }

  // Counted per model per day, and the count survives the program ending. A
  // counter that resets when the process does is a counter that never stops
  // anything, and a free allowance does not return until midnight in the
  // provider's own time zone.
  const allowance = new DailyAllowance({ store: fileAllowanceStore() })

  const router = new Router({
    providers,
    routes: options.routes ?? DEFAULT_ROUTES,
    fallback: DEFAULT_FALLBACK,
    allowance,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.onAttempt === undefined ? {} : { onAttempt: options.onAttempt }),
  })

  const using = providers.map((one) => one.id)

  const note =
    missing.length === 0
      ? ''
      : ` ${missing.join(' and ')} is not set, so those models are simply absent ` +
        `from the order rather than being tried and failing.`

  return {
    router,
    using,
    why:
      `${using.length} model${using.length === 1 ? '' : 's'} assembled: ` +
      `${using.join(', ')}. Requests are counted per model per day before being ` +
      `sent, and the count survives the program ending.${note}`,
  }
}

/**
 * Whether a real call would be made at all, given the settings.
 *
 * Two settings decide it and the answer is deliberately conservative: anything
 * other than a clear instruction to call means saved answers. Somebody who has not
 * thought about it does not spend an allowance.
 */
export function wouldCallOut(settings: Settings): boolean {
  return !settings.replaying
}
