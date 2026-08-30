/**
 * Every piece of arithmetic and wording the document service cannot do itself.
 *
 * WHAT THIS FILE IS
 *
 * Charter writes an ownership agreement — the document that says who owns what
 * share of a business, who decides things, and what happens when somebody wants
 * out. The document is produced from a template by an outside service.
 *
 * That service joins text together. It does not do arithmetic, and this is the
 * single most dangerous fact about it:
 *
 *     60 + 40 produces "6040", not 100.
 *
 * It is string joining, not addition. In a document that allocates ownership of a
 * business, a number that is wrong by a factor of a hundred is catastrophic, and
 * "6040" looks enough like a real figure that a person skimming a draft can miss
 * it. So every number in the finished agreement is worked out here, in code, and
 * handed to the template already finished. The template is never asked to compute
 * anything.
 *
 * The service also cannot write numbers as words, cannot write ordinals, cannot
 * format money, and handles dates in a way that depends on the reader's locale and
 * fails silently. Legal drafting needs all four. So they are here too.
 *
 * WHY SHARES ARE WHOLE NUMBERS OF BASIS POINTS
 *
 * A basis point is one hundredth of one percent. A half share is 5,000 basis
 * points. This project never stores a share as 0.5 or as 50.0, for the same reason
 * it never stores money as a decimal number: a computer cannot hold most decimal
 * fractions exactly, so adding three of them can produce 99.99999999999999. In an
 * ownership document, a total that is not exactly one hundred percent is not a
 * rounding curiosity. It is an unallocated sliver of a company that nobody owns,
 * and a court asked to decide who owns it has no answer in the document.
 *
 * Whole numbers of basis points add up exactly, always. They are held as BigInt,
 * which is the language's whole-number type with no size limit and no rounding.
 *
 * WHY THE TOTAL IS CHECKED RATHER THAN CORRECTED
 *
 * If shares do not total exactly one hundred percent, this code refuses. It does
 * not spread the difference across the owners, and it does not give the remainder
 * to the largest holder. Both are things a program can do and neither is a thing a
 * program should do: they quietly change what people agreed, in the one document
 * whose whole job is to record what people agreed.
 */

import { isRealDate, daysInMonth } from '../dates.js'

/** A share of a business, held as whole basis points. 10,000 = one hundred percent. */
export type BasisPoints = bigint

/** One hundred percent, and the only total a set of shares may add up to. */
export const WHOLE: BasisPoints = 10_000n

/** Thrown when a number cannot be used in a legal document as it stands. */
export class UnusableNumber extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnusableNumber'
  }
}

/**
 * Turn a written percentage into whole basis points, or refuse.
 *
 * Accepts text, not a number, on purpose. A percentage that has been through the
 * language's own decimal type has already lost the very exactness we are trying to
 * keep, so the text a person typed is the earliest honest place to read it.
 *
 * Two decimal places is the limit, because a basis point is the smallest share
 * this project recognises. Refusing a third place is better than silently dropping
 * it: somebody who writes 33.333% means something, and the document should not
 * quietly decide they meant 33.33%.
 */
export function share(written: string): BasisPoints {
  const tidy = written.trim().replace(/%$/, '').trim()

  if (!/^\d+(\.\d{1,2})?$/.test(tidy)) {
    throw new UnusableNumber(
      `A share must be a plain percentage with at most two decimal places, such ` +
        `as "50" or "33.33". Got "${written}". Anything finer than one hundredth of ` +
        `a percent cannot be recorded, and rounding it here would change what the ` +
        `owners agreed without telling them.`,
    )
  }

  const [whole, fraction = ''] = tidy.split('.')
  const points = BigInt(whole ?? '0') * 100n + BigInt(fraction.padEnd(2, '0'))

  if (points > WHOLE) {
    throw new UnusableNumber(`A share cannot be more than 100%. Got "${written}".`)
  }
  if (points === 0n) {
    throw new UnusableNumber(
      `A share of 0% is not a share. An owner with no share is not an owner, and ` +
        `the agreement should not list them as one.`,
    )
  }

  return points
}

