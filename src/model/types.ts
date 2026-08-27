/**
 * Talking to a language model, without the rest of the code knowing which one.
 *
 * TWO VERBS, NEVER COMBINED
 *
 *   turn     "given this situation and these tools, choose one tool and fill it in"
 *   extract  "given this text and this shape, return data in exactly that shape"
 *
 * They are separate on purpose. One provider's documentation states plainly that
 * forcing a shape and offering tools cannot be done in the same request. Splitting
 * the two verbs means that restriction never appears anywhere in our code, and
 * every provider behaves identically from the outside.
 *
 * It also matches how the stage machine already thinks: a turn either chooses an
 * action or reads a document. Never both.
 *
 * WHY WE CALL THE PLAIN WEB ENDPOINT AND INSTALL NOBODY'S SOFTWARE KIT
 *
 * About eighty lines per provider. No hidden session state, no dependency, and
 * swapping providers stays genuinely trivial. There is also a live, acknowledged
 * bug in one vendor's own kit where tools from one call leak into the next —
 * avoided entirely by not using it.
 */

import type { JsonObject, JsonValue } from '../record/canonical.js'

/** A tool the model may choose. Rebuilt for every single request, never cached. */
export interface ToolSpec {
  readonly name: string
  readonly description: string
  /** A JSON Schema for the arguments. Kept flat and small on purpose. */
  readonly parameters: JsonObject
}

/**
 * Whether a request carries a real person's details.
 *
 * This is a gate, not a label. The router filters providers by it in code: a
 * request marked `personal` may only go to a provider that keeps nothing and
 * trains on nothing.
 *
 * Our main provider's free tier trains on what it is sent, and its terms warn
 * outright against sending personal information. Marking a request `personal`
 * therefore makes that provider structurally ineligible — not discouraged, not
 * a convention someone has to remember. There is a test next to the rule.
 *
 * The correct number of `personal` model turns in Charter is probably zero: the
 * decision to send a document to a human reviewer is a fixed comparison against a
 * confidence score, which needs no model at all. The gate exists so that it stays
 * zero by construction rather than by memory.
 */
export type Sensitivity = 'public' | 'personal'

export interface TurnRequest {
  readonly stage: string
  readonly sensitivity: Sensitivity
  /** What the model is being asked to act on. */
  readonly situation: string
  /** Earlier turns, kept exactly as they arrived. See `raw` below. */
  readonly history: readonly JsonValue[]
  /** Only this stage's tools. The others are absent, not forbidden. */
  readonly tools: readonly ToolSpec[]
  /**
   * `required` — must choose a tool. Every acting stage.
   * `auto`     — may decline. ONLY the stage that must be able to say
   *              "there is nothing left to do"; forcing a call there makes the
   *              model invent something to call instead.
   */
  readonly toolChoice: 'required' | 'auto'
  /** Hard ceiling. See `MAX_REQUEST_TOKENS`. */
  readonly maxInputTokens?: number
}

export interface Usage {
  readonly inputTokens: number
  readonly outputTokens: number
}

export type TurnResult =
  | {
      readonly kind: 'tool_call'
      readonly name: string
      readonly args: JsonObject
      /**
       * The provider's reply, exactly as it arrived.
       *
       * Never summarised into our own shape. Newer models require their private
       * reasoning sections to be sent back byte for byte on the next request, and
       * a normalised log destroys them silently — the model appears to get worse
       * for no reason anyone can find. Keeping the original also happens to be
       * what the tamper-evident record wants, so one decision serves both.
       */
      readonly raw: JsonValue
      readonly usage: Usage
    }
  | { readonly kind: 'text'; readonly text: string; readonly raw: JsonValue; readonly usage: Usage }

export interface ExtractRequest {
  readonly sensitivity: Sensitivity
  readonly text: string
  /** The shape the answer must take. */
  readonly schema: JsonObject
  readonly instruction: string
  readonly maxInputTokens?: number
}

