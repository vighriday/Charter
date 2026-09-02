/**
 * Whether a written date is a day that actually happened.
 *
 * WHY THIS IS ITS OWN FILE
 *
 * Two parts of Charter need the same answer and got it in two different ways. The
 * identity review had the full rule. The agreement writer checked only that the day
 * was between 1 and 31, so **31 February 2026** passed and would have been printed
 * into a legal document as "31 February 2026".
 *
 * A leap-year rule written twice is a leap-year rule that drifts. This is the one
 * copy, and both callers use it.
 *
 * WHY THE FULL LEAP-YEAR RULE AND NOT THE SHORT ONE
 *
 * The short version — a year divisible by four is a leap year — was wrong in 1900
 * and will be wrong again in 2100. Identity documents carry dates of birth from the
 * whole of the last century and expiry dates decades ahead, so both of those years
 * are inside the range this has to be right about.
 *
 * The full rule: divisible by four is a leap year, EXCEPT centuries, EXCEPT every
 * fourth century. So 1900 was not, 2000 was.
 *
 * WHY DATES ARE NOT PARSED WITH THE BUILT-IN DATE
 *
 * `new Date('2026-02-31')` does not fail. It rolls forward to 3 March and hands
 * back a date that looks completely ordinary. Anything built on that would turn a
 * typing mistake into a different, plausible, wrong date rather than into an error.
 */

/** The number of days in each month, with February left to be worked out. */
const LENGTHS: readonly number[] = [31, 0, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/** Whether this year has a 29th of February. */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/** How many days that month had in that year. */
export function daysInMonth(year: number, month: number): number {
  if (month < 1 || month > 12) return 0
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return LENGTHS[month - 1] as number
}

/**
 * Whether text is a real year-month-day date.
 *
 * Written out as characters rather than handed to a date library, so no locale is
 * involved: "03/09/2026" means two different days depending on where the reader
 * is, and "2026-09-03" means one day everywhere.
 */
export function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false

  const [year, month, day] = value.split('-').map(Number) as [number, number, number]
  if (day < 1) return false

  return day <= daysInMonth(year, month)
}

// ─────────────────────────────────────────────────────────────────────────────
// Dates as they are written on somebody else's document
// ─────────────────────────────────────────────────────────────────────────────

const MONTH_NAMES: Readonly<Record<string, number>> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
}

/** What reading a date off a document produced. */
export type DateOnADocument =
  /** Read, and turned into one day everybody would agree on. */
  | { readonly kind: 'read'; readonly day: string }
  /**
   * Written in a way that means two different days depending on who reads it.
   *
   * Not an error and not a pass. It is the answer that sends the value to a
   * person, which is the only correct answer to a genuinely ambiguous date.
   */
  | { readonly kind: 'ambiguous'; readonly why: string }
  /** Not a date at all, or a day that never happened. */
  | { readonly kind: 'unreadable'; readonly why: string }

/**
 * Read a date the way it is written on an identity document.
 *
 * WHY THIS IS NOT THE SAME AS `isRealDate`
 *
 * `isRealDate` asks whether text Charter WROTE is a real day. Charter writes
 * year-month-day and nothing else, so that check can be strict about the shape.
 *
 * This asks about text somebody ELSE wrote, on a document Charter did not design.
 * A driving licence says "16 JAN 1975". A passport says "16 JAN 75". Neither is
 * wrong, and a checker that only understands year-month-day reports every real
 * document as unreadable — which sends every date on every document to a person
 * for the wrong reason, and trains whoever reads those to stop looking.
 *
 * THE RULE ABOUT DATES WRITTEN ALL IN NUMBERS
 *
 * "03/09/2026" is the third of September in most of the world and the ninth of
 * March in the United States. There is no way to tell which from the text, and
 * both readings are ordinary dates, so a wrong guess produces a plausible wrong
 * date rather than an error anybody would notice.
 *
 * So Charter does not guess. A date written all in numbers comes back as
 * ambiguous, and a person looks at the document and says which it is. That is the
 * whole argument of this project applied to four characters: where the software
 * cannot know, it must say so rather than pick.
 *
 * A month written in letters has no such problem, so those are read.
 */
export function dateOnADocument(value: string): DateOnADocument {
  const text = value.trim()
  if (text === '') return { kind: 'unreadable', why: 'there was nothing there' }

  // ---- year-month-day, which means one day everywhere ------------------------
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return isRealDate(text)
      ? { kind: 'read', day: text }
      : { kind: 'unreadable', why: `${text} is not a day that happened` }
  }

  // ---- a month written in letters, in either order ---------------------------
  const named =
    /^(\d{1,2})[\s.\-/]+([A-Za-z]{3,9})[\s.\-/]+(\d{2}|\d{4})$/.exec(text) ??
    reorder(/^([A-Za-z]{3,9})[\s.\-/]+(\d{1,2})[\s.\-/,]+(\d{2}|\d{4})$/.exec(text))

  if (named !== null) {
    const day = Number(named[1])
    const month = MONTH_NAMES[(named[2] as string).toLowerCase()]
    const year = fullYear(named[3] as string)

    if (month === undefined) {
      return { kind: 'unreadable', why: `"${named[2]}" is not a month` }
    }
    if (day < 1 || day > daysInMonth(year, month)) {
      return { kind: 'unreadable', why: `${text} is not a day that happened` }
    }

    return {
      kind: 'read',
      day: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    }
  }

  // ---- all numbers, which is where the guessing would start ------------------
  if (/^\d{1,2}[\s.\-/]\d{1,2}[\s.\-/](\d{2}|\d{4})$/.test(text)) {
    return {
      kind: 'ambiguous',
      why:
        `"${text}" is written all in numbers, so the first two numbers could be ` +
        `the day and the month or the month and the day. Those are two different ` +
        `days and both of them are ordinary dates, so guessing would produce a ` +
        `wrong date nobody would notice. A person has to say which it is.`,
    }
  }

  return { kind: 'unreadable', why: `"${text}" is not written like a date` }
}

/** Put a month-first match into day, month, year order. */
function reorder(match: RegExpExecArray | null): RegExpExecArray | null {
  if (match === null) return null
  const swapped = [match[0], match[2], match[1], match[3]] as unknown as RegExpExecArray
  return swapped
}

/**
 * Two digits of a year turned into four.
 *
 * A document written with two digits is read against a window rather than
 * assuming this century: "75" on a date of birth is 1975, not 2075. The turn is
 * put well ahead of today so that an expiry date decades away still reads
 * forwards, and a date of birth still reads backwards.
 */
function fullYear(written: string): number {
  const year = Number(written)
  if (written.length === 4) return year
  return year <= 40 ? 2000 + year : 1900 + year
}
