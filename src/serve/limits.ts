/**
 * How often a stranger on the internet may start a run, and why the numbers are
 * this small.
 *
 * WHAT THIS IS FOR
 *
 * Charter can be run from its own website by anybody, using our keys. That is the
 * only honest way to let somebody try it: asking a visitor to sign up to four
 * companies before they can see anything is the same as not letting them try it.
 *
 * It also means a stranger spends our allowance. Not money — nothing here has a
 * card attached — but every one of the free allowances behind this project is
 * small, and some of them are monthly.
 *
 * WHAT IS ACTUALLY SCARCE, IN THE ORDER IT RUNS OUT
 *
 *   1. Web search: 250 searches a month, and one run uses between eight and
 *      twelve. That is about twenty runs a MONTH, and it is by far the tightest
 *      thing here. Everything else could be generous and this would still be the
 *      limit that bites first.
 *   2. Reading identity documents: 5,000 credits a month, fifteen per page.
 *   3. The models: a few hundred requests per model per day, back at midnight in
 *      the provider's own time zone. Counted separately, in src/model/allowance.ts,
 *      because that count has to hold for a run started from a terminal too.
 *   4. Requests per minute at the model providers. This is why two runs are never
 *      allowed to overlap: running two at once is the quickest way to be refused
 *      by both providers at the same moment.
 *
 * A company that refuses us is worse than a company we used carefully. Some of
 * these are demonstration accounts a person set up for us by hand, and being cut
 * off during judging for hammering them would be a self-inflicted wound.
 *
 * WHY A REFUSAL SAYS WHEN, AND NOT JUST NO
 *
 * "Try again later" tells somebody nothing, so they try again immediately, which
 * is the exact behaviour a limit exists to prevent. Every refusal here names the
 * limit that was reached, says why that limit exists, and gives the moment it
 * lifts.
 *
 * WHAT IS NOT KEPT
 *
 * Not the visitor's address. It is turned into a short code using a secret this
 * program invented when it started; the code is what gets counted; the address is
 * never written down. When the program stops, the secret is gone and the codes
 * mean nothing at all. Two visits from the same place count as the same visitor
 * while the program runs, and nothing that outlives it can be turned back into
 * anybody.
 */

import { createHash, randomBytes } from 'node:crypto'

/** The numbers, in one place, so they can be read without reading the code. */
export interface Allowance {
  /** Runs one visitor may start in a day. */
  readonly perVisitorPerDay: number
  /** Runs everybody together may start in a day. This protects the month. */
  readonly perDay: number
  /** Runs allowed to be going at the same moment. */
  readonly atOnce: number
  /** How long one visitor waits between starting one run and starting the next. */
  readonly quietSeconds: number
}

/** The search allowance, and what one run costs against it. */
export const SEARCHES_A_MONTH = 250
export const SEARCHES_A_RUN = 12

/**
 * The default numbers, and the reasoning behind the only one that is not obvious.
 *
 * `perDay` is deliberately more than the month divided by thirty. This is built
 * for a three-day event, and nobody visits on the other twenty-seven days.
 * Spreading the month evenly would turn away almost everybody who ever tries it
 * while the allowance quietly expired unused.
 *
 * So the number is set by the three days that matter: six runs a day, twelve
 * searches a run, three days, is 216 searches against a monthly allowance of 250.
 *
 * It was eight until a test did that arithmetic. Eight is 288, which is more than
 * the month holds, and the comment sitting above it claimed ninety-six — a number
 * that came from nowhere. Both the number and the sentence explaining it were
 * wrong at the same time, which is the ordinary way this happens: the sentence was
 * written to justify the number rather than to check it. The test is in
 * tests/limits.test.ts and it does the multiplication rather than reading the
 * comment.
 */
export const DEFAULT_ALLOWANCE: Allowance = {
  perVisitorPerDay: 2,
  perDay: 6,
  atOnce: 1,
  quietSeconds: 120,
}

/** How long the event this is sized for lasts, in days. */
export const DAYS_IT_IS_SIZED_FOR = 3

/** Allowed, or refused with the reason and the moment the refusal lifts. */
export type Decision =
  | { readonly allowed: true; readonly leftToday: number }
  | {
      readonly allowed: false
      /** Plain words: which limit, why it exists, and when it lifts. */
      readonly because: string
      /** When this particular refusal stops applying. */
      readonly liftsAt: Date
      /** How many runs everybody together has left today. */
      readonly leftToday: number
    }

interface VisitorCount {
  count: number
  lastStartedAt: number
}

/** The start of the next day, in universal time, after the moment given. */
export function nextDay(at: Date): Date {
  const next = new Date(at)
  next.setUTCHours(0, 0, 0, 0)
  next.setUTCDate(next.getUTCDate() + 1)
  return next
}

/** The day a moment falls in, written as a date, in universal time. */
export function dayOf(at: Date): string {
  return at.toISOString().slice(0, 10)
}

export class Limits {
  private readonly allowance: Allowance
  private readonly now: () => Date
  /** Invented when the program starts and never written anywhere. */
  private readonly secret: Buffer
  private readonly byVisitor = new Map<string, VisitorCount>()
  private today = ''
  private startedToday = 0
  private going = 0

