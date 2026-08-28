/**
 * The eight stages, and which tools exist in each one.
 *
 * WHAT THIS IS FOR
 *
 * Charter's work moves through eight stages in a fixed order. This file is the
 * whole of what the model is allowed to do in each of them. Its job is to answer
 * one question: **which tools may the model use right now?**
 *
 * WHY "MAY USE" IS THE WRONG WORDING FOR WHAT ACTUALLY HAPPENS
 *
 * Tools not listed for the current stage are not forbidden. They are **absent**.
 * The request sent to the model contains this stage's tools and nothing else, so
 * the model cannot ask for a thing it has never been shown. Our main provider will
 * additionally enforce the list on their own servers, which turns our care into a
 * guarantee made by somebody else.
 *
 * That distinction is the design. A model told "do not use the signing tool" can
 * be talked into using it. A model that has never been shown one cannot.
 *
 * TWO RULES THAT GOVERN THIS FILE
 *
 * **Tools change only when the stage changes.** Never in the middle of a turn.
 * A turn is decided against one fixed list, so what the model was offered and what
 * it was allowed are always the same thing.
 *
 * **Stage changes are decided by code, not by the model.** The model may say it
 * believes a stage is finished. Code checks the conditions and decides. The model
 * has no way to move the case forward by asserting that it should move.
 *
 * WHY THE STAGES ARE A FIXED TYPE RATHER THAN A LIST OF TEXT
 *
 * Every table in this file is written as a complete mapping from the stage names,
 * so leaving a stage out is refused when the code is compiled. The alternative —
 * finding out during a demonstration that one stage has no tool list — is the
 * failure this is written to prevent.
 *
 * STAGE SEVEN HAS NO TOOLS. THAT IS NOT AN OMISSION.
 *
 * Stage seven is where the agent stops and a person signs. It has an empty tool
 * list, and a test in this project fails the build if any signature-related tool
 * ever appears in any stage's list. Charter never signs on a human's behalf, and
 * this is one of the four places that is enforced rather than promised.
 */

import type { Sensitivity } from '../model/types.js'
import type { CaseFacts } from './facts.js'

// ─────────────────────────────────────────────────────────────────────────────
// The stages, in order
// ─────────────────────────────────────────────────────────────────────────────

export type StageName =
  | 'understand'
  | 'research'
  | 'address'
  | 'draft'
  | 'verify'
  | 'assemble'
  | 'boundary'
  | 'publish'

/**
 * The order. No skipping and no going backwards, and this list is the only place
 * that order is written down.
 */
export const STAGE_ORDER: readonly StageName[] = [
  'understand',
  'research',
  'address',
  'draft',
  'verify',
  'assemble',
  'boundary',
  'publish',
]

/** Whether a stage has finished, and if not, what is missing. */
export type Completion = { readonly ready: true } | { readonly ready: false; readonly because: string }

const ready: Completion = { ready: true }
const notYet = (because: string): Completion => ({ ready: false, because })

export interface StageDefinition {
  readonly name: StageName
  /** 1 to 8, as the documents number them. */
  readonly position: number
  /** The name a person sees. */
  readonly title: string
  /** What happens here, in plain words, shown in the activity feed. */
  readonly whatHappens: string
  /** The complete list of tools that exist in this stage. Nothing else is sent. */
  readonly tools: readonly string[]
  /**
   * `required` — the model must choose a tool.
   * `auto`     — it may answer without choosing one.
   *
   * Only one stage is `auto`, and the reason is specific: stage one has to be able
   * to say "there is nothing left to ask." Forcing a tool call there makes a model
   * invent a question rather than admit it has enough.
   */
  readonly toolChoice: 'required' | 'auto'
  /**
   * Whether this stage's turns may carry a real person's details.
   *
   * A request marked `personal` may only reach a provider that keeps nothing and
   * trains on nothing. The right number of `personal` stages is zero, and it is
   * currently zero: the one stage that touches identity documents decides what to
   * do with a fixed comparison against a confidence score, which needs no model.
   */
  readonly sensitivity: Sensitivity
  /**
   * The most turns this stage may take before it gives up.
   *
   * A model calling a failing tool over and over is not a theoretical worry when
   * the whole day's allowance is 500 requests. Without a ceiling, one bad loop
   * overnight costs every remaining request until midnight in California.
   */
  readonly maxTurns: number
  /** Whether the case may leave this stage. Decided here, in code, never by the model. */
  readonly readyToLeave: (facts: CaseFacts) => Completion
}

