/**
 * Groq, called through its plain web interface.
 *
 * THE ONE PROVIDER A PERSON'S DETAILS MAY REACH
 *
 * Groq keeps nothing by default and is contractually barred from training on what
 * is sent to it. That is why `retainsInput` and `trainsOnInput` are both false
 * below, and those two lines are the only reason a request marked as carrying
 * someone's details is allowed to come here at all — the router filters on them.
 *
 * If Groq's published policy ever changes, those two lines change, and the whole
 * system stops sending personal data here without another line being touched.
 * That is the point of putting the rule in a flag rather than in a comment.
 *
 * WHAT IT CANNOT DO, AND WHAT WE DO INSTEAD
 *
 * Google's servers will enforce, per request, the exact list of tool names the
 * model is permitted to call. Groq has no equivalent: the list of tools sent IS
 * the only restriction, and nothing on their side checks the answer against it.
 *
 * So this adapter checks it here, on the way back, and refuses a tool that was
 * never offered. That is not a theoretical worry — one of the other free models on
 * this same service is known to call tools that were not in the request, which is
 * part of why it was rejected in favour of this one.
 *
 * The difference matters for what Charter is allowed to claim. With Google the
 * guarantee is somebody else's server. Here it is our code, and there is a test
 * next to it.
 *
 * WHY THIS MODEL
 *
 *   qwen/qwen3.8-27b — 30 requests a minute, 1,000 a day, 8,000 tokens a minute,
 *   2,000,000 tokens a day, on the free plan. Counted per organisation, not per
 *   key, so extra keys do not raise it.
 *
 * The 8,000 tokens a minute is the limit that actually binds, and it is why
 * MAX_REQUEST_TOKENS exists: a 20,000-token request here does not become slow, it
 * becomes impossible.
 */

import {
  ContextTooLarge,
  MalformedReply,
  ProviderDown,
  RateLimited,
  estimateTokens,
  type Capabilities,
  type ExtractRequest,
  type LimitScope,
  type ModelProvider,
  type ToolSpec,
  type TurnRequest,
  type TurnResult,
} from './types.js'
import type { JsonObject, JsonValue } from '../record/canonical.js'

const BASE = 'https://api.groq.com/openai/v1'

/** How the network is reached. Passed in so tests never touch it. */
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>

export interface GroqOptions {
  readonly apiKey: string
  readonly model: string
  readonly fetcher?: Fetcher
  readonly baseUrl?: string
}

interface GroqToolCall {
  id?: string
  type?: string
  /** Note the arguments arrive as TEXT holding JSON, not as an object. */
  function?: { name?: string; arguments?: string }
}

interface GroqMessage {
  role?: string
  content?: string | null
  tool_calls?: GroqToolCall[]
  [key: string]: unknown
}

interface GroqReply {
  choices?: Array<{ message?: GroqMessage; finish_reason?: string }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  error?: { message?: string; type?: string; code?: string }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading what the service says about its own limits
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Which limit was hit.
 *
 * Groq says so plainly in the body — "on tokens per minute (TPM)" — which is more
 * than most services do. Reporting `unknown` honestly is still better than
 * guessing, because the answer decides how long the provider is set aside for.
 */
export function limitScope(message: string): LimitScope {
  const lower = message.toLowerCase()
  if (lower.includes('(tpm)') || lower.includes('tokens per minute')) return 'tokens-per-minute'
  if (lower.includes('(tpd)') || lower.includes('tokens per day')) return 'tokens-per-day'
  if (lower.includes('(rpd)') || lower.includes('requests per day')) return 'requests-per-day'
  if (lower.includes('(rpm)') || lower.includes('requests per minute')) return 'requests-per-minute'
  return 'unknown'
}

/**
 * Turn a length of time written the way Groq writes it into milliseconds.
 *
 * Their reset headers hold things like `2m59.56s`, `7.66s` and `500ms`, which is
 * a real length of time and not a number of seconds. Reading `2m59.56s` as the
 * number 2 would set a provider aside for two milliseconds and hammer it.
 *
 * Returns undefined rather than a guess when the text is not a length of time.
 */
export function parseDuration(text: string): number | undefined {
  const trimmed = text.trim()
  if (!trimmed) return undefined

  // Every unit that appears, in order, so `1h2m3.5s` and `500ms` both work.
  const parts = trimmed.matchAll(/(\d+(?:\.\d+)?)\s*(ms|h|m|s)/g)
  const factor: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }

  let total = 0
  let matched = false
  let consumed = 0
  for (const part of parts) {
    matched = true
    total += Number(part[1]) * factor[part[2]!]!
    consumed += part[0].replace(/\s+/g, '').length
  }
  if (!matched) return undefined
  // Guard against reading something like "soon-ish 5s" as five seconds.
  if (consumed !== trimmed.replace(/\s+/g, '').length) return undefined
  return Math.round(total)
}

/**
 * How long to leave this provider alone.
 *
 * Preference order, best evidence first:
 *   1. the `retry-after` header, which is what the service actually asks for
 *   2. the reset header for the limit that was hit
 *   3. the wait named in the body text
 *   4. a stand-in, and only for the daily limits, which do not come back soon
 */
