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

/**
 * A day written the way a person says it, for messages only.
 *
 * Permissions are stored with the full moment they were given, down to the
 * millisecond, because two permissions given in the same minute have to be told
 * apart. That is the right thing to store and the wrong thing to show. Somebody
 * reading a refusal wants to know which day they agreed to something, and should
 * not have to decode "2026-08-28T09:00:43.000Z" to find out.
 *
 * Anything that is not a plain date at the front is handed back untouched, because
 * a message that quietly drops the only time information it had is worse than an
 * ugly one.
 */
export function plainDay(moment: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(moment)
  if (parts === null) return moment

  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ]
  const month = months[Number(parts[2]) - 1]
  if (month === undefined) return moment

  return `${Number(parts[3])} ${month} ${parts[1]}`
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
        `${asMoney(remainingUnder(authorisation))} is left of the ` +
        `${asMoney(authorisation.limitCents)} a person allowed on ` +
        `${plainDay(authorisation.grantedAt)} (${asMoney(authorisation.spentCents)} of ` +
        `it already spent). Somebody has to raise the limit before this can go ahead. ` +
        `Charter does not spend a cent past a limit a person set.`,
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

// ─────────────────────────────────────────────────────────────────────────────
// Amounts, as people actually write them
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every amount of money mentioned in a piece of writing, in whole units.
 *
 * WHY THIS IS NEEDED AT ALL
 *
 * Charter will not write down what an owner's contribution is worth unless a
 * person has said so, because that number decides how profit is divided for the
 * life of the company. Checking that means finding the amounts in what people
 * wrote.
 *
 * Half of them are digits: "$12,000", "18000". The other half are words: "twelve
 * thousand dollars", "eighteen thousand in cash". Reading only the digits refuses
 * perfectly good answers and, worse, tells the person nobody said a number while
 * they are looking at the sentence where they said it.
 *
 * WHAT IT UNDERSTANDS AND WHERE IT STOPS
 *
 * Whole amounts up to the millions, written the ordinary way: "twelve thousand",
 * "twenty-five thousand", "one hundred thousand", "two million", "a hundred
 * thousand". Not fractions, not "twelve and a half thousand", not other languages.
 *
 * It is deliberately generous about what counts and strict about nothing, because
 * of what it is used for: it produces candidate amounts that a person MIGHT have
 * meant, and the caller checks whether the one being written down is among them.
 * A number this misses causes a question to be asked. A number it invents does
 * not get written down either, because it still has to match exactly.
 */
const ONES_SPOKEN: Readonly<Record<string, number>> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19,
}

const TENS_SPOKEN: Readonly<Record<string, number>> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
}

const MULTIPLIERS: Readonly<Record<string, number>> = {
  hundred: 100,
  thousand: 1_000,
  million: 1_000_000,
  billion: 1_000_000_000,
}

export function amountsSpokenIn(text: string): readonly number[] {
  // "twenty-five" is one number written with a hyphen, and "a hundred" is a
  // hundred. Both are ordinary English and both would otherwise be missed.
  const words = text
    .toLowerCase()
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/-/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((one) => one !== '')

  const found: number[] = []
  let running = 0
  let sofar = 0
  let started = false

  const finish = (): void => {
    if (started && running + sofar > 0) found.push(running + sofar)
    running = 0
    sofar = 0
    started = false
  }

  for (const word of words) {
    const one = ONES_SPOKEN[word]
    const ten = TENS_SPOKEN[word]
    const times = MULTIPLIERS[word]

    if (one !== undefined) {
      sofar += one
      started = true
      continue
    }
    if (ten !== undefined) {
      sofar += ten
      started = true
      continue
    }
    if (times !== undefined) {
      // "a thousand" and "thousand" on their own both mean one of them.
      const amount = sofar === 0 ? 1 : sofar
      if (times === 100) {
        sofar = amount * 100
      } else {
        running += amount * times
        sofar = 0
      }
      started = true
      continue
    }
    // "a" and "and" sit inside spoken numbers — "a hundred and twenty" — and
    // must not end one.
    if (word === 'a' || word === 'and') continue

    finish()
  }
  finish()

  return found
}
