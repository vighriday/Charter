/**
 * One turn.
 *
 * WHAT A TURN IS
 *
 * Read what is known from the record, send the model this stage's tools and
 * nothing else, take its one choice, check the arguments, run the tool, and hand
 * back the entries to add to the record. That is the whole thing.
 *
 * WHY ONE REQUEST IS EXACTLY ONE TURN
 *
 * A complete run takes minutes. No single web request does. Every hosting time
 * limit therefore stops mattering, a crash costs one turn rather than a whole run,
 * and moving to a different host becomes a deployment change rather than a
 * rewrite.
 *
 * It also makes the run watchable. The page in the browser asks for the next turn,
 * shows what happened, and asks again. Close the tab and the run pauses; reopen it
 * and it carries on, because nothing was being held anywhere.
 *
 * WHY NOTHING IS CARRIED BETWEEN TURNS
 *
 * The model is not sent a growing conversation. Each turn begins from the record,
 * folded into a short description of where things stand.
 *
 * That is not a shortcut. A conversation that grows every turn eventually exceeds
 * the size a request may be — and Charter has a hard ceiling of four thousand
 * tokens, which exists because the fallback provider allows only eight thousand
 * tokens a minute. A run that quietly stopped working at turn thirty because the
 * history got long is the kind of failure that appears for the first time during a
 * demonstration.
 *
 * Starting from the record instead means turn thirty costs the same as turn one,
 * a resumed run is identical to one that never stopped, and what the model is told
 * is always traceable to entries that have fingerprints.
 *
 * The provider's reply is still kept in the record exactly as it arrived, byte for
 * byte, because that is what a later model may need handed back and because a
 * summarised reply would break the record's fingerprints. Keeping it and replaying
 * it are two different things.
 *
 * THE THREE FAILURES THIS HANDLES, AND WHY EACH ONE
 *
 * **A reply that ran out of room part-way through.** The model is cut off mid-way
 * through writing its tool call, and what arrives is half a call with truncated
 * contents. Running that would mean acting on arguments nobody wrote. The turn is
 * asked again instead.
 *
 * **Going round in circles.** A hard ceiling on turns per stage. A model calling a
 * failing tool over and over is not a theoretical worry when the entire day's
 * allowance is five hundred requests and does not return until midnight in
 * California. One bad loop overnight costs the next day's work.
 *
 * **Arguments that do not fit.** The model is told which field, what type was
 * expected, and which values are allowed, and asked again — twice at most. This is
 * the single highest-value thing that makes a free model behave like a better one,
 * and it is the reason a project running entirely on free allowances can work at
 * all.
 */

import type { JsonObject, JsonValue } from '../record/canonical.js'
import { MalformedReply, type TurnRequest, type TurnResult } from '../model/types.js'
import { STAGES, type StageName } from '../stages/stages.js'
import { describeSituation } from '../stages/fold.js'
import type { CaseFacts } from '../stages/facts.js'
import { checkArguments, repairMessage } from '../tools/schema.js'
import {
  specsFor,
  toolFor,
  UnknownTool,
  ToolNotInThisStage,
  type Tool,
  type ToolEvent,
} from '../tools/registry.js'
import type { Services } from '../tools/services.js'
import { DEFAULT_SETTINGS, type Settings } from '../settings.js'
import { randomBytes } from 'node:crypto'
import { makeSealCertificate, type SealCertificate } from '../seal/certificate.js'

/**
 * The certificate used to seal a pack when the caller did not supply one.
 *
 * Made once and kept, rather than made per turn. Making one takes a second or two,
 * and — more importantly — a run that made a new one each time would produce packs
 * carrying different seals, so a person comparing two of them would be told,
 * correctly, that they came from different places.
 *
 * The password protects a copy of the private key inside the bundle. The format
 * requires one; nothing here needs it to be memorable, and the bundle is never
 * written to disk or sent anywhere.
 *
 * So it is made fresh each time the program starts rather than written down. A
 * password in the source of a public repository is a password everybody has, and
 * "it does not matter here" is exactly the sentence that precedes one that did.
 */
let madeAlready: SealCertificate | undefined

export function sealCertificateFor(at: Date): SealCertificate {
  madeAlready ??= makeSealCertificate({
    notBefore: at,
    password: randomBytes(24).toString('base64url'),
  })
  return madeAlready
}

/**
 * How many times the model is asked again after sending arguments that do not fit.
 *
 * Two, and not more. A model that has been told twice exactly which field is wrong
 * and exactly which values are allowed and still cannot produce them is not going
 * to get there on the third attempt — it is going to spend another request from an
 * allowance of five hundred a day.
 */
