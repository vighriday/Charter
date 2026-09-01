/**
 * How often a stranger may start a run from the website, and what a refusal says.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS
 *
 * Charter can be run from its own website by anybody, using our keys. That is the
 * only honest way to let somebody try it. It also means a stranger spends our
 * allowance, and the tightest one is 250 web searches a MONTH against about twelve
 * for a single run. An afternoon of somebody refreshing a page would end the month
 * — including for whoever is judging this next week.
 *
 * So the limits are not a nicety. They are what makes it possible to leave this
 * open to everybody rather than to nobody, and every one of them is tested here.
 *
 * THE OTHER HALF: A REFUSAL HAS TO BE USEFUL
 *
 * "Try again later" tells somebody nothing, so they try again immediately, which
 * is the behaviour a limit exists to prevent. Every refusal names the limit, says
 * why that limit is there, and gives the moment it lifts. These tests check that,
 * because a refusal that explains nothing is a bug even when the arithmetic is
 * right.
 */

import { describe, expect, it } from 'vitest'

import {
  Limits,
  nextDay,
  dayOf,
  DEFAULT_ALLOWANCE,
  DAYS_IT_IS_SIZED_FOR,
  SEARCHES_A_RUN,
  SEARCHES_A_MONTH,
} from '../src/serve/limits.js'

const ALLOWANCE = { perVisitorPerDay: 2, perDay: 3, atOnce: 1, quietSeconds: 60 }
const SECRET = Buffer.from('a fixed secret so a test is repeatable', 'utf8')

/** A clock somebody else moves. */
function clockFrom(start: string): { now: () => Date; goForward: (seconds: number) => void } {
  let at = new Date(start).getTime()
  return {
    now: () => new Date(at),
    goForward: (seconds) => {
      at += seconds * 1000
    },
  }
}

function limitsAt(start = '2026-09-01T09:00:00.000Z'): {
  limits: Limits
  goForward: (seconds: number) => void
} {
  const clock = clockFrom(start)
  return {
    limits: new Limits({ allowance: ALLOWANCE, now: clock.now, secret: SECRET }),
    goForward: clock.goForward,
  }
}

describe('who may start a run', () => {
  it('lets somebody start when nothing is in the way', () => {
    const { limits } = limitsAt()
    const decision = limits.start(limits.code('1.2.3.4'))

    expect(decision.allowed).toBe(true)
  })

  it('runs one at a time, and says why rather than just no', () => {
    const { limits } = limitsAt()
    limits.start(limits.code('1.2.3.4'))

    const second = limits.start(limits.code('5.6.7.8'))

    expect(second.allowed).toBe(false)
    if (second.allowed) return
    // The reason matters: two at once is how both model providers refuse us at
    // the same moment, which is a worse outcome than one person waiting.
    expect(second.because).toMatch(/one at a time/i)
    expect(second.because).toMatch(/minute/i)
  })

  it('gives the place back when a run finishes', () => {
    const { limits, goForward } = limitsAt()
    limits.start(limits.code('1.2.3.4'))
    limits.finished()
    goForward(120)

    expect(limits.start(limits.code('5.6.7.8')).allowed).toBe(true)
  })

  it('never lets the count of what is going fall below nothing', () => {
    // A run reported finished twice happens: it ends, and then a timer fires as
    // well. If that took the count below zero, the next few visitors would all be
    // let in at once, which is the one thing this exists to stop.
    const { limits } = limitsAt()
    limits.finished()
    limits.finished()
    limits.start(limits.code('1.2.3.4'))

    expect(limits.goingNow()).toBe(1)
    expect(limits.start(limits.code('9.9.9.9')).allowed).toBe(false)
  })
})

describe('the limit for one person', () => {
  it('makes one person wait between their own runs, and counts down out loud', () => {
    const { limits, goForward } = limitsAt()
    const me = limits.code('1.2.3.4')
    limits.start(me)
    limits.finished()
    goForward(10)

    const again = limits.start(me)

    expect(again.allowed).toBe(false)
    if (again.allowed) return
    expect(again.because).toMatch(/50 seconds to go/)
  })

  it('stops one person taking the whole day', () => {
    const { limits, goForward } = limitsAt()
    const me = limits.code('1.2.3.4')

    for (let i = 0; i < ALLOWANCE.perVisitorPerDay; i += 1) {
      limits.start(me)
      limits.finished()
      goForward(ALLOWANCE.quietSeconds + 1)
    }

    const third = limits.start(me)
    expect(third.allowed).toBe(false)
    if (third.allowed) return
    expect(third.because).toMatch(/most one person can/i)
    // And somebody else is still welcome. A per-person limit that stopped everybody
    // would be a per-day limit wearing the wrong name.
    expect(limits.start(limits.code('5.6.7.8')).allowed).toBe(true)
  })

  it('tells somebody who has run out of turns that their files are still there', () => {
    const { limits, goForward } = limitsAt()
    const me = limits.code('1.2.3.4')
    for (let i = 0; i < ALLOWANCE.perVisitorPerDay; i += 1) {
      limits.start(me)
      limits.finished()
      goForward(ALLOWANCE.quietSeconds + 1)
    }

    const refused = limits.start(me)
    expect(refused.allowed).toBe(false)
    if (refused.allowed) return
    expect(refused.because).toMatch(/still there to download/i)
  })
})

