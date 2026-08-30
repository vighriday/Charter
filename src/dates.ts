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