export const MAX_REPAIR_ATTEMPTS = 2

/**
 * How many times a turn is asked again after a reply that was cut off.
 *
 * A different budget from repairs, because it is a different problem: nothing is
 * wrong with what the model decided, only with how much of it arrived.
 */
export const MAX_TRUNCATED_RETRIES = 2

/** What the router must be able to do. Kept this narrow so tests need no router. */
export interface TurnTaker {
  turn(request: TurnRequest): Promise<TurnResult & { readonly providerId: string }>
}

export interface TurnInput {
  readonly caseId: string
  readonly stage: StageName
  /** Everything known, folded from the record. */
  readonly facts: CaseFacts
  readonly registry: ReadonlyMap<string, Tool>
  readonly router: TurnTaker
  readonly services: Services
  /** How many turns this stage has already taken. */
  readonly turnsSoFar: number
  /** Reads the current time. Passed in so tests are exact. */
  readonly now: () => Date
  /**
   * The settings this run was started with, already checked.
   *
   * Optional here, and only here, so that a test can take a turn without
   * assembling a whole settings object for something it is not testing. Every
   * real caller passes one, and what is left out falls back to the same defaults
   * `.env.example` publishes.
   */
  readonly settings?: Settings
  /**
   * The certificate that seals the finished pack, made once for the whole run.
   *
   * Optional for the same reason, and made on demand when it is missing. Making
   * one takes a second or two, which is why it is not made unless a tool that
   * actually seals something is about to run.
   */
  readonly certificate?: SealCertificate
  /** Where the finished pack goes, when the caller wants to keep it. */
  readonly keepPack?: (bytes: Uint8Array) => Promise<void>
}

export type TurnOutcome =
  | {
      readonly kind: 'tool ran'
      readonly toolName: string
      readonly result: JsonObject
      readonly providerId: string
    }
  | {
      /** The model chose not to call anything. Only the first stage may do this. */
      readonly kind: 'said nothing to do'
      readonly text: string
      readonly providerId: string
    }
  | { readonly kind: 'gave up'; readonly why: string }

export interface TurnReport {
  readonly outcome: TurnOutcome
  /**
   * Everything to add to the record, in order.
   *
   * Returned rather than written, so this whole file can be tested without a
   * database and so there is exactly one place in the program that writes to the
   * record.
   */
  readonly events: readonly ToolEvent[]
}

/**
 * Take one turn.
 *
 * Writes nothing and changes nothing. Every consequence is in the returned
 * entries, which the caller adds to the record.
 */
