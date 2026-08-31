/**
 * Turning single turns into a run.
 *
 * WHAT THIS ADDS TO `loop.ts`
 *
 * `loop.ts` takes one turn and changes nothing — it hands back the entries that
 * ought to be added to the record. This file is the one place that actually writes
 * them, and then reads the record back to work out where the case now stands.
 *
 * Keeping those apart is worth the extra file. The turn is the part with all the
 * judgement in it, and it can be tested exhaustively with no database at all.
 * Writing to the record is the part that must happen in exactly one place, so that
 * "everything that happened is in the record" is a property of the shape of the
 * program rather than a habit.
 *
 * WHY THE FACTS ARE READ BACK FROM THE RECORD AFTER EVERY TURN
 *
 * The obvious version keeps a summary in memory and updates it as it goes. This
 * one throws that away each turn and reads the record again.
 *
 * That single decision is what makes a run resumable. Nothing is held, so nothing
 * is lost: a crash, a closed browser tab, a machine restarting between turn four
 * and turn five all cost nothing at all. Picking up again is the same operation as
 * carrying on, because both are "read the record and take a turn."
 *
 * It also means the summary cannot drift from the record, because there is only
 * one of them.
 *
 * WHO DECIDES A STAGE IS FINISHED
 *
 * Code, from the record. After every turn the stage's own rule is asked whether
 * its conditions are met. The model is never asked and cannot say. A model that
 * announced a stage was complete would change nothing — there is no argument
 * anywhere in this file that it controls.
 */

import type { Database } from '../db/driver.js'
import type { Actor } from '../record/chain.js'
import { append, readEvents, readPayload } from '../record/log.js'
import type { Clock } from '../record/log.js'
import { foldFacts, type RecordedEntry } from '../stages/fold.js'
import type { CaseFacts } from '../stages/facts.js'
import { STAGES, couldMoveOn, moveTo, nextStage, type StageName } from '../stages/stages.js'
import type { Tool } from '../tools/registry.js'
import type { Services } from '../tools/services.js'
import { takeTurn, type TurnOutcome, type TurnTaker } from './loop.js'
import { DEFAULT_SETTINGS, type Settings } from '../settings.js'

export interface RunOptions {
  readonly db: Database
  readonly caseId: string
  readonly registry: ReadonlyMap<string, Tool>
  readonly router: TurnTaker
  readonly services: Services
  readonly clock: Clock
  /**
   * The settings this run was started with, already checked.
   *
   * Read once, at the edge of the program, and carried down. Nothing deeper in
   * reads the environment for itself, so a recorded run can be reproduced by
   * anybody holding the same settings rather than by anybody who happens to have
   * the same shell.
   */
  readonly settings?: Settings
  /** Where the finished pack goes, when the caller wants to keep it. */
  readonly keepPack?: (bytes: Uint8Array) => Promise<void>
  /** Told about everything as it happens, so a run can be watched while it runs. */
  readonly onEvent?: (kind: string, stage: StageName, detail: string) => void
}

/**
 * Read the whole record for a case and fold it into what is known.
 *
 * The detail of each entry is fetched separately because a detail can be
 * forgotten — cleared at somebody's request — while the entry itself stays, so the
 * chain still checks out. A forgotten detail comes back as nothing and is passed
 * over, which is why forgetting does not break a past run.
 */
export async function readFacts(db: Database, caseId: string): Promise<CaseFacts> {
  const events = await readEvents(db, caseId)
  const entries: RecordedEntry[] = []
  for (const event of events) {
    entries.push({ kind: event.kind, payload: await readPayload(db, caseId, event.seq) })
  }
  return foldFacts(caseId, entries)
}

/** How many turns this stage has already taken, counted from the record itself. */
export async function turnsTaken(db: Database, caseId: string, stage: StageName): Promise<number> {
  const events = await readEvents(db, caseId)
  return events.filter((event) => event.kind === 'turn.started' && event.stage === stage).length
}

export interface StageResult {
  readonly stage: StageName
  readonly finished: boolean
  /** Why it stopped, when it did not finish. */
  readonly because: string
  readonly turns: number
}

/**
 * Take turns in one stage until it finishes or stops.
 *
 * Stops for one of three reasons, and says which:
 *
 *   the stage's own conditions are met, judged from the record
 *   a turn gave up — the model could not produce something runnable, or the
 *     stage used its whole allowance of turns
 *   the stage is waiting on a person, and no number of further turns will change
 *     that
 *
 * The third is not a failure. A question on the screen with nobody yet at the
 * keyboard, or a permission to spend that only a person can grant, are both
 * states a run sits in perfectly happily. Spending model requests re-asking would
 * cost part of a daily allowance to learn nothing.
 */
