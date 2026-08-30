/**
 * Proving that the real models can actually be assembled, without calling one.
 *
 * WHAT IS BEING PROVED
 *
 * Everything needed to talk to a real model existed in this project for days: two
 * providers, a router that tries them in order, a daily counter that refuses
 * before a free allowance is spent. Nothing put them together. Every test and the
 * demonstration used a written-out stand-in, which is right for them, and meant
 * the real path had never been assembled anywhere at all.
 *
 * That is a fair thing for somebody to be suspicious about: *does this only work
 * because everything is pretend?* These tests assemble the real thing, check what
 * came out, and never send a single request — no key is used, no network is
 * touched, and nothing is spent.
 *
 * WHAT IS DELIBERATELY NOT PROVED HERE
 *
 * That Google or Groq answer correctly. That needs their servers and their
 * allowances, and a test that quietly spent a daily allowance would be a test
 * nobody could afford to run twice.
 */

import { describe, expect, it } from 'vitest'
import { buildRouter, wouldCallOut, GEMINI_MODELS, GROQ_MODELS } from '../src/model/build.js'
import { DEFAULT_ROUTES, DEFAULT_FALLBACK } from '../src/model/router.js'
import { DEFAULT_SETTINGS, readSettings } from '../src/settings.js'

const settings = DEFAULT_SETTINGS

describe('with no keys at all, which is a fresh clone', () => {
  const built = buildRouter({ settings, env: {} })

  it('builds nothing, rather than building something that cannot work', () => {
    expect(built.router).toBeNull()
    expect(built.using).toEqual([])
  })

  it('says which keys are missing', () => {
    expect(built.why).toContain('GEMINI_API_KEY')
    expect(built.why).toContain('GROQ_API_KEY')
  })

  it('says nothing is wrong, because nothing is', () => {
    // A fresh clone has no keys. A program that treated that as a failure would be
    // a program nobody could evaluate.
    expect(built.why).toMatch(/nothing is wrong/)
    expect(built.why).toMatch(/saved responses/)
  })

  it('treats a key that is only spaces as no key', () => {
    expect(buildRouter({ settings, env: { GEMINI_API_KEY: '   ' } }).router).toBeNull()
  })
})

describe('with one key', () => {
  const built = buildRouter({ settings, env: { GEMINI_API_KEY: 'not-a-real-key' } })

  it('builds every model that key opens', () => {
    expect(built.router).not.toBeNull()
    expect(built.using).toHaveLength(GEMINI_MODELS.length)
    for (const model of GEMINI_MODELS) {
      expect(built.using).toContain(`gemini:${model}`)
    }
  })

  it('leaves the other provider out rather than trying it and failing', () => {
    for (const id of built.using) expect(id.startsWith('groq:')).toBe(false)
  })

  it('says the other key is absent, so nobody wonders why it was never tried', () => {
    expect(built.why).toContain('GROQ_API_KEY')
    expect(built.why).toMatch(/absent from the order/)
  })

  it('never prints the key', () => {
    // The whole reason a key is a secret. A diagnostic that helpfully echoes one
    // has put it in terminal scrollback, in a log, and in any recording.
    expect(built.why).not.toContain('not-a-real-key')
  })
})

describe('with both keys', () => {
  const built = buildRouter({
    settings,
    env: { GEMINI_API_KEY: 'one', GROQ_API_KEY: 'two' },
  })

  it('builds every model both keys open', () => {
    expect(built.using).toHaveLength(GEMINI_MODELS.length + GROQ_MODELS.length)
  })

  it('prints neither key', () => {
    expect(built.why).not.toContain('one')
    expect(built.why).not.toMatch(/\btwo\b/)
  })

  it('says requests are counted before they are sent', () => {
    // Learning a free daily allowance is spent by being refused costs the rest of
    // the day, because it does not return until midnight in the provider's own
    // time zone.
    expect(built.why).toMatch(/counted per model per day before being/)
  })
})

describe('the routes and the models agree', () => {
  it('every model named in a route is one this can actually build', () => {
    // A route naming a model nothing builds is a route that silently never fires,
    // and the stage falls through to whatever is next with nothing to show for it.
    const buildable = new Set([
      ...GEMINI_MODELS.map((one) => `gemini:${one}`),
      ...GROQ_MODELS.map((one) => `groq:${one}`),
    ])

    for (const [stage, order] of Object.entries(DEFAULT_ROUTES)) {
      for (const id of order) {
        expect(buildable.has(id), `stage "${stage}" routes to ${id}, which nothing builds`).toBe(
          true,
        )
      }
    }
  })

  it('every model in the fallback order is one this can build', () => {
    const built = buildRouter({ settings, env: { GEMINI_API_KEY: 'a', GROQ_API_KEY: 'b' } })
    for (const id of DEFAULT_FALLBACK) {
      expect(built.using, `the fallback names ${id}`).toContain(id)
    }
  })

  it('builds every model some route asks for, and no more', () => {
    const wanted = new Set(Object.values(DEFAULT_ROUTES).flat())
    const built = buildRouter({ settings, env: { GEMINI_API_KEY: 'a', GROQ_API_KEY: 'b' } })
    for (const id of built.using) {
      expect(wanted.has(id), `${id} is built and no stage ever routes to it`).toBe(true)
    }
  })
})

describe('whether a real call would be made at all', () => {
  it('says no on the settings a fresh clone gets', () => {
    expect(wouldCallOut(DEFAULT_SETTINGS)).toBe(false)
  })

  it('says yes only when somebody turned replay off deliberately', () => {
    expect(wouldCallOut(readSettings({ REPLAY_MODE: 'false' }))).toBe(true)
  })

  it('stays no when the setting is absent or blank', () => {
    // Somebody who has not thought about it does not spend an allowance.
    for (const value of ['', 'true']) {
      expect(wouldCallOut(readSettings({ REPLAY_MODE: value })), `REPLAY_MODE=${value}`).toBe(false)
    }
    expect(wouldCallOut(readSettings({}))).toBe(false)
  })

  it('refuses anything that is neither, rather than guessing which was meant', () => {
    // "TRUE" and "yes" both plainly mean true to a person. Guessing would be
    // reasonable exactly once, and then somebody writes "no" meaning false and
    // gets a real call. The value is either of the two words or it is a mistake.
    for (const value of ['TRUE', 'yes', 'no', '0', '1']) {
      expect(() => readSettings({ REPLAY_MODE: value }), `REPLAY_MODE=${value}`).toThrow()
    }
  })
})
