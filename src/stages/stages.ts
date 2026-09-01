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
 * ALL EIGHT STAGES ARE NOW BUILT.
 *
 * Until 29 August 2026 the later stages shared a helper that refused with "this is
 * not built yet". That was the honest answer while their work did not exist — a
 * case genuinely cannot pass a stage that does nothing — and it is gone now
 * because every stage does its work. The helper is deleted rather than kept
 * unused, so nothing in this file can quietly go back to claiming a stage is
 * finished when it is not.
 *
 * Every rule below refuses for a reason about this particular case, never for a
 * reason about the state of the code.
 */
export const STAGES: Readonly<Record<StageName, StageDefinition>> = {
  understand: {
    name: 'understand',
    position: 1,
    title: 'Understand the business',
    whatHappens:
      'You describe the business in your own words. Charter asks about anything ' +
      'it still needs, including permission to spend a set amount on the web address.',
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
    title: 'Check the name is free',
    whatHappens:
      'Look for businesses already trading under this name, and work out whether ' +
      'the new one is clear of them. Whether two names are too close is decided by ' +
      'fixed rules, not by guesswork.',
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
    title: 'Get the web address',
    whatHappens:
      'See whether the web address is available, and buy it only if a person has ' +
      'already agreed to a price that covers it.',
    tools: [
      'check_address',
      'register_address',
      'set_address_records',
      'list_address_records',
      'record_fact',
    ],
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

      // Registering a name and pointing it somewhere are two different acts, and a
      // name with no records is a name nobody can reach. A run that registered and
      // stopped would leave the owners holding something that does not work.
      if (facts.addressRecords.length === 0) {
        return notYet(
          `${address.candidate} is registered but points nowhere. A name with no ` +
            `address records is a name nobody can reach`,
        )
      }

      // Writing returns success, and success means the request was accepted rather
      // than that anything was stored. Reading back is the only way to find out
      // what the registrar actually holds.
      if (facts.addressRecordsHeld.length === 0) {
        return notYet(
          `the address records for ${address.candidate} were sent but have not been ` +
            `read back from the registrar. Accepted is not the same as stored`,
        )
      }

      return ready
    },
  },

  draft: {
    name: 'draft',
    position: 4,
    title: 'Write the contract',
    whatHappens:
      'Ask the owners the handful of things the contract cannot be written ' +
      'without, then write it. Every number, every section number and every ' +
      'reference between sections is worked out by fixed rules, so none of it is ' +
      'invented.',
    tools: ['ask_question', 'record_fact', 'record_agreement_choice', 'draft_agreement'],
    toolChoice: 'required',
    // No owner's identity details are in this stage. Names and shares are terms of
    // a business agreement, not personal identifiers, and the identity documents
    // themselves never reach a model at any stage.
    sensitivity: 'public',
    maxTurns: 12,
    readyToLeave: (facts) => {
      const missingShares = facts.owners.filter((owner) => owner.sharePercent === undefined)
      if (missingShares.length > 0) {
        return notYet(
          `no share has been recorded for ${missingShares.map((one) => one.name).join(' and ')}, ` +
            `and Charter will not divide the remainder for them: the split is the one ` +
            `thing the owners have to decide themselves`,
        )
      }

      const unvalued = facts.owners.filter((owner) => owner.contributionCents === undefined)
      if (unvalued.length > 0) {
        return notYet(
          `what ${unvalued.map((one) => one.name).join(' and ')} contributed has not been ` +
            `given a value, and Texas divides profit by contribution value as stated in ` +
            `the company's records unless the agreement says otherwise, so without a ` +
            `figure there is no record for the statute to read`,
        )
      }

      const choices = facts.agreementChoices
      if (choices?.managedBy === undefined) {
        return notYet(
          'nobody has said who runs the company day to day, and there is no safe ' +
            'default: one answer lets every owner bind the company, the other takes ' +
            'that away from all of them',
        )
      }
      if (choices.hasExitProcess === undefined) {
        return notYet(
          'nobody has said whether there is a written way for an owner to leave. ' +
            'Texas states that a member may not withdraw or be expelled, so an ' +
            'agreement that adds nothing leaves no way out at all — that is a term ' +
            'whether or not anybody meant to agree to it, and Charter will not choose it',
        )
      }

      if (facts.agreement === undefined) {
        return notYet('the agreement has not been prepared yet')
      }

      return ready
    },
  },

  verify: {
    name: 'verify',
    position: 5,
    title: 'Check the owners are who they say',
    whatHappens:
      "Read each owner's ID, compare every value on it, and pass anything that is " +
      'not a clean match to a person to decide. Nothing guesses here.',
    tools: ['read_identity_document', 'record_fact'],
    toolChoice: 'required',
    // Deliberately public, and it is worth being precise about why. The identity
    // document is read by a document service, never by a model. Whether a value
    // needs a person is a fixed comparison in code. So no model turn in this
    // stage carries anybody's identity details, and none ever will.
    sensitivity: 'public',
    maxTurns: 12,
    readyToLeave: (facts) => {
      if (facts.owners.length === 0) return notYet('no owners are recorded')

      const unread = facts.owners.filter(
        (owner) => !facts.identityChecks.some((check) => check.owner === owner.name),
      )
      if (unread.length > 0) {
        return notYet(
          `no identity document has been read for ${unread.map((one) => one.name).join(' and ')}`,
        )
      }

      // A required field the document never produced is a different problem from a
      // doubtful value, and it is checked FIRST because it cannot be cleared the
      // same way.
      //
      // A person looking at a document can confirm that a value was read
      // correctly. Nobody can confirm a value that is not there. Until 30 August
      // 2026 both went into one queue, so somebody answering "the value is
      // correct" to a field the reader never produced cleared it, and the case
      // moved on with a date of birth nobody had. The only thing that fixes a
      // missing field is a document that has it.
      const incomplete = facts.identityChecks.filter((check) => check.missing.length > 0)
      if (incomplete.length > 0) {
        return notYet(
          `${incomplete.length} document(s) did not produce a required value at all: ` +
            incomplete
              .map((one) => `${one.owner} (${one.missing.join(', ')})`)
              .join('; ') +
            '. This cannot be cleared by a person confirming it, because there is ' +
            'nothing to confirm — a clearer document is needed, or the case waits',
        )
      }

      const waiting = facts.identityChecks.filter((check) => check.toReview.length > 0)
      if (waiting.length > 0) {
        return notYet(
          `${waiting.length} document(s) have values a person still has to check: ` +
            waiting
              .map((one) => `${one.owner} (${one.toReview.join(', ')})`)
              .join('; ') +
            '. No model takes any part in that decision, and nothing here can clear ' +
            'it — a person looks, or the case waits',
        )
      }

      return ready
    },
  },

  assemble: {
    name: 'assemble',
    position: 6,
    title: 'Put it all in one file',
    whatHappens:
      'Join everything into a single document, stamp it, and take the fingerprint ' +
      'of exactly what was stamped. From then on, anything that would change the ' +
      'words is turned down, and the refusal is written down.',
    tools: ['assemble_pack'],
    toolChoice: 'required',
    sensitivity: 'public',
    maxTurns: 12,
    readyToLeave: (facts) => {
      if (facts.agreement === undefined) {
        return notYet('there is no agreement to put in the pack yet')
      }
      if (facts.pack === undefined) {
        return notYet('the pack has not been assembled and sealed yet')
      }
      return ready
    },
  },

  boundary: {
    name: 'boundary',
    position: 7,
    title: 'Hand it to a person',
    whatHappens:
      'Charter stops here. A person says yes, and separate code that Charter ' +
      'cannot reach carries the file to them to sign.',
    // Empty on purpose, and permanently. This is the stage where a human signs,
    // and there is nothing here for a model to do. A test fails the build if any
    // signature-related tool ever appears in any stage's list, this one included.
    tools: [],
    // Nothing is asked of the model here, so nothing can be chosen.
    toolChoice: 'required',
    sensitivity: 'public',
    maxTurns: 0,
    readyToLeave: (facts) => {
      const pack = facts.pack
      if (pack === undefined) {
        return notYet('there is no sealed pack, so there is nothing to approve')
      }

      const approval = facts.approvalToSend
      if (approval === undefined) {
        return notYet(
          'no person has approved sending the pack to the owners to sign. This is ' +
            'the boundary. Nothing in the agent can write that approval, and there ' +
            'is no tool in this stage at all — a person approves in their own ' +
            'browser, or the case waits here',
        )
      }

      // The approval names the pack it was given for. If the pack has been sealed
      // again since, this no longer matches, and an approval for one document must
      // never carry across to a different one. That is how a person ends up having
      // approved a document they never saw.
      if (approval.packFingerprint !== pack.fingerprint) {
        return notYet(
          `the approval was given for a pack whose fingerprint began ` +
            `${approval.packFingerprint.slice(0, 12)}, and the sealed pack now begins ` +
            `${pack.fingerprint.slice(0, 12)}. An approval belongs to the exact ` +
            `document a person was looking at and does not carry across to another`,
        )
      }

      return ready
    },
  },

  publish: {
    name: 'publish',
    position: 8,
    title: 'Put the website online',
    whatHappens:
      "Build the business a website, draw its first picture from the owners' own " +
      'words, put it online, and point the web address at it.',
    tools: ['draw_storefront', 'publish_site'],
    toolChoice: 'required',
    sensitivity: 'public',
    maxTurns: 12,
    readyToLeave: (facts) => {
      if (facts.address?.registered !== true) {
        return notYet('there is no registered web address to point at a site')
      }
      if (facts.site === undefined) {
        return notYet('the site has not been published yet')
      }
      return ready
    },
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
