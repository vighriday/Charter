/**
 * The things only a person can do.
 *
 * WHAT IS IN HERE
 *
 * Two acts: answering a question Charter asked, and granting permission to spend
 * up to a stated amount. Both arrive from a person in their browser, and both are
 * written to the record from here.
 *
 * WHY THEY LIVE IN THEIR OWN FILE, OUTSIDE THE AGENT'S REACH
 *
 * Because the agent must not be able to do them, and "must not" has to mean
 * something more than a rule written down.
 *
 * The agent has a tool for *asking* for permission to spend. It has no tool for
 * granting one, and this file — the only thing that writes a granted permission —
 * is imported by nothing the model can trigger, directly or through any chain of
 * imports. A test walks the whole import graph and fails the build if that ever
 * stops being true.
 *
 * That is what closes the obvious attack. If granting were something the agent
 * could reach, a model could be talked into granting itself permission and then
 * spending under it, and every safeguard downstream would be arguing with a
 * permission that looked completely genuine. Because granting is not reachable
 * from the agent's code, there is nothing to talk it into.
 *
 * THE SAME SHAPE AS THE SIGNING BOUNDARY, ONE TIER DOWN
 *
 * Charter draws two lines, and they are different in kind rather than in degree:
 *
 * > **Money can be delegated within stated limits. Consent to be legally bound
 * > can never be delegated, at any limit.**
 *
 * A person may genuinely authorise someone to spend on their behalf up to a
 * figure — ordinary agency, recognised for centuries. No person can authorise
 * anyone to *agree* on their behalf to be bound, because agreement is an act of
 * will and a machine has none.
 *
 * So spending is permitted inside a bound a person set, and this file is where
 * that bound is set. Signing is not permitted at all, and there is no file for it
 * on this side of the line.
 *
 * WHY THE CASE TOKEN IS REQUIRED
 *
 * Charter builds no login system. A case is reached through one long unguessable
 * link, and every act that binds somebody must carry that case's secret token.
 * Without it, anybody who learned a case identifier could grant permission to
 * spend on somebody else's behalf.
 *
 * The token is never written into the record. An attempt without it is recorded —
 * the attempt, not the token — because a refusal is worth knowing about.
 */

import { isFingerprint } from '../record/canonical.js'
import type { Database } from '../db/driver.js'
import { append, type Clock } from '../record/log.js'
import { cents } from '../tools/guard.js'

export class NotThePerson extends Error {
  constructor(what: string) {
    super(
      `${what} was refused: the request did not carry this case's token. Charter has ` +
        `no login system, so the token is the only thing separating the owners from ` +
        `anybody who happened to learn the case identifier.`,
    )
    this.name = 'NotThePerson'
  }
}

export interface HumanAct {
  readonly db: Database
  readonly caseId: string
  /** The case's secret, as it arrived from the browser. Never recorded. */
  readonly token: string
  /** The case's secret, as Charter holds it. */
  readonly expectedToken: string
  readonly clock: Clock
}

/**
 * Compare two secrets without leaking how much of them matched.
 *
 * A plain comparison stops at the first differing character, and the time that
 * takes can be measured. Comparing every character regardless removes that.
 */