describe('the limit for everybody together', () => {
  it('stops the day when the day is spent, and explains the month behind it', () => {
    const { limits, goForward } = limitsAt()

    // Three different people, because one person would hit their own limit first.
    for (const who of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) {
      limits.start(limits.code(who))
      limits.finished()
      goForward(1)
    }

    const fourth = limits.start(limits.code('4.4.4.4'))
    expect(fourth.allowed).toBe(false)
    if (fourth.allowed) return
    expect(fourth.because).toMatch(/250/)
    expect(fourth.because).toMatch(/MONTH/)
    expect(fourth.liftsAt.toISOString()).toBe('2026-09-02T00:00:00.000Z')
  })

  it('starts again at midnight', () => {
    const { limits, goForward } = limitsAt()
    for (const who of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) {
      limits.start(limits.code(who))
      limits.finished()
      goForward(1)
    }
    expect(limits.leftToday()).toBe(0)

    goForward(24 * 60 * 60)

    expect(limits.leftToday()).toBe(ALLOWANCE.perDay)
    expect(limits.start(limits.code('1.1.1.1')).allowed).toBe(true)
  })
})

describe('what is kept about a visitor', () => {
  it('turns an address into a code that is not the address', () => {
    const { limits } = limitsAt()
    const code = limits.code('203.0.113.7')

    expect(code).not.toContain('203')
    expect(code).toMatch(/^[0-9a-f]{16}$/)
  })

  it('gives the same visitor the same code, so counting works at all', () => {
    const { limits } = limitsAt()
    expect(limits.code('203.0.113.7')).toBe(limits.code('203.0.113.7'))
    expect(limits.code('203.0.113.7')).not.toBe(limits.code('203.0.113.8'))
  })

  it('gives different codes in a different program, so nothing outlives it', () => {
    // The secret is invented when the program starts and never written down. Two
    // programs cannot agree on what any code means, so a code cannot follow
    // somebody from one day to the next.
    const one = new Limits({ allowance: ALLOWANCE, secret: Buffer.from('one') })
    const other = new Limits({ allowance: ALLOWANCE, secret: Buffer.from('another') })

    expect(one.code('203.0.113.7')).not.toBe(other.code('203.0.113.7'))
  })
})

describe('asking without using up a turn', () => {
  it('does not count anything when it is only asked', () => {
    const { limits } = limitsAt()
    const me = limits.code('1.2.3.4')

    limits.mayStart(me)
    limits.mayStart(me)
    limits.mayStart(me)

    expect(limits.leftToday()).toBe(ALLOWANCE.perDay)
  })
})

describe('the days themselves', () => {
  it('midnight is the next one, not this one', () => {
    expect(nextDay(new Date('2026-09-01T23:59:59.000Z')).toISOString()).toBe(
      '2026-09-02T00:00:00.000Z',
    )
    expect(nextDay(new Date('2026-09-01T00:00:00.000Z')).toISOString()).toBe(
      '2026-09-02T00:00:00.000Z',
    )
  })

  it('a day is a date', () => {
    expect(dayOf(new Date('2026-09-01T23:59:59.000Z'))).toBe('2026-09-01')
  })
})

describe('the numbers this ships with', () => {
  it('runs one at a time, because two is how both providers refuse at once', () => {
    expect(DEFAULT_ALLOWANCE.atOnce).toBe(1)
  })

  it('holds the whole event inside the month it is spending', () => {
    // This is the check that caught the shipped number being wrong. It was eight a
    // day, with a comment claiming that came to ninety-six searches. It comes to
    // 288, against a monthly allowance of 250, and the comment had been written to
    // justify the number rather than to check it.
    //
    // Done as multiplication rather than as a sentence, so the next person to
    // raise the number finds out what it costs.
    const searchesOverTheEvent =
      DEFAULT_ALLOWANCE.perDay * SEARCHES_A_RUN * DAYS_IT_IS_SIZED_FOR

    expect(searchesOverTheEvent).toBeLessThan(SEARCHES_A_MONTH)
  })
})
