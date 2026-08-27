/**
 * Choosing which model gets a request, and what happens when one refuses.
 *
 * This sits above the providers. Everything that is a rule rather than a detail of
 * one vendor's web interface lives here, so it is enforced identically no matter
 * which model answers.
 *
 * FOUR RULES, IN THIS ORDER
 *
 *   1. A request carrying a person's details may only go to a provider that keeps
 *      nothing and learns nothing. Enforced by filtering the candidates, not by
 *      asking the caller to be careful.
 *
 *   2. A request over the size ceiling fails here, locally, before anything is
 *      sent. See MAX_REQUEST_TOKENS for why that number is what makes a second
 *      provider usable at all.
 *
 *   3. Each stage has an ordered list of models. The first healthy one answers.
 *      Because the free allowance is counted separately per model name, this list
 *      is at once how providers are swapped and how the daily ceiling is
 *      multiplied.
 *
 *   4. A provider that has hit a limit is skipped until its limit resets, rather
 *      than being retried into the ground.
 *
 * WHY THE ROUTES ARE A TABLE AND NOT CODE
 *
 * The measured allowance is lopsided: the large models permit twenty requests a
 * day each, the small ones five hundred. One complete run is twenty to sixty
 * turns, so a large model cannot finish even one. Nearly every turn goes to a
 * small model, and the sixty large-model requests a day are a reserve spent on the
 * two genuinely hard judgements. Which turns may spend that reserve is a real
 * decision, and it belongs somewhere it can be seen and changed rather than buried.
 */

import {
  ContextTooLarge,
  MAX_REQUEST_TOKENS,
  ProviderDown,
  RateLimited,
  SensitivityRefusal,
  estimateTokens,
  estimateTurnTokens,
  type ExtractRequest,
  type ModelProvider,
  type TurnRequest,
  type TurnResult,
} from './types.js'
import type { JsonValue } from '../record/canonical.js'

/** Which models a stage may use, in the order they should be tried. */
export type Routes = Readonly<Record<string, readonly string[]>>

export interface RouterOptions {
  readonly providers: readonly ModelProvider[]
  readonly routes: Routes
  /** Used when a stage names no route of its own. */
  readonly fallback: readonly string[]
  /** Reads the current time. Passed in so tests are exact. */
  readonly now?: () => number
  /** Told about every attempt, so the record and the activity feed stay honest. */
  readonly onAttempt?: (attempt: Attempt) => void
}

export interface Attempt {
  readonly providerId: string
  readonly outcome: 'answered' | 'rate-limited' | 'unavailable' | 'skipped-sensitivity' | 'skipped-cooling'
  readonly detail?: string
}

export class NoProviderAvailable extends Error {
  constructor(
    readonly stage: string,
    readonly attempts: readonly Attempt[],
  ) {
    const summary = attempts.map((a) => `${a.providerId}: ${a.outcome}${a.detail ? ` (${a.detail})` : ''}`)
    super(
      `no model could answer for stage "${stage}".\n` +
        summary.map((s) => `  ${s}`).join('\n') +
        `\n\nIf every provider is rate-limited, the daily allowance is spent and returns at ` +
        `midnight Pacific time. Recorded responses can carry development in the meantime; a ` +
        `demonstration cannot, because a demonstration is always a real call.`,
    )
    this.name = 'NoProviderAvailable'
  }
}

/**
 * May this provider receive this request?
 *
 * Written as its own function so the rule can be read, tested and pointed at,
 * rather than being a condition buried in a loop.
 */
export function mayReceive(
  provider: ModelProvider,
  sensitivity: 'public' | 'personal',
): { allowed: true } | { allowed: false; reason: string } {
  if (sensitivity !== 'personal') return { allowed: true }

  const { retainsInput, trainsOnInput } = provider.capabilities
  if (trainsOnInput) {
    return { allowed: false, reason: 'it learns from what it is sent' }
  }
  if (retainsInput) {
    return { allowed: false, reason: 'it keeps what it is sent' }
  }
  return { allowed: true }
}

export class Router {
  private readonly byId: Map<string, ModelProvider>
  private readonly coolingUntil = new Map<string, number>()
  private readonly now: () => number

  constructor(private readonly options: RouterOptions) {
    this.byId = new Map(options.providers.map((p) => [p.id, p]))
    this.now = options.now ?? Date.now
  }

  /** Which models this stage may use, in order. */
  candidatesFor(stage: string): string[] {
    return [...(this.options.routes[stage] ?? this.options.fallback)]
  }

  private cooling(id: string): boolean {
    const until = this.coolingUntil.get(id)
    return until !== undefined && until > this.now()
  }