/**
 * The stage that is not built yet, said honestly.
 *
 * Stages four to eight arrive later in the build. Their completion rule refuses,
 * with the reason, which is the correct behaviour and not a placeholder: a case
 * genuinely cannot pass a stage whose work does not exist. Nothing here pretends
 * to be finished, and nothing silently lets a case through.
 */
const notBuiltYet = (what: string): ((facts: CaseFacts) => Completion) =>
  () => notYet(`${what} is not built yet, so this stage cannot be completed`)

export const STAGES: Readonly<Record<StageName, StageDefinition>> = {
  understand: {
    name: 'understand',
    position: 1,
    title: 'Understand',
    whatHappens:
      'The person describes their business. Charter asks about anything it still ' +
      'needs, including permission to spend a stated amount on the web address.',
    tools: ['ask_question', 'record_fact', 'request_spend_permission'],
    // The one stage that must be able to say "nothing left to ask".
    toolChoice: 'auto',
    sensitivity: 'public',
    maxTurns: 12,
    readyToLeave: (facts) => {
      if (facts.description === undefined || facts.description.trim() === '') {
        return notYet('nobody has described the business yet')
      }
      if (facts.state === undefined) {
        return notYet('the state the business will be formed in is not known yet')
      }
      if (facts.proposedName === undefined) {
        return notYet('the business has no proposed name yet')
      }
      if (facts.owners.length < 2) {
        return notYet(
          `Charter prepares businesses with more than one owner, and ${facts.owners.length} ` +
            `${facts.owners.length === 1 ? 'is' : 'are'} known so far. Forming a business ` +
            `alone is already solved and already free; everything hard lives in the second owner`,
        )
      }
      if (facts.openQuestions.length > 0) {
        return notYet(
          `${facts.openQuestions.length} question(s) asked and not yet answered: ` +
            `${facts.openQuestions.join('; ')}`,
        )
      }
      if (facts.spendAuthorisation === undefined) {
        return notYet(
          'nobody has given permission to spend anything yet, and the next stages ' +
            'lead to a registration that costs money and cannot be undone',
        )
      }
      return ready
    },
  },

  research: {
    name: 'research',
    position: 2,
    title: 'Research the name',
    whatHappens:
      'Search for businesses already using this name, and decide whether the ' +
      'proposed one is clear. Whether two names collide is decided in plain code, ' +
      'not by the model.',
    tools: ['search_web', 'compare_names', 'record_fact'],
    toolChoice: 'required',
    sensitivity: 'public',
    maxTurns: 12,
    readyToLeave: (facts) => {
      const research = facts.nameResearch
      if (research === undefined) return notYet('no searches have been run yet')
      if (research.searches.length === 0) return notYet('no searches have been run yet')
      if (research.verdict === undefined) {
        return notYet('the results have not been compared against the proposed name yet')
      }
      if (research.verdict === 'collides') {
        return notYet(
          'the proposed name collides with a business already using it, so a ' +
            'different name is needed before going further',
        )
      }
      if (research.verdict === 'needs-a-person') {
        return notYet('the results are close enough that a person has to look at them')
      }
      return ready
    },
  },

  address: {
    name: 'address',
    position: 3,
    title: 'Secure the address',
    whatHappens:
      'Check whether the web address is free, and register it only if a person ' +
      'has already given permission covering the price.',
    tools: ['check_address', 'register_address', 'record_fact'],
    toolChoice: 'required',
    sensitivity: 'public',
    maxTurns: 12,
    readyToLeave: (facts) => {
      const address = facts.address
      if (address === undefined) return notYet('no web address has been checked yet')
      if (address.available === undefined) {
        return notYet(`whether ${address.candidate} is free has not been established yet`)
      }
      if (address.available && address.registered !== true) {
        return notYet(`${address.candidate} is free but has not been registered`)
      }
      if (!address.available) {
        return notYet(`${address.candidate} is taken, so another address is needed`)
      }
      return ready
    },
  },

  draft: {
    name: 'draft',
    position: 4,
    title: 'Draft the agreement',
    whatHappens: 'Write the ownership agreement from one adaptive template.',
    tools: [],
    toolChoice: 'required',
    sensitivity: 'public',
    maxTurns: 12,
    readyToLeave: notBuiltYet('drafting the agreement'),
  },

  verify: {
    name: 'verify',
    position: 5,
    title: 'Verify identity',
    whatHappens:
      "Read each owner's identity document, score every field, and send the " +
      'doubtful ones to a person. No model takes part in that decision.',
    tools: [],
    toolChoice: 'required',
    // Deliberately public. The reading of an identity document is done by a
    // document service, and the decision to escalate is a fixed comparison
    // against a score. No model turn in this stage carries anybody's details.
    sensitivity: 'public',
    maxTurns: 12,
    readyToLeave: notBuiltYet('reading identity documents'),
  },

  assemble: {
    name: 'assemble',
    position: 6,
    title: 'Assemble the pack',
    whatHappens: 'Merge, read text from scans, compress, add structure, then seal.',
    tools: [],
    toolChoice: 'required',
    sensitivity: 'public',
    maxTurns: 12,
    readyToLeave: notBuiltYet('assembling the pack'),
  },

  boundary: {
    name: 'boundary',
    position: 7,
    title: 'The boundary',
    whatHappens:
      'The agent stops. A person approves, and ordinary code — not the agent — ' +
      'carries the pack to them to sign.',
    // Empty on purpose, and permanently. This is the stage where a human signs,
    // and there is nothing here for a model to do. A test fails the build if any
    // signature-related tool ever appears in any stage's list, this one included.
    tools: [],
    // Nothing is asked of the model here, so nothing can be chosen.
    toolChoice: 'required',
    sensitivity: 'public',
    maxTurns: 0,
    readyToLeave: notBuiltYet('the signature request'),
  },

  publish: {
    name: 'publish',
    position: 8,
    title: 'Publish',
    whatHappens:
      "Build the website, draw its first picture from the owner's own words, put " +
      'it online, and point the web address at it.',
    tools: [],
    toolChoice: 'required',
    sensitivity: 'public',
    maxTurns: 12,
    readyToLeave: notBuiltYet('publishing the site'),
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Moving between stages
// ─────────────────────────────────────────────────────────────────────────────

export class StageOrderViolation extends Error {
  constructor(
    readonly from: StageName,
    readonly to: string,
    readonly why: string,
  ) {
    super(`a case cannot move from "${from}" to "${to}": ${why}`)
    this.name = 'StageOrderViolation'
  }
}

/** Is this a stage name at all? Used where a name arrives from outside the code. */
export function isStageName(value: unknown): value is StageName {
  return typeof value === 'string' && Object.hasOwn(STAGES, value)
}

/** The stage after this one, or `undefined` at the end of the run. */
export function nextStage(name: StageName): StageName | undefined {
  return STAGE_ORDER[STAGE_ORDER.indexOf(name) + 1]
}

/** The complete list of tools that exist in a stage. Nothing else is ever sent. */
export function toolsFor(name: StageName): readonly string[] {
  return STAGES[name].tools
}

/**
 * Move a case to the next stage, or refuse and say why.
 *
 * Three separate things are checked, and each one is a rule from the design:
 *
 *   1. **The destination is the very next stage.** Not two forward, not back, not
 *      the same one again. The order is code, not a suggestion.
 *   2. **This stage's own conditions are met**, judged by this stage's rule, over
 *      the facts folded from the record.
 *   3. **The model does not get a say.** This function takes facts, never an
 *      opinion. A model that announces a stage is finished changes nothing; the
 *      only thing that moves a case is the state of the record.
 */
export function moveTo(from: StageName, to: string, facts: CaseFacts): void {
  if (!isStageName(to)) {
    throw new StageOrderViolation(from, to, `there is no stage called "${to}"`)
  }

  const expected = nextStage(from)
  if (expected === undefined) {
    throw new StageOrderViolation(from, to, `"${from}" is the last stage, so there is nowhere to go`)
  }
  if (to !== expected) {
    const goingBack = STAGES[to].position < STAGES[from].position
    throw new StageOrderViolation(
      from,
      to,
      goingBack
        ? `that is backwards. Stage ${STAGES[to].position} comes before stage ${STAGES[from].position}, ` +
            `and a case never goes back — the record would then hold two answers to the same question ` +
            `with nothing saying which one counts`
        : `the next stage is "${expected}" (stage ${STAGES[expected].position}), and stages are not ` +
            `skipped. Stage ${STAGES[to].position} depends on work that stage ${STAGES[expected].position} does`,
    )
  }

  const completion = STAGES[from].readyToLeave(facts)
  if (!completion.ready) {
    throw new StageOrderViolation(from, to, completion.because)
  }
}

/**
 * Whether a case could move on right now, without throwing.
 *
 * The same rule as `moveTo`, asked as a question rather than as an instruction.
 * Used by the activity feed, which wants to show what is still missing rather than
 * fail.
 */
export function couldMoveOn(from: StageName, facts: CaseFacts): Completion {
  return STAGES[from].readyToLeave(facts)
}
