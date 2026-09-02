/**
 * Proving that a date printed into a legal document is a day that happened.
 *
 * WHAT WENT WRONG
 *
 * Two parts of Charter needed the same answer and got it two different ways. The
 * identity review had the full rule. The agreement writer checked only that the day
 * was between 1 and 31, so **31 February 2026** passed every check and would have
 * been printed into an ownership agreement as "31 February 2026".
 *
 * A leap-year rule written twice is a leap-year rule that drifts. There is one copy
 * now, and both callers use it.
 *
 * WHY THE BUILT-IN DATE IS NOT USED
 *
 * `new Date('2026-02-31')` does not fail. It rolls forward to 3 March and hands
 * back a date that looks completely ordinary. Anything built on that turns a typing
 * mistake into a different, plausible, wrong date rather than into an error — and a
 * wrong date on an agreement is not a typing mistake, it is a term.
 */

import { describe, expect, it } from 'vitest'
import { dateOnADocument, daysInMonth, isLeapYear, isRealDate } from '../src/dates.js'
import { asWrittenDate } from '../src/agreement/numbers.js'
import { UnusableNumber } from '../src/agreement/numbers.js'

describe('leap years, the full rule and not the short one', () => {
  it('says yes to a year divisible by four', () => {
    expect(isLeapYear(2024)).toBe(true)
    expect(isLeapYear(2028)).toBe(true)
  })

  it('says no to an ordinary year', () => {
    expect(isLeapYear(2026)).toBe(false)
  })

  it('says no to 1900, which the short rule gets wrong', () => {
    // A century is not a leap year. Identity documents carry dates of birth from
    // the whole of the last century, so this is inside the range that has to be
    // right rather than a curiosity.
    expect(isLeapYear(1900)).toBe(false)
  })

  it('says yes to 2000, which the short correction also gets wrong', () => {
    // Except every fourth century. 2000 was a leap year.
    expect(isLeapYear(2000)).toBe(true)
  })

  it('says no to 2100, which is inside the life of a passport issued today', () => {
    expect(isLeapYear(2100)).toBe(false)
  })
})

describe('how long each month is', () => {
  it('knows February in both kinds of year', () => {
    expect(daysInMonth(2026, 2)).toBe(28)
    expect(daysInMonth(2024, 2)).toBe(29)
    expect(daysInMonth(1900, 2)).toBe(28)
    expect(daysInMonth(2000, 2)).toBe(29)
  })

  it('knows the thirty-day months', () => {
    for (const month of [4, 6, 9, 11]) expect(daysInMonth(2026, month), String(month)).toBe(30)
  })

  it('knows the thirty-one-day months', () => {
    for (const month of [1, 3, 5, 7, 8, 10, 12]) {
      expect(daysInMonth(2026, month), String(month)).toBe(31)
    }
  })

  it('returns nothing usable for a month that does not exist', () => {
    expect(daysInMonth(2026, 0)).toBe(0)
    expect(daysInMonth(2026, 13)).toBe(0)
  })
})

describe('whether text is a real date', () => {
  it('accepts an ordinary one', () => {
    expect(isRealDate('2026-09-03')).toBe(true)
  })

  it('refuses the thirty-first of February, which is the bug this fixes', () => {
    expect(isRealDate('2026-02-31')).toBe(false)
  })

  it('refuses the twenty-ninth of February in an ordinary year', () => {
    expect(isRealDate('2026-02-29')).toBe(false)
    expect(isRealDate('2024-02-29')).toBe(true)
  })

  it('refuses the thirty-first of a thirty-day month', () => {
    expect(isRealDate('2026-04-31')).toBe(false)
    expect(isRealDate('2026-06-31')).toBe(false)
  })

  it('refuses a month that does not exist', () => {
    expect(isRealDate('2026-13-01')).toBe(false)
    expect(isRealDate('2026-00-01')).toBe(false)
  })

  it('refuses a day of zero', () => {
    expect(isRealDate('2026-09-00')).toBe(false)
  })

  it('refuses anything not written as year-month-day', () => {
    // "03/09/2026" means two different days depending on where the reader is.
    // "2026-09-03" means one day everywhere, which is the whole reason for the shape.
    for (const written of ['03/09/2026', 'September 3, 2026', '2026-9-3', '20260903', '']) {
      expect(isRealDate(written), written).toBe(false)
    }
  })
})