export function retryAfterMs(
  headers: Headers,
  scope: LimitScope,
  body: string,
): number | undefined {
  const header = headers.get('retry-after')
  if (header) {
    const seconds = Number(header)
    if (Number.isFinite(seconds)) return seconds * 1000
    // Some services put a length of time here rather than a number of seconds.
    const asDuration = parseDuration(header)
    if (asDuration !== undefined) return asDuration
  }

  const resetHeader = scope.startsWith('tokens') ? 'x-ratelimit-reset-tokens' : 'x-ratelimit-reset-requests'
  const reset = headers.get(resetHeader)
  if (reset) {
    const asDuration = parseDuration(reset)
    if (asDuration !== undefined) return asDuration
  }

  // Their wording is "Please try again in 7.66s", and sometimes "2m59.56s". The
  // whole run of number-and-unit pairs has to be captured: reading only the first
  // pair turns two minutes into two milliseconds and hammers a spent provider.
  const said = /try again in\s+((?:\d+(?:\.\d+)?\s*(?:ms|h|m|s)\s*)+)/i.exec(body)
  if (said?.[1]) {
    const asDuration = parseDuration(said[1])
    if (asDuration !== undefined) return asDuration
  }

  // A spent daily allowance does not return in a minute, so there is no point
  // asking again in one.
  return scope === 'requests-per-day' || scope === 'tokens-per-day' ? 3_600_000 : undefined
}

/** Does this failure mean the request itself was too big to ever succeed? */
function isTooLarge(body: string): boolean {
  const lower = body.toLowerCase()
  return (
    lower.includes('context_length_exceeded') ||
    lower.includes('context length') ||
    lower.includes('too many tokens') ||
    lower.includes('reduce the length')
  )
}

/** Did the answer stop because it ran out of room, rather than because it finished? */
function ranOutOfRoom(finishReason: string | undefined): boolean {
  return finishReason === 'length'
}

// ─────────────────────────────────────────────────────────────────────────────

