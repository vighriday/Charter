/**
 * Nothing costs money without a person having said so first.
 *
 * THE OBJECTION THIS ANSWERS
 *
 * Charter's headline claim is that the agent never signs on a person's behalf. The
 * obvious reply is: *your agent cannot sign, but it can spend?* Registering a web
 * address costs real money and cannot be undone, so that reply is fair and it
 * needs a real answer rather than a slogan.
 *
 * The answer is that these are two different kinds of irreversible, not two
 * degrees of the same kind:
 *
 * > **Money can be delegated within stated limits. Consent to be legally bound
 * > can never be delegated, at any limit.**
 *
 * A person may genuinely authorise someone to spend on their behalf up to a
 * figure. That is ordinary agency and commercial law has recognised it for
 * centuries. No person can authorise anyone to *agree* on their behalf to be
 * bound, because agreement is an act of will and a machine has none.
 *
 * So Charter builds both: spending is permitted inside a bound a person set, and
 * signing is not permitted at all.
 *
 * WHERE THE PERMISSION COMES FROM, AND WHY THAT MATTERS MOST
 *
 * The permission is an entry in the record, written when a person granted it in
 * their browser. **It never passes through the agent.** There is no tool that
 * grants permission — the agent has a tool for *asking*, and asking is all it can
 * do. The grant travels from the browser to the code that writes the record,
 * along a path the model is not on.
 *
 * That is what stops the obvious attack. If granting were a tool, a model could be
 * talked into granting itself permission and then spending under it. Because
 * granting is not a tool, there is nothing to talk it into.
 *
 * WHY THIS CHECK IS NOT INSIDE THE REGISTRAR
 *
 * It would be natural to put "check the permission" inside the code that talks to
 * the registrar. It is deliberately outside, and runs before the tool does.
 *
 * A rule living inside the thing it governs moves when that thing is replaced. The
 * day somebody swaps the registrar for a different one, the rule would leave with
 * it and nobody would notice, because everything would still work. Out here it
 * applies to every tool that declares it costs money, including ones not written
 * yet.
 *
 * WHY MONEY IS COUNTED IN WHOLE CENTS, AS TEXT
 *
 * Fractions of a currency cannot be held exactly in the numbers a computer uses.
 * A tenth plus two tenths is not three tenths, and a check of "is this within the
 * limit" built on that will one day be wrong by a fraction of a cent in whichever
 * direction is worse. Whole cents, compared as whole numbers of unlimited size,
 * have no such edge. Written as text for the same reason the record writes every
 * number as text: one form everywhere means fingerprints always agree.
 */

import type { CaseFacts, SpendAuthorisation } from '../stages/facts.js'

export type SpendVerdict =
  | { readonly allowed: true; readonly remainingCents: string }
  | { readonly allowed: false; readonly reason: string }

export class NotAWholeNumberOfCents extends Error {
  constructor(what: string, value: string) {
    super(
      `${what} must be a whole number of cents written as text, for example "1299" ` +
        `for twelve dollars and ninety-nine cents. It was "${value}". Fractions of a ` +
        `cent cannot be held exactly, and a limit checked in fractions is one that is ` +
        `eventually wrong in whichever direction is worse.`,
    )
    this.name = 'NotAWholeNumberOfCents'
  }
}

/** Read a whole number of cents, refusing anything that is not exactly that. */
export function cents(value: string, what = 'an amount'): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new NotAWholeNumberOfCents(what, value)
  return BigInt(value)
}

/** Money written the way a person reads it, for messages only. Never compared. */
export function asMoney(value: string): string {
  const total = cents(value)
  const whole = total / 100n
  const part = total % 100n
  return `$${whole}.${part.toString().padStart(2, '0')}`
}

/** What is left under a permission, in whole cents, as text. */
export function remainingUnder(authorisation: SpendAuthorisation): string {
  const limit = cents(authorisation.limitCents, 'the permitted limit')
  const spent = cents(authorisation.spentCents, 'the amount already spent')
  const left = limit - spent
  return (left > 0n ? left : 0n).toString()
}

/**
 * May this act, costing this much, run?
 *
 * Takes the facts folded from the record, so the answer is drawn from what
 * actually happened rather than from anything the model asserted. There is no
 * argument to this function that the model controls.
 */
export function maySpend(facts: CaseFacts, costCents: string, forWhat: string): SpendVerdict {
  const authorisation = facts.spendAuthorisation

  if (authorisation === undefined) {
    return {
      allowed: false,
      reason:
        `"${forWhat}" costs money and cannot be undone, and nobody has given ` +
        `permission to spend anything on this case. Permission comes from a person, ` +
        `in their browser, and is written to the record before anything can be ` +
        `spent under it. There is no tool that grants it, so the agent cannot ` +
        `create one — it can only ask.`,
    }
  }

  let cost: bigint
  let left: bigint
  try {
    cost = cents(costCents, `the cost of "${forWhat}"`)
    left = cents(remainingUnder(authorisation), 'what is left under the permission')
  } catch (error) {
    return { allowed: false, reason: error instanceof Error ? error.message : String(error) }
  }

  if (cost > left) {
    return {
      allowed: false,
      reason:
        `"${forWhat}" costs ${asMoney(costCents)}, and only ` +
        `${asMoney(remainingUnder(authorisation))} is left under the permission ` +
        `given on ${authorisation.grantedAt} (${asMoney(authorisation.limitCents)} in ` +
        `total, ${asMoney(authorisation.spentCents)} already spent). A person has to ` +
        `raise the limit before this can run. Charter does not spend past a bound ` +
        `somebody set, even by a cent.`,
    }
  }

  return { allowed: true, remainingCents: (left - cost).toString() }
}

/**
 * The permission with one spend added to what it has already covered.
 *
 * Returned rather than applied, because nothing here changes anything: the new
 * figure becomes an entry in the record, and the facts are folded from the record
 * afterwards. There is no running total held anywhere that could disagree with it.
 */
export function afterSpending(
  authorisation: SpendAuthorisation,
  costCents: string,
): SpendAuthorisation {
  const spent = cents(authorisation.spentCents, 'the amount already spent')
  const cost = cents(costCents, 'the cost')
  return { ...authorisation, spentCents: (spent + cost).toString() }
}
