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
      payload: { what, why: 'the case token did not match', ...detail },
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