export async function runStage(options: RunOptions, stage: StageName): Promise<StageResult> {
  const { db, caseId, clock } = options
  const say = options.onEvent ?? (() => {})

  for (;;) {
    const facts = await readFacts(db, caseId)

    const completion = couldMoveOn(stage, facts)
    if (completion.ready) {
      return {
        stage,
        finished: true,
        because: 'everything this stage needs is in the record',
        turns: await turnsTaken(db, caseId, stage),
      }
    }

    if (waitingOnAPerson(facts)) {
      return {
        stage,
        finished: false,
        because: waitingOnAPerson(facts) ?? '',
        turns: await turnsTaken(db, caseId, stage),
      }
    }

    const report = await takeTurn({
      caseId,
      stage,
      facts,
      registry: options.registry,
      router: options.router,
      services: options.services,
      turnsSoFar: await turnsTaken(db, caseId, stage),
      now: () => clock(),
      settings: options.settings ?? DEFAULT_SETTINGS,
      ...(options.keepPack === undefined ? {} : { keepPack: options.keepPack }),
    })

    // One place writes to the record. Written in order, so the record reads the
    // way things happened.
    for (const event of report.events) {
      await append(
        db,
        {
          runId: caseId,
          kind: event.kind,
          actor: actorFor(event.kind),
          stage,
          payload: event.payload,
        },
        clock,
      )
      say(event.kind, stage, describe(event.kind, event.payload))
    }

    if (report.outcome.kind === 'gave up') {
      return {
        stage,
        finished: false,
        because: report.outcome.why,
        turns: await turnsTaken(db, caseId, stage),
      }
    }
    if (report.outcome.kind === 'said nothing to do') {
      // The model has nothing left to ask. Whether that is true is decided by the
      // stage's own rule at the top of the next pass, not by the model saying so.
      const after = await readFacts(db, caseId)
      if (!couldMoveOn(stage, after).ready) {
        return {
          stage,
          finished: false,
          because:
            `the model says there is nothing left to do, but ` +
            `${describeGap(stage, after)}. A stage is finished when its conditions ` +
            `are met, not when the model believes they are.`,
          turns: await turnsTaken(db, caseId, stage),
        }
      }
    }
  }
}

/** Move on, if the record says this stage is genuinely done. */
export async function advance(options: RunOptions, from: StageName): Promise<StageName | undefined> {
  const facts = await readFacts(options.db, options.caseId)
  const to = nextStage(from)
  if (to === undefined) return undefined
  // Throws, loudly, if the order or the conditions are not met.
  moveTo(from, to, facts)
  await append(
    options.db,
    {
      runId: options.caseId,
      kind: 'stage.entered',
      actor: 'system',
      stage: to,
      payload: { from, to, position: String(STAGES[to].position) },
    },
    options.clock,
  )
  return to
}

/**
 * Is this case waiting on a person rather than on the model?
 *
 * Returns the reason, or nothing when the case is not waiting. Two states count,
 * and both are ordinary rather than wrong: a question on the screen that nobody
 * has answered, and a request to spend that only a person can grant.
 */
function waitingOnAPerson(facts: CaseFacts): string | undefined {
  if (facts.openQuestions.length > 0) {
    return (
      `waiting for an answer to: ${facts.openQuestions.join('; ')}. ` +
      `Asking the model again would spend a request to learn nothing.`
    )
  }
  if (facts.spendRequested !== undefined && facts.spendAuthorisation === undefined) {
    return (
      `the agent asked for permission to spend up to ${facts.spendRequested.limitCents} ` +
      `cents on ${facts.spendRequested.forWhat}, and nobody has granted it. There is ` +
      `no tool that grants permission, so no number of further turns will produce ` +
      `one — only a person can.`
    )
  }
  if (facts.nameResearch?.verdict === 'needs-a-person') {
    return (
      `a business was found whose name is close to the proposed one, and the rule ` +
      `sends close ones to a person rather than guessing. Waiting for that answer.`
    )
  }
  const waitingOnAReview = facts.identityChecks.filter((check) => check.toReview.length > 0)
  if (waitingOnAReview.length > 0) {
    // Nothing the model can do moves this forward. There is no tool that clears a
    // review, and the code that records one having been done is not reachable from
    // anything the model can trigger. Taking another turn here would spend a
    // request from a daily allowance to be told the same thing again.
    return (
      `values read from an identity document are with a person: ` +
      `${waitingOnAReview
        .map((check) => `${check.owner} (${check.toReview.join(', ')})`)
        .join('; ')}. ` +
      `No tool clears a review, so no number of further turns will clear one — ` +
      `only a person who has looked at the document can.`
    )
  }
  return undefined
}