describe('the date as it is written into an agreement', () => {
  it('writes it the way a person reads it', () => {
    expect(asWrittenDate('2026-09-03')).toBe('3 September 2026')
  })

  it('drops the leading zero on the day, as a person would', () => {
    expect(asWrittenDate('2026-09-03')).not.toContain('03')
  })

  it('refuses a day that never happened, and says how long that month was', () => {
    // Before 30 August 2026 this returned "31 February 2026", which would have gone
    // into a document somebody signs.
    expect(() => asWrittenDate('2026-02-31')).toThrow(UnusableNumber)
    expect(() => asWrittenDate('2026-02-31')).toThrow(/February 2026 had 28 days/)
  })

  it('refuses a month that never happened, and says so differently', () => {
    expect(() => asWrittenDate('2026-13-01')).toThrow(/no month 13/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Dates as they are written on somebody else's document
// ─────────────────────────────────────────────────────────────────────────────

/*
  WHY THIS SECTION EXISTS

  Charter writes dates as year-month-day, and the rule above is strict about that
  because Charter controls what it writes.

  An identity document is written by somebody else. A driving licence says
  "16 JAN 1975". The first time the real reading service was called, it read that
  perfectly, and Charter's own check then reported it as "not a date that can be
  read" — so every date on every real document went to a person for the wrong
  reason. A checker that cries wolf on every document teaches whoever reads its
  output to stop looking, which is worse than not checking.

  THE ONE THAT MUST NOT BE GUESSED

  "03/09/2026" is the third of September in most of the world and the ninth of
  March in the United States. Both readings are ordinary dates, so a wrong guess
  produces a plausible wrong date that nobody notices. Charter does not guess. It
  says the document does not say, and a person looks.
*/

describe('reading a date off somebody else’s document', () => {
  it('reads year-month-day, which means one day everywhere', () => {
    expect(dateOnADocument('2026-09-03')).toEqual({ kind: 'read', day: '2026-09-03' })
  })

  it('reads a month written in letters, day first', () => {
    for (const written of ['16 JAN 1975', '16 Jan 1975', '16-JAN-1975', '16/january/1975']) {
      expect(dateOnADocument(written), written).toEqual({ kind: 'read', day: '1975-01-16' })
    }
  })

  it('reads a month written in letters, month first', () => {
    for (const written of ['JAN 16 1975', 'January 16, 1975']) {
      expect(dateOnADocument(written), written).toEqual({ kind: 'read', day: '1975-01-16' })
    }
  })

  it('turns two digits of a year into four, in the direction a person would', () => {
    // "75" on a date of birth is 1975, not 2075. The turn sits well ahead of today
    // so an expiry date decades away still reads forwards.
    expect(dateOnADocument('16 JAN 75')).toEqual({ kind: 'read', day: '1975-01-16' })
    expect(dateOnADocument('16 JAN 34')).toEqual({ kind: 'read', day: '2034-01-16' })
  })

  it('refuses to guess at a date written all in numbers', () => {
    // The whole argument of this project, applied to four characters.
    const read = dateOnADocument('03/09/2026')
    expect(read.kind).toBe('ambiguous')
    expect(read.kind === 'ambiguous' && read.why).toMatch(/two different days/)
  })

  it('treats every separator between numbers the same way', () => {
    for (const written of ['03/09/2026', '03-09-2026', '03.09.2026', '03 09 2026']) {
      expect(dateOnADocument(written).kind, written).toBe('ambiguous')
    }
  })

  it('refuses a day that never happened, however it was written', () => {
    expect(dateOnADocument('31 FEB 2026').kind).toBe('unreadable')
    expect(dateOnADocument('29 FEB 1900').kind, '1900 was not a leap year').toBe('unreadable')
    expect(dateOnADocument('29 FEB 2000').kind, '2000 was').toBe('read')
    expect(dateOnADocument('2026-02-31').kind).toBe('unreadable')
  })

  it('says plainly when there is no date there at all', () => {
    for (const written of ['', '   ', 'nonsense', 'SPECIMEN-731A984F']) {
      expect(dateOnADocument(written).kind, written).toBe('unreadable')
    }
  })

  it('refuses a month that is not a month', () => {
    const read = dateOnADocument('16 XYZ 1975')
    expect(read.kind).toBe('unreadable')
  })
})