  /**
   * Ask for one turn.
   *
   * Tries each model for the stage in order. A model that has hit a limit is set
   * aside until it resets rather than retried — retrying into a spent daily
   * allowance only wastes the time we could have spent on the next provider.
   */
  async turn(request: TurnRequest): Promise<TurnResult & { providerId: string }> {
    const ceiling = request.maxInputTokens ?? MAX_REQUEST_TOKENS
    const size = estimateTurnTokens(request)

    const attempts: Attempt[] = []
    const record = (attempt: Attempt) => {
      attempts.push(attempt)
      this.options.onAttempt?.(attempt)
    }

    for (const id of this.candidatesFor(request.stage)) {
      const provider = this.byId.get(id)
      if (!provider) continue

      const permission = mayReceive(provider, request.sensitivity)
      if (!permission.allowed) {
        record({ providerId: id, outcome: 'skipped-sensitivity', detail: permission.reason })
        continue
      }

      if (this.cooling(id)) {
        record({ providerId: id, outcome: 'skipped-cooling' })
        continue
      }

      // Checked per provider, because their own limits differ and the smaller of
      // the two is what actually binds.
      const limit = Math.min(ceiling, provider.capabilities.maxRequestTokens)
      if (size > limit) {
        throw new ContextTooLarge(id, size, limit)
      }

      try {
        const result = await provider.turn(request)
        record({ providerId: id, outcome: 'answered' })
        return { ...result, providerId: id }
      } catch (error) {
        if (error instanceof RateLimited) {
          this.coolingUntil.set(id, this.now() + (error.retryAfterMs ?? 60_000))
          record({ providerId: id, outcome: 'rate-limited', detail: error.scope })
          continue
        }
        if (error instanceof ProviderDown) {
          this.coolingUntil.set(id, this.now() + 30_000)
          record({ providerId: id, outcome: 'unavailable', detail: error.message })
          continue
        }
        // Anything else is our own bug, and hiding it behind a retry would be
        // worse than failing.
        throw error
      }
    }

    throw new NoProviderAvailable(request.stage, attempts)
  }

  /** Ask for data in a given shape. Same rules, same order. */
  async extract(stage: string, request: ExtractRequest): Promise<JsonValue> {
    const ceiling = request.maxInputTokens ?? MAX_REQUEST_TOKENS
    const size = estimateTokens(request.text) + estimateTokens(JSON.stringify(request.schema))

    const attempts: Attempt[] = []
    const record = (attempt: Attempt) => {
      attempts.push(attempt)
      this.options.onAttempt?.(attempt)
    }

    for (const id of this.candidatesFor(stage)) {
      const provider = this.byId.get(id)
      if (!provider) continue

      const permission = mayReceive(provider, request.sensitivity)
      if (!permission.allowed) {
        record({ providerId: id, outcome: 'skipped-sensitivity', detail: permission.reason })
        continue
      }
      if (this.cooling(id)) {
        record({ providerId: id, outcome: 'skipped-cooling' })
        continue
      }

      const limit = Math.min(ceiling, provider.capabilities.maxRequestTokens)
      if (size > limit) throw new ContextTooLarge(id, size, limit)

      try {
        const value = await provider.extract(request)
        record({ providerId: id, outcome: 'answered' })
        return value
      } catch (error) {
        if (error instanceof RateLimited) {
          this.coolingUntil.set(id, this.now() + (error.retryAfterMs ?? 60_000))
          record({ providerId: id, outcome: 'rate-limited', detail: error.scope })
          continue
        }
        if (error instanceof ProviderDown) {
          this.coolingUntil.set(id, this.now() + 30_000)
          record({ providerId: id, outcome: 'unavailable', detail: error.message })
          continue
        }
        throw error
      }
    }

    throw new NoProviderAvailable(stage, attempts)
  }

  /**
   * Refuse outright, for a request that must never reach any model.
   *
   * Used when the only providers a sensitive request could reach are ineligible.
   * The refusal is a first-class outcome: it goes in the record and is printed in
   * the finished packet under "What this system would not do".
   */
  refuse(providerId: string, reason: string): never {
    throw new SensitivityRefusal(providerId, reason)
  }
}

/**
 * The routes, as measured.
 *
 * Sixty large-model requests a day in total, so they are spent only where the
 * judgement is genuinely hard: turning messy human speech into typed fields, and
 * choosing which branches of the agreement apply. Everything else runs on the
 * small models, which allow five hundred a day each.
 */
export const DEFAULT_ROUTES: Routes = {
  // Messy speech into typed fields. The hardest thing asked of the model.
  understand: ['gemini:gemini-3.5-flash', 'gemini:gemini-3.5-flash-lite', 'groq:qwen/qwen3.8-27b'],
  // Choosing which parts of the agreement apply.
  draft: ['gemini:gemini-3.5-flash', 'gemini:gemini-3.1-flash-lite', 'groq:qwen/qwen3.8-27b'],

  // Everything else is routine.
  research: ['gemini:gemini-3.5-flash-lite', 'gemini:gemini-3.1-flash-lite'],
  address: ['gemini:gemini-3.5-flash-lite', 'gemini:gemini-3.1-flash-lite'],
  verify: ['gemini:gemini-3.5-flash-lite', 'gemini:gemini-3.1-flash-lite'],
  assemble: ['gemini:gemini-3.1-flash-lite', 'gemini:gemini-3.5-flash-lite'],
  publish: ['gemini:gemini-3.1-flash-lite', 'gemini:gemini-3.5-flash-lite'],

  // Stage seven has no tools and asks the model nothing. It is here to say so.
  boundary: [],
}

export const DEFAULT_FALLBACK: readonly string[] = [
  'gemini:gemini-3.5-flash-lite',
  'gemini:gemini-3.1-flash-lite',
  'groq:qwen/qwen3.8-27b',
]