function sameToken(given: string, expected: string): boolean {
  if (given.length !== expected.length) return false
  let differences = 0
  for (let i = 0; i < given.length; i++) {
    differences |= given.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return differences === 0
}

async function refuse(act: HumanAct, what: string, detail: Record<string, string>): Promise<never> {
  await append(
    act.db,
    {
      runId: act.caseId,
      kind: 'human.act.refused',
      actor: 'system',
      stage: null,
      // The token itself is never written down, only the fact that it was wrong.
      payload: { what, why: 'this answer named a different job', ...detail },
    },
    act.clock,
  )
  throw new NotThePerson(what)
}

/**
 * A person answering a question Charter asked.
 *
 * Until this is written, the stage that asked cannot finish — which is what stops
 * the agent from deciding it has heard enough while somebody is still typing.
 */
export async function answerQuestion(
  act: HumanAct,
  question: string,
  answer: string,
): Promise<void> {
  if (!sameToken(act.token, act.expectedToken)) {
    await refuse(act, 'answering a question', { question })
  }
  await append(
    act.db,
    {
      runId: act.caseId,
      kind: 'question.answered',
      actor: 'human',
      stage: null,
      payload: { question, answer, answeredAt: act.clock().toISOString() },
    },
    act.clock,
  )
}

/**
 * Something a person said about their own business, written down as they said it.
 *
 * WHY A PERSON CAN WRITE A FACT DOWN AND WHY THAT IS NOT A LOOPHOLE
 *
 * The model has a tool for writing facts down, and everywhere else in Charter the
 * model is the one that uses it: it listens, works out that a sentence contains a
 * name or a state, and records that. That is the agent doing its job.
 *
 * Two facts are not like that. When somebody is asked "describe your business" and
 * types a paragraph, the paragraph IS the description. Nothing has to be worked
 * out. Passing it through a model to be retyped adds one thing only: the chance
 * that it comes back different.
 *
 * That is not a worry, it is what happened. On the first real run a model retyped
 * the owners paragraph and cut the last sentence off, and the last sentence was
 * the name they wanted to trade under. The run then had no name, and spent the
 * rest of the step trying to write down things it already knew.
 *
 * So what a person typed is written down as what they typed, marked as coming
 * from a person, and the model reads it like any other fact.
 *
 * WHAT THIS DOES NOT OPEN
 *
 * Only what a person actually typed, in the same breath as typing it. It cannot
 * grant a permission, it cannot clear a name, it cannot approve anything, and it
 * is checked against the same job token as every other act by a person here. It
 * writes down words. Nothing follows from it that would not follow from the same
 * words arriving through the model.
 */
export async function writeDownWhatTheySaid(
  act: HumanAct,
  about: 'description' | 'state' | 'proposed_name',
  value: string,
): Promise<void> {
  if (!sameToken(act.token, act.expectedToken)) {
    await refuse(act, 'writing down something a person said', { about })
  }
  await append(
    act.db,
    {
      runId: act.caseId,
      kind: 'fact.recorded',
      // Not "model". Reading this record back, the difference between a fact the
      // owners stated and a fact an agent worked out is the difference between
      // evidence and inference, and it must be visible.
      actor: 'human',
      stage: null,
      payload: { about, value },
    },
    act.clock,
  )
}

/**
 * A person deciding whether a name that came out close is close enough to matter.
 *
 * WHY THIS IS A PERSON'S JOB AND NOT THE COMPARISON'S
 *
 * Whether two business names collide is decided in plain code: fold the accents,
 * lowercase it, drop the company ending and the punctuation, join up initials, and
 * compare. That is reproducible on anybody's machine and it is free, and for most
 * pairs it gives an answer nobody would argue with.
 *
 * It has a middle. "Rowan Cycle Works" against "PRO CYCLE WORKS" is not the same
 * name and is not obviously a different one either. Whether that matters depends on
 * what the two businesses actually do, where they do it, and how much risk these
 * particular owners want to carry. None of that is in a string comparison.
 *
 * So the code says "close" and stops, and a person says which it is.
 *
 * WHY IT IS ITS OWN ENTRY IN THE RECORD
 *
 * It was written down as an answer to a question first, and that failed in a way
 * worth remembering: the answer was recorded, correctly and permanently, and
 * nothing read it. The comparison still said "close", the step still could not
 * finish, and the same question came back for ever. A person had decided and the
 * program did not notice.
 *
 * An answer is something a person said. This is something a person DECIDED, and the
 * difference is that a decision changes what the program does next. Making it its
 * own kind of entry is what lets the rest of the code read it.
 */
export async function decideAboutACloseName(
  act: HumanAct,
  clear: boolean,
  aboutWhat: readonly string[],
): Promise<void> {
  if (!sameToken(act.token, act.expectedToken)) {
    await refuse(act, 'deciding about a close name', { clear: String(clear) })
  }
  await append(
    act.db,
    {
      runId: act.caseId,
      kind: 'name.decided',
      actor: 'human',
      stage: null,
      payload: {
        // 'clear' and 'collides' are the same two words the comparison itself uses,
        // so a reader of the record does not have to hold two vocabularies at once.
        verdict: clear ? 'clear' : 'collides',
        // What they were actually looking at when they decided. A decision with no
        // record of what it was about cannot be checked by anybody later.
        about: aboutWhat.join('; '),
        decidedAt: act.clock().toISOString(),
      },
    },
    act.clock,
  )
}

/**
 * A person granting permission to spend, up to a stated amount.
 *
 * The only place in Charter that writes a granted permission. Nothing the model
 * can trigger imports this file, and a test proves it.
 *
 * The amount is whole cents written as text, for the reason money is always
 * handled that way here: fractions of a currency cannot be held exactly, and a
 * limit checked in fractions is eventually wrong in whichever direction is worse.
 */
export async function grantSpendPermission(
  act: HumanAct,
  limitCents: string,
  forWhat: string,
): Promise<void> {
  if (!sameToken(act.token, act.expectedToken)) {
    await refuse(act, 'granting permission to spend', { limitCents, forWhat })
  }
  // Refuse anything that is not exactly a whole number of cents, before it can
  // become a limit that comparisons are made against.
  cents(limitCents, 'the permitted limit')

  await append(
    act.db,
    {
      runId: act.caseId,
      kind: 'spend.authorised',
      actor: 'human',
      stage: null,
      payload: { limitCents, forWhat, grantedAt: act.clock().toISOString() },
    },
    act.clock,
  )
}

/**
 * A person approving that the sealed pack may be carried to the owners to sign.
 *
 * THIS IS THE BOUNDARY, AND IT IS WORTH BEING EXACT ABOUT WHAT IT IS NOT.
 *
 * This is not a signature and never becomes one. It is one person saying "yes,
 * send this out." The owners then sign it themselves, in their own browsers, with
 * their own hands. Nothing in Charter signs for anybody, at any point, and the
 * stage where this happens has no tools at all — there is nothing there for a
 * model to choose.
 *
 * WHY THE FINGERPRINT IS PART OF THE APPROVAL
 *
 * The approval names the exact document the person was looking at. If the pack is
 * sealed again afterwards, the fingerprint no longer matches and the approval
 * stops counting. It does not carry across.
 *
 * That is not a technicality. An approval that survives the document changing
 * underneath it is how a person ends up having approved something they never saw,
 * and it is the shape of the whole problem this project exists to talk about.
 *
 * WHY IT LIVES HERE
 *
 * This file is reachable from a person's browser and from nothing the model can
 * trigger. That is checked by following every import in the project, not by
 * anybody remembering, and a build fails the day anything in the agent's reach can
 * get to this function.
 */
export async function approveSendingForSignature(
  act: HumanAct,
  approvedBy: string,
  packFingerprint: string,
): Promise<void> {
  if (!sameToken(act.token, act.expectedToken)) {
    await refuse(act, 'approving that the pack be sent for signature', { approvedBy })
  }

  if (!isFingerprint(packFingerprint)) {
    // An approval that names nothing in particular approves everything, which is
    // the one thing this must never do.
    throw new NotThePerson(
      'An approval has to name the exact pack it was given for, by its fingerprint. ' +
        `"${packFingerprint}" is not one. Without it the approval would not be ` +
        'attached to any particular document, and an approval attached to no ' +
        'document approves whatever turns up.',
    )
  }

  await append(
    act.db,
    {
      runId: act.caseId,
      kind: 'signature.approved',
      actor: 'human',
      stage: null,
      payload: {
        approvedBy,
        packFingerprint,
        approvedAt: act.clock().toISOString(),
      },
    },
    act.clock,
  )
}

/**
 * A person having looked at one doubtful value from an identity document, and
 * saying what they found.
 *
 * WHY ONLY A PERSON CAN DO THIS
 *
 * Stage five decides, in plain code, which values read off an identity document
 * have to be checked. Nothing in the agent can reverse that decision — there is no
 * tool for it, and this function is not reachable from anything a model can
 * trigger. If clearing a review were something the software could do, the review
 * would be a formality with extra steps.
 *
 * So the case waits here until a person actually looks. That is slower, and it is
 * the only version of this that means anything.
 *
 * BOTH ANSWERS ARE RECORDED
 *
 * "I looked and the value is right" and "I looked and the value is wrong" are both
 * written down, with who looked. A review that only records the outcome somebody
 * wanted is not a review.
 */
export async function checkIdentityField(
  act: HumanAct,
  owner: string,
  field: string,
  found: 'the value is correct' | 'the value is wrong',
): Promise<void> {
  if (!sameToken(act.token, act.expectedToken)) {
    await refuse(act, 'checking a value read from an identity document', { owner, field })
  }

  await append(
    act.db,
    {
      runId: act.caseId,
      kind: 'identity.field.checked',
      actor: 'human',
      stage: null,
      payload: { owner, field, found, checkedAt: act.clock().toISOString() },
    },
    act.clock,
  )
}