/** What a provider can and cannot do. The adapter compensates; callers never branch. */
export interface Capabilities {
  /** Can the provider be made to choose a tool? Otherwise the adapter coerces. */
  readonly forcedToolChoice: boolean
  /** Can the allowed tool names be enforced by their servers, per request? */
  readonly allowedToolsServerSide: boolean
  /** Can a shape be forced on a reply that also offers tools? */
  readonly schemaWithTools: boolean
  readonly maxRequestTokens: number
  /** Does the provider keep what it is sent? */
  readonly retainsInput: boolean
  /** Does the provider learn from what it is sent? */
  readonly trainsOnInput: boolean
}

export interface ModelProvider {
  /** Written as provider:model, for example `gemini:gemini-3.5-flash-lite`. */
  readonly id: string
  readonly capabilities: Capabilities
  turn(request: TurnRequest): Promise<TurnResult>
  extract(request: ExtractRequest): Promise<JsonValue>
}

// ─────────────────────────────────────────────────────────────────────────────
// Failures, named once so retry logic is written once
// ─────────────────────────────────────────────────────────────────────────────

export type LimitScope = 'requests-per-minute' | 'requests-per-day' | 'tokens-per-minute' | 'tokens-per-day' | 'unknown'

export class RateLimited extends Error {
  constructor(
    readonly providerId: string,
    readonly scope: LimitScope,
    readonly retryAfterMs: number | undefined,
    message?: string,
  ) {
    super(message ?? `${providerId} has hit its ${scope} limit`)
    this.name = 'RateLimited'
  }
}

export class ContextTooLarge extends Error {
  constructor(
    readonly providerId: string,
    readonly estimatedTokens: number,
    readonly limit: number,
  ) {
    super(
      `this request is about ${estimatedTokens} tokens, over the ${limit} ceiling for ${providerId}. ` +
        `Pass a reference and a summary rather than the whole document.`,
    )
    this.name = 'ContextTooLarge'
  }
}

export class ProviderDown extends Error {
  constructor(
    readonly providerId: string,
    readonly status: number | undefined,
    message: string,
  ) {
    super(message)
    this.name = 'ProviderDown'
  }
}

export class MalformedReply extends Error {
  constructor(
    readonly providerId: string,
    message: string,
  ) {
    super(message)
    this.name = 'MalformedReply'
  }
}

/**
 * A request marked as carrying a person's details was offered to a provider that
 * keeps or learns from what it is sent.
 *
 * This is a refusal, not a failure. It becomes an entry in the record under
 * `refusal.recorded`, and it appears in the finished packet under the heading
 * "What this system would not do".
 */
export class SensitivityRefusal extends Error {
  constructor(
    readonly providerId: string,
    readonly reason: string,
  ) {
    super(
      `refused to send a request containing a person's details to ${providerId}: ${reason}. ` +
        `Only providers that keep nothing and learn nothing may receive them.`,
    )
    this.name = 'SensitivityRefusal'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The size ceiling
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The most a single request may be, in tokens.
 *
 * This number is what makes a second provider usable at all. Our fallback allows
 * eight thousand tokens a minute, so at this ceiling two requests fit in a minute.
 * Without the ceiling, one twenty-thousand-token request exceeds the entire
 * per-minute budget and can never succeed — it does not become slower, it becomes
 * impossible, and it looks like the provider being broken.
 *
 * Enforced before sending, so an oversized request fails loudly while we are
 * building rather than quietly on the day.
 */
export const MAX_REQUEST_TOKENS = 4000

/**
 * Roughly how many tokens some text is.
 *
 * An estimate, and deliberately a pessimistic one — about three characters per
 * token rather than the usual four. Counting exactly would mean either a
 * tokeniser dependency per provider or a network call, and both cost more than
 * this is worth.
 *
 * Erring high is the safe direction: it refuses a few requests that would have
 * fit, and never lets through one that would not. The opposite mistake is a
 * request that fails at the provider, which is the failure this exists to prevent.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3)
}

/** Everything in a turn that counts towards the ceiling. */
export function estimateTurnTokens(request: TurnRequest): number {
  const parts = [
    request.situation,
    JSON.stringify(request.history),
    JSON.stringify(request.tools),
  ]
  return parts.reduce((total, part) => total + estimateTokens(part), 0)
}