export function groqProvider(options: GroqOptions): ModelProvider {
  const fetcher = options.fetcher ?? ((url, init) => fetch(url, init))
  const base = options.baseUrl ?? BASE
  const id = `groq:${options.model}`

  const capabilities: Capabilities = {
    forcedToolChoice: true,
    // The important false. See the note at the top of the file: the list of tools
    // sent is the only restriction their side applies, so we check the answer
    // ourselves on the way back.
    allowedToolsServerSide: false,
    // Never done here, and unverified for this model. The cautious value cannot
    // cause a request we would regret; the optimistic one could.
    schemaWithTools: false,
    // NOT the model's context window, which is larger. This is the free plan's
    // tokens-per-minute allowance, and being the smaller of the two it is the one
    // that decides whether a request can succeed at all.
    maxRequestTokens: 8000,
    // The two lines that make this the only provider a person's details may reach.
    retainsInput: false,
    trainsOnInput: false,
  }

  async function post(path: string, body: unknown): Promise<GroqReply> {
    const sent = JSON.stringify(body)
    let response: Response
    try {
      response = await fetcher(`${base}/${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${options.apiKey}`,
        },
        body: sent,
      })
    } catch (error) {
      throw new ProviderDown(id, undefined, `could not reach Groq: ${(error as Error).message}`)
    }

    if (response.status === 429) {
      const text = await response.text().catch(() => '')
      const scope = limitScope(text)
      throw new RateLimited(id, scope, retryAfterMs(response.headers, scope, text), `${id} is out of allowance (${scope})`)
    }
    if (response.status >= 500) {
      throw new ProviderDown(id, response.status, `Groq returned ${response.status}`)
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      // A request that is simply too big is a different thing from a service that
      // will not answer. Calling it "unavailable" would send us round every other
      // provider with the same doomed request.
      // The size is measured from what was actually sent rather than invented, so
      // the number in the message is one somebody can check.
      if (isTooLarge(text)) {
        throw new ContextTooLarge(id, estimateTokens(sent), capabilities.maxRequestTokens)
      }
      throw new ProviderDown(id, response.status, `Groq refused the request (${response.status}): ${text.slice(0, 300)}`)
    }

    const reply = (await response.json().catch(() => null)) as GroqReply | null
    if (!reply) throw new MalformedReply(id, 'the reply was not valid JSON')
    if (reply.error) {
      throw new ProviderDown(id, undefined, reply.error.message ?? 'Groq reported an error')
    }
    return reply
  }

  function usageOf(reply: GroqReply) {
    return {
      inputTokens: reply.usage?.prompt_tokens ?? 0,
      outputTokens: reply.usage?.completion_tokens ?? 0,
    }
  }

  /** The tools, in the shape this service expects. */
  function toolsFor(tools: readonly ToolSpec[]) {
    return tools.map((tool) => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    }))
  }

  /**
   * Read a tool call, and refuse one that was never offered.
   *
   * The arguments arrive as TEXT holding JSON rather than as an object, which is
   * the one shape difference from the other provider that would silently corrupt
   * the record if it were missed: the fingerprint of the text `{"a":1}` is not the
   * fingerprint of the object it describes.
   */
  function readToolCall(call: GroqToolCall, offered: readonly ToolSpec[]): { name: string; args: JsonObject } {
    const name = call.function?.name
    if (!name) {
      throw new MalformedReply(id, 'the reply contained a tool call with no name')
    }
    if (!offered.some((tool) => tool.name === name)) {
      throw new MalformedReply(
        id,
        `the model called "${name}", which was not offered in this request. ` +
          `Offered: ${offered.map((t) => t.name).join(', ') || 'nothing'}. ` +
          `This service does not enforce the list on its side, so it is enforced here.`,
      )
    }

    const text = call.function?.arguments ?? '{}'
    let parsed: unknown
    try {
      parsed = JSON.parse(text === '' ? '{}' : text)
    } catch {
      throw new MalformedReply(
        id,
        `the arguments for "${name}" were meant to be JSON and did not parse: ${text.slice(0, 200)}`,
      )
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new MalformedReply(
        id,
        `the arguments for "${name}" were meant to be a set of named values, and were ${
          Array.isArray(parsed) ? 'a list' : typeof parsed
        }`,
      )
    }
    return { name, args: parsed as JsonObject }
  }

  return {
    id,
    capabilities,

    async turn(request: TurnRequest): Promise<TurnResult> {
      const body: Record<string, unknown> = {
        model: options.model,
        messages: [
          ...(request.history as JsonValue[]),
          { role: 'user', content: request.situation },
        ],
      }

      // An empty tool list is not the same as no tool list. Sending `tools: []` is
      // refused outright, so the stage that offers nothing sends neither field.
      if (request.tools.length > 0) {
        body['tools'] = toolsFor(request.tools)
        body['tool_choice'] = request.toolChoice === 'required' ? 'required' : 'auto'
      }

      const reply = await post('chat/completions', body)
      const choice = reply.choices?.[0]
      const message = choice?.message ?? {}
      // Kept exactly as it arrived, including anything this adapter does not read.
      const raw = message as JsonValue

      const call = message.tool_calls?.[0]
      if (call) {
        // Any further calls stay in `raw` and in the record. One turn chooses one
        // action, so the first is the one that is acted on.
        const { name, args } = readToolCall(call, request.tools)
        return { kind: 'tool_call', name, args, raw, usage: usageOf(reply) }
      }

      if (ranOutOfRoom(choice?.finish_reason)) {
        throw new MalformedReply(
          id,
          'the answer was cut off before it finished, so anything read from it would be a fragment',
        )
      }

      const text = (message.content ?? '').trim()
      if (!text && request.toolChoice === 'required') {
        throw new MalformedReply(
          id,
          'a tool call was required, but the reply contained neither a tool call nor any text',
        )
      }
      return { kind: 'text', text, raw, usage: usageOf(reply) }
    },

    /**
     * Ask for data in a given shape.
     *
     * Two ways of asking, because support for the stricter one varies by model and
     * we would rather fall back than fail. The stricter one is tried first; if the
     * service says it does not know that way of asking, the shape is put in the
     * words instead and the answer is still checked by parsing it.
     *
     * Worth saying plainly either way: a forced shape guarantees the answer
     * parses. It does not guarantee the answer is right, which is why nothing
     * important is decided by this alone.
     */
    async extract(request: ExtractRequest): Promise<JsonValue> {
      const ask = async (strict: boolean): Promise<GroqReply> =>
        post('chat/completions', {
          model: options.model,
          messages: [
            {
              role: 'user',
              content: strict
                ? `${request.instruction}\n\n${request.text}`
                : `${request.instruction}\n\nAnswer with JSON only, matching this shape exactly:\n` +
                  `${JSON.stringify(request.schema)}\n\n${request.text}`,
            },
          ],
          response_format: strict
            ? { type: 'json_schema', json_schema: { name: 'answer', schema: request.schema, strict: true } }
            : { type: 'json_object' },
        })

      let reply: GroqReply
      try {
        reply = await ask(true)
      } catch (error) {
        // Only a refusal of this way of asking is worth retrying. A spent
        // allowance or an unreachable service is not, and retrying would spend a
        // second request to learn the same thing.
        const refusedTheFormat =
          error instanceof ProviderDown &&
          /response_format|json_schema|not supported|unsupported/i.test(error.message)
        if (!refusedTheFormat) throw error
        reply = await ask(false)
      }

      const choice = reply.choices?.[0]
      if (ranOutOfRoom(choice?.finish_reason)) {
        throw new MalformedReply(
          id,
          'the answer was cut off before it finished, so it cannot be read as complete data',
        )
      }

      const text = choice?.message?.content ?? ''
      try {
        return JSON.parse(text) as JsonValue
      } catch {
        throw new MalformedReply(
          id,
          `the reply was meant to be JSON in a given shape and did not parse: ${text.slice(0, 200)}`,
        )
      }
    },
  }
}
