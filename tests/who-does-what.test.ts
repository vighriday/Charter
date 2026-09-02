/**
 * The list of outside companies, and the rules that keep it honest.
 *
 * WHY A TEST AND NOT JUST A LIST
 *
 * This list is the single most tempting thing in the project to shade. It is the
 * page a judge reads to find out what Charter really does, and every entry on it
 * has a version that sounds better than the truth. "We use their signing service"
 * is one word away from "we wrote a client for their signing service and have
 * never once called it", and the first is what somebody in a hurry writes.
 *
 * So the shape of an entry is enforced. A company cannot be added without saying
 * what it is never used for. A company cannot be called live without naming a
 * command that proves it. The words for the three states are fixed, so a fourth,
 * vaguer one cannot appear.
 *
 * WHAT MADE THE MIDDLE STATE NECESSARY
 *
 * One client here sat looking finished for weeks: written from the documentation,
 * covered by tests that passed, and wrong in three separate ways at once. Wrong
 * endpoint, wrong request, wrong reply shape. Every one of them was invisible to a
 * green suite, because the tests handed the client an answer of the shape the
 * client already expected. The first real call found all three in ten minutes.
 *
 * "Written" and "working" are different facts. This file is what stops them being
 * written down as the same one.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

import {
  OUTSIDE_COMPANIES,
  inRunOrder,
  howManyAreLive,
  type ServiceState,
} from '../src/vendors/who-does-what.js'

const STATES: readonly ServiceState[] = ['live', 'written, not proven', 'not built']

describe('every entry', () => {
  it('says what it is never used for', () => {
    // Never empty, on purpose. Every one of these companies sells more than
    // Charter touches, and one of them sells face analysis. Saying which parts
    // are refused is more informative than saying which parts are used, because
    // the second is a feature list and the first is a boundary.
    for (const one of OUTSIDE_COMPANIES) {
      expect(one.neverUsed.length, `${one.company} says nothing it refuses`).toBeGreaterThan(0)
    }
  })

  it('says what it sends and what comes back', () => {
    for (const one of OUTSIDE_COMPANIES) {
      expect(one.whatWeSend.length, `${one.company}`).toBeGreaterThan(0)
      expect(one.whatComesBack.length, `${one.company}`).toBeGreaterThan(0)
    }
  })

  it('points at code somebody can go and read', () => {
    for (const one of OUTSIDE_COMPANIES) {
      expect(one.code.length, `${one.company}`).toBeGreaterThan(0)
      for (const path of one.code) {
        expect(path.startsWith('src/'), `${one.company}: ${path}`).toBe(true)
      }
    }
  })

  it('uses one of exactly three words for its state', () => {
    // Fixed so that a fourth, vaguer word cannot appear. "Partially integrated"
    // is the word somebody reaches for when the honest answer is "not proven".
    for (const one of OUTSIDE_COMPANIES) {
      expect(STATES, `${one.company}`).toContain(one.state)
    }
  })

  it('has a name and an address a reader can check', () => {
    for (const one of OUTSIDE_COMPANIES) {
      expect(one.company.trim().length).toBeGreaterThan(0)
      expect(one.host, `${one.company}`).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/)
    }
  })
})

describe('what each state has to carry with it', () => {
  it('never says live without a command that proves it', () => {
    // The whole weight of this page rests on that word. Anything claiming it has
    // to name something a stranger can run.
    for (const one of OUTSIDE_COMPANIES) {
      if (one.state !== 'live') continue
      expect(one.seeItYourself, `${one.company} is called live and proves nothing`).toBeTruthy()
      expect(one.seeItYourself as string).toMatch(/^npm /)
    }
  })

  it('never says written or not built without saying what is still not true', () => {
    for (const one of OUTSIDE_COMPANIES) {
      if (one.state === 'live') continue
      expect(
        one.stillNotTrue,
        `${one.company} is not live and does not say what is missing`,
      ).toBeTruthy()
    }
  })

  it('says out loud, in the entry, that a client has never been called', () => {
    for (const one of OUTSIDE_COMPANIES) {
      if (one.state !== 'written, not proven') continue
      expect(one.stillNotTrue as string, one.company).toMatch(/never been called/i)
    }
  })
})

describe('the order the list is read in', () => {
  it('walks a run from the first step to the last', () => {
    const steps = inRunOrder()
      .map((one) => one.step)
      .filter((step) => step !== 0)

    expect([...steps].sort((a, b) => a - b)).toEqual(steps)
  })

  it('puts the two models last, because they are used in every step', () => {
    const order = inRunOrder()
    const lastTwo = order.slice(-2)
    expect(lastTwo.every((one) => one.step === 0)).toBe(true)
  })

  it('loses nobody', () => {
    expect(inRunOrder()).toHaveLength(OUTSIDE_COMPANIES.length)
  })
})

describe('the file the website reads', () => {
  const generated = readFileSync('site/services.js', 'utf8')

  it('is generated, and says so', () => {
    expect(generated).toContain('Generated from src/vendors/who-does-what.ts')
    expect(generated).toContain('Do not edit by hand')
  })

  it('holds every company the code holds', () => {
    const held = JSON.parse(generated.slice(generated.indexOf('{'))) as {
      companies: { company: string }[]
      live: number
    }

    expect(held.companies.map((one) => one.company).sort()).toEqual(
      OUTSIDE_COMPANIES.map((one) => one.company).sort(),
    )
    expect(held.live).toBe(howManyAreLive())
  })

  it('carries the awkward parts as well as the good ones', () => {
    // The specific failure this guards: somebody regenerating the page from a
    // trimmed list, so that the companies which have never been called quietly
    // stop appearing on it.
    //
    // Read out of the code rather than written here, so this keeps working when a
    // state empties out. A hard-written state name would either pass forever or
    // fail on the happy day the last one turned live.
    const awkward = OUTSIDE_COMPANIES.filter((one) => one.state !== 'live')

    for (const one of awkward) {
      expect(generated, `${one.company} is missing from the page`).toContain(one.company)
      expect(generated, `${one.company} does not say what is not true`).toContain(
        one.stillNotTrue as string,
      )
    }
  })

  it('carries what every company refuses to do', () => {
    // The column a feature list would not have. It is the most useful thing on
    // the page and the easiest thing to leave off it.
    for (const one of OUTSIDE_COMPANIES) {
      expect(generated, `${one.company}`).toContain(one.neverUsed[0] as string)
    }
  })
})