/** What is still missing, for a message. */
function describeGap(stage: StageName, facts: CaseFacts): string {
  const completion = couldMoveOn(stage, facts)
  return completion.ready ? 'nothing is missing' : completion.because
}

/**
 * Who caused this entry.
 *
 * Worth getting right rather than defaulting: a record where everything is
 * attributed to "the system" cannot answer the one question people actually ask
 * about an agent, which is what the agent did as opposed to what a person did.
 */
function actorFor(kind: string): Actor {
  // A person. Only two things in a run come from one, and both are the important
  // ones: answering a question, and granting permission to spend.
  if (kind === 'spend.authorised' || kind === 'question.answered') return 'human'
  // An outside company. Recorded separately from us, because "the registrar said
  // this address was free" and "we decided it was free" are different claims.
  if (kind.startsWith('search.') || kind.startsWith('address.')) return 'vendor'
  // The model, or something it caused.
  if (kind.startsWith('model.') || kind.startsWith('turn.') || kind.startsWith('tool.')) {
    return 'model'
  }
  if (kind.startsWith('question.') || kind.startsWith('fact.') || kind.startsWith('spend.')) {
    return 'model'
  }
  // Ordinary code, on nobody's instruction: moving between stages.
  return 'system'
}

/** One line for the watching feed. Short: this scrolls past while a run happens. */
function describe(kind: string, payload: Record<string, unknown>): string {
  switch (kind) {
    case 'turn.started':
      return `turn ${String(payload['turn'])}, offering ${String(payload['toolsOffered'])}`
    case 'model.answered':
      return `${String(payload['providerId'])} chose ${String(payload['chose'])}`
    case 'tool.arguments.rejected':
      return `${String(payload['tool'])} — arguments did not fit, asking again`
    case 'tool.refused':
      return `refused ${String(payload['asked'])}`
    case 'turn.retried':
      return `asked again after a correction`
    case 'tool.ran':
      return String(payload['tool'])
    case 'question.asked':
      return String(payload['question'])
    case 'fact.recorded':
      return `${String(payload['about'])} = ${String(payload['value'])}`
    case 'spend.requested':
      return `asked to spend up to ${String(payload['limitCents'])} cents`
    case 'search.performed':
      return `"${String(payload['query'])}" — ${String(payload['resultCount'])} result(s)`
    case 'names.compared':
      return `name check: ${String(payload['verdict'])}`
    case 'address.checked':
      return `${String(payload['domain'])} — ${payload['available'] === true ? 'free' : 'taken'}`
    case 'address.registration.refused':
      return `refused to register ${String(payload['domain'])}`
    case 'address.registered':
      return `registered ${String(payload['domain'])}`
    case 'spend.applied':
      return (
        `${String(payload['amountCents'])} cents spent, ` +
        `${String(payload['spentCentsAfter'])} of ${String(payload['limitCents'])} used`
      )
    case 'spend.authorised':
      return `a person granted up to ${String(payload['limitCents'])} cents`
    case 'question.answered':
      return `a person answered: ${String(payload['answer'])}`
    case 'stage.entered':
      return `stage ${String(payload['position'])}`
    case 'agreement.choice.recorded':
      return `${String(payload['which'])} = ${String(payload['value'])}`
    case 'agreement.choice.refused':
    case 'agreement.draft.refused':
    case 'pack.refused':
    case 'site.publish.refused':
    case 'identity.read.refused':
      return String(payload['why'])
    case 'agreement.drafted':
      return `${String(payload['articleCount'])} articles, dated ${String(payload['dated'])}`
    case 'identity.read': {
      const waiting = Array.isArray(payload['toReview']) ? payload['toReview'].length : 0
      return (
        `${String(payload['owner'])}: ${String(payload['fieldsRead'])} value(s) read, ` +
        `${waiting} to a person`
      )
    }
    case 'identity.field.sent.for.review':
      return `${String(payload['owner'])} ${String(payload['field'])} — ${String(payload['label'])}`
    case 'identity.field.checked':
      return `a person checked ${String(payload['owner'])} ${String(payload['field'])}: ${String(payload['found'])}`
    case 'pack.sealed':
      return `sealed ${String(payload['sizeBytes'])} bytes, fingerprint ${String(payload['fingerprint']).slice(0, 12)}`
    case 'signature.approved':
      return `${String(payload['approvedBy'])} approved sending this exact pack`
    case 'site.published':
      return `live at ${String(payload['liveAt'])}`
    default:
      return kind
  }
}

export type { TurnOutcome }