  constructor(options?: {
    readonly allowance?: Allowance
    readonly now?: () => Date
    /** Only tests pass this, so the same address gives the same code twice. */
    readonly secret?: Buffer
  }) {
    this.allowance = options?.allowance ?? DEFAULT_ALLOWANCE
    this.now = options?.now ?? ((): Date => new Date())
    this.secret = options?.secret ?? randomBytes(32)
  }

  /**
   * A short code for a visitor, which cannot be turned back into an address.
   *
   * The address goes in, together with a secret this program invented, and sixteen
   * characters come out. Nothing keeps the address itself.
   */
  code(address: string): string {
    return createHash('sha256').update(this.secret).update(address).digest('hex').slice(0, 16)
  }

  /** How many runs everybody together has left today. */
  leftToday(): number {
    this.rollOver()
    return Math.max(0, this.allowance.perDay - this.startedToday)
  }

  /** How many runs are going right now. */
  goingNow(): number {
    return this.going
  }

  /** The numbers themselves, for a page that wants to say what the limits are. */
  numbers(): Allowance {
    return this.allowance
  }

  private rollOver(): void {
    const day = dayOf(this.now())
    if (day === this.today) return
    this.today = day
    this.startedToday = 0
    this.byVisitor.clear()
  }

  /**
   * May this visitor start a run right now?
   *
   * Asked and answered without changing anything, so a page can show somebody
   * where they stand without using up their turn to find out.
   */
  mayStart(visitorCode: string): Decision {
    this.rollOver()
    const at = this.now()
    const left = this.leftToday()

    if (this.going >= this.allowance.atOnce) {
      // Not a limit that lifts at a time of day, so there is no honest moment to
      // name. Naming a made-up one would be worse than saying plainly that it
      // depends on somebody else's run finishing.
      return {
        allowed: false,
        because:
          `Somebody else is running one right now, and Charter runs one at a time. ` +
          `Two at once is the fastest way to be refused by the model providers, ` +
          `whose free allowances are counted by the minute as well as by the day. ` +
          `This lifts when the run in front finishes, usually two or three minutes.`,
        liftsAt: at,
        leftToday: left,
      }
    }

    if (this.startedToday >= this.allowance.perDay) {
      return {
        allowed: false,
        because:
          `Everybody together has started ${this.allowance.perDay} runs today, which ` +
          `is what this account can afford. One run uses about ${SEARCHES_A_RUN} web ` +
          `searches, and the search allowance is ${SEARCHES_A_MONTH} a MONTH. Spending ` +
          `a month of it in one day would leave nothing for anybody else, including ` +
          `whoever looks at this next week. It starts again at midnight, universal time.`,
        liftsAt: nextDay(at),
        leftToday: 0,
      }
    }

    const seen = this.byVisitor.get(visitorCode)
    if (seen !== undefined) {
      if (seen.count >= this.allowance.perVisitorPerDay) {
        return {
          allowed: false,
          because:
            `You have started ${seen.count} runs today, which is the most one person ` +
            `can. The limit is per person so that one visitor cannot use up the day ` +
            `for everybody else. It starts again at midnight, universal time, and ` +
            `everything your runs produced is still there to download.`,
          liftsAt: nextDay(at),
          leftToday: left,
        }
      }

      const waited = (at.getTime() - seen.lastStartedAt) / 1000
      if (waited < this.allowance.quietSeconds) {
        const secondsLeft = Math.ceil(this.allowance.quietSeconds - waited)
        return {
          allowed: false,
          because:
            `You started a run ${Math.round(waited)} seconds ago. There is a ` +
            `${this.allowance.quietSeconds} second wait between one person's runs, so ` +
            `that a page left refreshing itself cannot spend the day by accident. ` +
            `${secondsLeft} seconds to go.`,
          liftsAt: new Date(at.getTime() + secondsLeft * 1000),
          leftToday: left,
        }
      }
    }

    return { allowed: true, leftToday: left }
  }

  /**
   * Write down that a run has started, if it is allowed to.
   *
   * Asking and counting are one call on purpose. Two separate calls leave a gap in
   * between, and two requests arriving in that gap are both told yes.
   */
  start(visitorCode: string): Decision {
    const decision = this.mayStart(visitorCode)
    if (!decision.allowed) return decision

    const at = this.now()
    const seen = this.byVisitor.get(visitorCode)

    this.byVisitor.set(visitorCode, {
      count: (seen?.count ?? 0) + 1,
      lastStartedAt: at.getTime(),
    })
    this.startedToday += 1
    this.going += 1

    return { allowed: true, leftToday: this.leftToday() }
  }

  /**
   * A run has finished, or failed, or been abandoned.
   *
   * Never counts below zero. A run reported finished twice — which happens when it
   * ends normally and then a timer fires as well — would otherwise leave the count
   * of what is going below the truth, and a count that drifts downwards eventually
   * lets everybody in at once, which is the one thing this exists to stop.
   */
  finished(): void {
    this.going = Math.max(0, this.going - 1)
  }
}