/**
 * Check that a set of shares totals exactly one hundred percent, or refuse.
 *
 * The message says what the total actually is, because "shares do not add up" sends
 * somebody back to re-add a column by hand, and "they add up to 99.5%" tells them
 * what to look for.
 */
export function mustTotalWhole(shares: readonly BasisPoints[], whose: readonly string[]): void {
  if (shares.length === 0) {
    throw new UnusableNumber('An agreement with no owners has nothing to allocate.')
  }

  const total = shares.reduce((running, one) => running + one, 0n)
  if (total === WHOLE) return

  const detail = whose
    .map((name, index) => `${name} ${asPercent(shares[index] ?? 0n)}`)
    .join(', ')

  throw new UnusableNumber(
    `Ownership shares must total exactly 100%. These total ${asPercent(total)}: ` +
      `${detail}. Charter will not spread the difference or hand the remainder to ` +
      `anybody, because that would quietly change what the owners agreed in the one ` +
      `document whose job is to record what they agreed.`,
  )
}

/** Basis points as a percentage a person reads: `5000n` becomes `50%`. */
export function asPercent(points: BasisPoints): string {
  const whole = points / 100n
  const fraction = points % 100n
  if (fraction === 0n) return `${whole}%`
  const twoPlaces = fraction.toString().padStart(2, '0')
  // Trailing zero dropped so 33.30% reads as 33.3%, which is how a person writes it.
  return `${whole}.${twoPlaces.replace(/0$/, '')}%`
}

/**
 * The share one owner would hold if shares followed contribution value exactly.
 *
 * This exists because of one statute. In Texas, profits and losses are allocated
 * by the value of each owner's contribution **as stated in the company's records**,
 * unless the company agreement says otherwise. So the agreement has to know both
 * numbers: what each owner put in, and what each owner agreed to hold. When they
 * differ, the agreement has to say so deliberately.
 *
 * The division is done in whole numbers, and the remainder is reported rather than
 * dropped, because dropping it is how a set of shares stops adding to one hundred.
 */
export function shareOfContributions(
  contributionCents: bigint,
  totalCents: bigint,
): { readonly points: BasisPoints; readonly exact: boolean } {
  if (totalCents <= 0n) {
    throw new UnusableNumber(
      'Contributions total zero, so no share of them can be worked out. An ' +
        'agreement where nobody contributed anything needs its allocation stated ' +
        'directly rather than derived.',
    )
  }

  const scaled = contributionCents * WHOLE
  return { points: scaled / totalCents, exact: scaled % totalCents === 0n }
}

// ─────────────────────────────────────────────────────────────────────────────
// Words, because legal drafting does not write numerals alone
// ─────────────────────────────────────────────────────────────────────────────

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
] as const

const TENS = [
  '', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
] as const

const ORDINALS = [
  'zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh',
  'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth',
  'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth',
] as const

const TENS_ORDINALS = [
  '', '', 'twentieth', 'thirtieth', 'fortieth', 'fiftieth', 'sixtieth',
  'seventieth', 'eightieth', 'ninetieth',
] as const

/** A whole number in words: `2` becomes `two`. Nothing above ninety-nine is needed. */
export function inWords(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 99) {
    throw new UnusableNumber(
      `Only whole numbers from 0 to 99 are written as words here, because nothing ` +
        `in this agreement counts higher. Got ${value}.`,
    )
  }
  if (value < 20) return ONES[value] as string

  const tens = TENS[Math.floor(value / 10)] as string
  const ones = value % 10
  return ones === 0 ? tens : `${tens}-${ONES[ones] as string}`
}

/**
 * The form legal drafting actually uses: `two (2)`.
 *
 * The words and the numeral together, because if one of them is a typing mistake
 * the other still says what was meant. That is the entire reason the convention
 * exists, and it is worth keeping for the same reason.
 */