export async function takeTurn(input: TurnInput): Promise<TurnReport> {
  const stage = STAGES[input.stage]
  const settings = input.settings ?? DEFAULT_SETTINGS
  const events: ToolEvent[] = []

  // Two ceilings, and the SMALLER one binds.
  //
  // The stage carries its own limit in the code. The setting can lower it and can
  // never raise it, which is the whole point: a setting able to raise a safety
  // limit is not a safety limit, and somebody who set it to a thousand while
  // chasing a problem would have quietly removed the thing that stops a failing
  // tool spending a day's allowance overnight.
  const turnCeiling = Math.min(stage.maxTurns, settings.maxTurnsPerStage)

  if (input.turnsSoFar >= turnCeiling) {
    const bound =
      turnCeiling === stage.maxTurns
        ? `its ${turnCeiling} turns`
        : `the ${turnCeiling} turns MAX_TURNS_PER_STAGE allows it, out of the ` +
          `${stage.maxTurns} this stage would otherwise take,`
    const why =
      `stage "${input.stage}" has taken ${bound} without finishing. ` +
      `Stopping rather than continuing: the whole day's allowance is a few hundred ` +
      `requests and does not return until midnight in the provider's own time zone, ` +
      `so a loop left running overnight costs tomorrow as well as today.`
    events.push({ kind: 'turn.abandoned', payload: { stage: input.stage, why } })
    return { outcome: { kind: 'gave up', why }, events }
  }

  const tools = specsFor(input.registry, input.stage)
  const situation = describeSituation(input.facts)

  let correction: string | undefined
  let repairsUsed = 0
  let truncatedRetries = 0

  // Bounded by both budgets at once, so neither kind of failure can loop.
  for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS + MAX_TRUNCATED_RETRIES; attempt++) {
    const request: TurnRequest = {
      stage: input.stage,
      sensitivity: stage.sensitivity,
      situation: correction === undefined ? situation : `${situation}\n\n${correction}`,
      // Empty on purpose. See the note at the top of this file: the model is told
      // where things stand, not what was said.
      history: [],
      tools,
      toolChoice: stage.toolChoice,
      // MODEL_MAX_REQUEST_TOKENS: the hard ceiling on how large one request may
      // be, checked before sending so an oversized request fails here rather than
      // at the provider.
      maxInputTokens: settings.maxRequestTokens,
    }

    // A correction is the same turn asked again, not a new turn. Counting each
    // attempt as a turn would make the ceiling on turns per stage fire early, and
    // would make the feed read as though the model had been asked more often than
    // it had.
    events.push({
      kind: correction === undefined ? 'turn.started' : 'turn.retried',
      payload: {
        stage: input.stage,
        turn: String(input.turnsSoFar + 1),
        attempt: String(attempt + 1),
        toolsOffered: tools.map((tool) => tool.name),
      },
    })

    let answer: TurnResult & { readonly providerId: string }
    try {
      answer = await input.router.turn(request)
    } catch (error) {
      // A reply cut off part-way through. Nothing is wrong with what the model
      // decided, only with how much of it arrived, so ask again.
      if (error instanceof MalformedReply && truncatedRetries < MAX_TRUNCATED_RETRIES) {
        truncatedRetries++
        events.push({
          kind: 'model.reply.unusable',
          payload: { why: error.message, askingAgain: true },
        })
        continue
      }
      throw error
    }

    events.push({
      kind: 'model.answered',
      payload: {
        providerId: answer.providerId,
        chose: answer.kind === 'tool_call' ? answer.name : '(no tool)',
        // Kept exactly as it arrived. Never summarised: a later model may need it
        // handed back unchanged, and a summary would break the record's
        // fingerprints as well.
        raw: answer.raw,
        usage: { inputTokens: answer.usage.inputTokens, outputTokens: answer.usage.outputTokens },
      },
    })

    if (answer.kind === 'text') {
      if (stage.toolChoice === 'auto') {
        // The one stage that is allowed to say there is nothing left to ask.
        return {
          outcome: { kind: 'said nothing to do', text: answer.text, providerId: answer.providerId },
          events,
        }
      }
      correction =
        `You answered with words. This stage needs you to call one of the tools ` +
        `offered: ${tools.map((tool) => tool.name).join(', ')}. Call one now.`
      repairsUsed++
      if (repairsUsed > MAX_REPAIR_ATTEMPTS) break
      continue
    }

    let tool: Tool
    try {
      tool = toolFor(input.registry, input.stage, answer.name)
    } catch (error) {
      if (error instanceof UnknownTool || error instanceof ToolNotInThisStage) {
        events.push({
          kind: 'tool.refused',
          payload: { asked: answer.name, why: error.message },
        })
        correction =
          `${error.message}\n\nCall one of these instead: ` +
          `${tools.map((t) => t.name).join(', ')}.`
        repairsUsed++
        if (repairsUsed > MAX_REPAIR_ATTEMPTS) break
        continue
      }
      throw error
    }

    const check = checkArguments(tool.schema, answer.args)
    if (!check.ok) {
      events.push({
        kind: 'tool.arguments.rejected',
        payload: {
          tool: tool.name,
          attempt: String(repairsUsed + 1),
          sent: answer.args,
          problems: check.problems as unknown as JsonValue,
        },
      })
      correction = repairMessage(tool.name, check.problems)
      repairsUsed++
      if (repairsUsed > MAX_REPAIR_ATTEMPTS) break
      continue
    }

    const outcome = await tool.run(answer.args, {
      caseId: input.caseId,
      facts: input.facts,
      services: input.services,
      now: input.now,
      settings,
      certificate: input.certificate ?? sealCertificateFor(input.now()),
      ...(input.keepPack === undefined ? {} : { keepPack: input.keepPack }),
    })

    events.push({
      kind: 'tool.ran',
      payload: { tool: tool.name, args: answer.args, result: outcome.result },
    })
    // The tool's own entries come after the record of it having run, so the
    // record reads in the order things happened.
    events.push(...outcome.events)

    return {
      outcome: {
        kind: 'tool ran',
        toolName: tool.name,
        result: outcome.result,
        providerId: answer.providerId,
      },
      events,
    }
  }

  const why =
    `the model was asked ${MAX_REPAIR_ATTEMPTS} more time(s) after its first answer ` +
    `could not be used, and still did not produce something runnable. Stopping ` +
    `rather than asking again: each attempt spends a request from a daily ` +
    `allowance that does not return until midnight in the provider's own time zone.`
  events.push({ kind: 'turn.abandoned', payload: { stage: input.stage, why } })
  return { outcome: { kind: 'gave up', why }, events }
}