export function inWordsAndFigures(value: number): string {
  return `${inWords(value)} (${value})`
}

/** A position in words: `2` becomes `Second`, capitalised for a heading. */
export function asOrdinal(value: number): string {
  if (!Number.isInteger(value) || value < 1 || value > 99) {
    throw new UnusableNumber(`Ordinals here run from 1 to 99. Got ${value}.`)
  }

  const word =
    value < 20
      ? (ORDINALS[value] as string)
      : value % 10 === 0
        ? (TENS_ORDINALS[Math.floor(value / 10)] as string)
        : `${TENS[Math.floor(value / 10)] as string}-${ORDINALS[value % 10] as string}`

  return word.charAt(0).toUpperCase() + word.slice(1)
}

// ─────────────────────────────────────────────────────────────────────────────
// Money, dates, and vote thresholds
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Money as a person reads it, from whole cents: `150000n` becomes `$1,500.00`.
 *
 * Cents in, never a decimal number in. The same reason as everywhere else in this
 * project: a decimal number cannot hold most money amounts exactly, and an amount
 * that is wrong in the last place is still wrong in a document somebody signs.
 */
export function asMoney(cents: bigint): string {
  const negative = cents < 0n
  const size = negative ? -cents : cents
  const dollars = (size / 100n).toString()
  const remainder = (size % 100n).toString().padStart(2, '0')

  const grouped = dollars.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${negative ? '-' : ''}$${grouped}.${remainder}`
}

/**
 * A date written out in full, with no room for the American and British forms to
 * be confused: `2026-09-03` becomes `3 September 2026`.
 *
 * Takes the plain year-month-day text, not a date object. A date object carries a
 * time and a time zone, and turning one back into a day can move it by one across
 * midnight. A document dated a day out is a document a careful reader stops
 * trusting, and the fix is to never let the ambiguity in.
 */
export function asWrittenDate(isoDay: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDay)) {
    throw new UnusableNumber(
      `A date for a document must be written as year-month-day, such as ` +
        `"2026-09-03". Got "${isoDay}". The service that builds the document reads ` +
        `dates differently depending on where the reader is, and fails silently ` +
        `when it gets one it cannot read, so the finished text is prepared here.`,
    )
  }

  // Checked against the real length of that month in that year, not against 31.
  // Until 30 August 2026 this accepted "2026-02-31" and printed it into a legal
  // document as "31 February 2026". The leap-year rule lives in one place now,
  // because a rule written twice is a rule that drifts.
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ]
  const [year, month, day] = isoDay.split('-') as [string, string, string]
  const monthName = months[Number(month) - 1]

  if (monthName === undefined) {
    throw new UnusableNumber(`"${isoDay}" is not a real date. There is no month ${Number(month)}.`)
  }

  // Checked against the real length of that month in that year, not against 31.
  // Until 30 August 2026 this accepted "2026-02-31" and would have printed it into
  // a legal document as "31 February 2026". The leap-year rule lives in one place
  // now, in src/dates.ts, because a rule written twice is a rule that drifts.
  if (!isRealDate(isoDay)) {
    throw new UnusableNumber(
      `"${isoDay}" is not a real date. ${monthName} ${year} had ` +
        `${daysInMonth(Number(year), Number(month))} days.`,
    )
  }

  return `${Number(day)} ${monthName} ${year}`
}

/**
 * How many basis points a vote needs to carry, rounded the safe way.
 *
 * "A majority" of a two-owner company holding half each is a real problem, and the
 * rounding direction is the whole of it. A threshold rounded DOWN can be met by
 * less than the fraction the agreement names, which means the document says one
 * thing and permits another. So this always rounds UP: a threshold is the smallest
 * holding that genuinely satisfies it.
 *
 * `numerator` and `denominator` are whole numbers, so "two thirds" is (2, 3) and
 * not 0.6666666666666666.
 */
export function voteThreshold(numerator: number, denominator: number): BasisPoints {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || denominator <= 0) {
    throw new UnusableNumber(
      `A vote threshold is a whole-number fraction, such as two thirds written as ` +
        `(2, 3). Got (${numerator}, ${denominator}).`,
    )
  }
  if (numerator <= 0 || numerator > denominator) {
    throw new UnusableNumber(
      `A vote threshold must be more than none and no more than all. Got ` +
        `${numerator}/${denominator}.`,
    )
  }

  const scaled = BigInt(numerator) * WHOLE
  const divisor = BigInt(denominator)
  const exact = scaled / divisor
  return scaled % divisor === 0n ? exact : exact + 1n
}

/**
 * One voting rule, as a number the arithmetic can use and as words the document
 * prints.
 *
 * Both, because they are not the same thing. The smallest holding that carries a
 * simple majority is 50.01%, and no agreement in the world says "50.01%". It says
 * "more than fifty percent". Printing the number would be technically right and
 * would read as though a lawyer had never seen it; printing only the words would
 * leave nothing to check the shares against.
 */
export interface VoteRule {
  /** The smallest holding, in basis points, that carries the vote. */
  readonly carriesAt: BasisPoints
  /** How the fraction is written in the document. */
  readonly wording: string
  /** True when exactly the fraction is NOT enough, and it has to be beaten. */
  readonly mustBeat: boolean
}

/**
 * A vote that carries only on MORE than this fraction.
 *
 * THE BUG THIS FIXES, BECAUSE IT IS WORTH WRITING DOWN
 *
 * Until 30 August 2026 an ordinary decision was set at exactly one half — 5,000
 * basis points — and the test was "holds at least this much". In the most common
 * two-owner business, fifty percent each, **either owner alone met it**. The same
 * document also included a deadlock article, on the ground that these shares allow
 * an exact tie.
 *
 * So the document said two things that cannot both be true: that a tie is possible
 * and needs resolving, and that either owner can carry any ordinary decision on
 * their own. Both sentences read perfectly. Only the arithmetic showed it.
 *
 * A majority means more than half. It has always meant more than half. The
 * smallest whole basis-point holding that beats a half is 5,001.
 */
export function moreThan(numerator: number, denominator: number): VoteRule {
  const exactly = fractionOf(numerator, denominator)
  return {
    carriesAt: exactly + 1n,
    wording: `more than ${asPercent(exactly)}`,
    mustBeat: true,
  }
}

/**
 * A vote that carries on this fraction OR MORE.
 *
 * The ordinary form for the decisions an agreement singles out as important —
 * "two-thirds or more" — where landing exactly on the fraction is meant to carry.
 * Rounded UP, so a threshold is the smallest holding that genuinely satisfies it:
 * rounding down would let less than the named fraction carry a decision the
 * document says needs that fraction.
 */
export function atLeast(numerator: number, denominator: number): VoteRule {
  const smallest = voteThreshold(numerator, denominator)
  return {
    carriesAt: smallest,
    wording: `at least ${asPercent(smallest)}`,
    mustBeat: false,
  }
}

/** The fraction itself in basis points, when it divides exactly; rounded down when not. */
function fractionOf(numerator: number, denominator: number): BasisPoints {
  if (
    !Number.isInteger(numerator) ||
    !Number.isInteger(denominator) ||
    denominator <= 0 ||
    numerator <= 0 ||
    numerator > denominator
  ) {
    throw new UnusableNumber(
      `A vote fraction is a whole-number fraction, more than none and no more than ` +
        `all, such as one half written as (1, 2). Got (${numerator}, ${denominator}).`,
    )
  }
  return (BigInt(numerator) * WHOLE) / BigInt(denominator)
}

/** Whether a holding of this many basis points carries a vote under this rule. */
export function carries(rule: VoteRule, held: BasisPoints): boolean {
  return held >= rule.carriesAt
}
