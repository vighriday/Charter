import { describe, it, expect } from 'vitest'
import { maySpend, afterSpending, cents, asMoney, remainingUnder, NotAWholeNumberOfCents } from '../src/tools/guard.js'
import { emptyCase, type CaseFacts, type SpendAuthorisation } from '../src/stages/facts.js'
import { preparedSearch, preparedRegistrar, NoRecordedAnswer, type Services } from '../src/tools/services.js'
import {
  askQuestion,
  recordFact,
  requestSpendPermission,
  searchWeb,
  compareNamesTool,
  checkAddress,
  registerAddress,
} from '../src/tools/stage-tools.js'
import type { ToolContext } from '../src/tools/registry.js'

/**
 * The tools, and the rule that stops one of them spending money it was not given.
 *
 * The rule matters more than the tools. Charter's headline claim is that the agent
 * never signs on a person's behalf, and the obvious reply is "your agent cannot
 * sign, but it can spend?" The answer is that money can be delegated within stated
 * limits and consent to be bound cannot be delegated at any limit — and the tests
 * below are what make the first half of that true rather than said.
 */

const permission: SpendAuthorisation = {
  limitCents: '2500',
  forWhat: 'the web address',
  grantedAt: '2026-08-28T10:00:00.000Z',
  spentCents: '0',
}

const facts = (over: Partial<CaseFacts> = {}): CaseFacts => ({
  ...emptyCase('case-1'),
  proposedName: 'Rivera Sisters Bakery',
  ...over,
})

const services = (over: Partial<Services> = {}): Services => ({
  search: preparedSearch({}),
  registrar: preparedRegistrar({}),
  ...over,
})

const context = (over: Partial<ToolContext> = {}): ToolContext => ({
  caseId: 'case-1',
  facts: facts(),
  services: services(),
  now: () => new Date('2026-08-28T11:00:00.000Z'),
  ...over,
})

// ─────────────────────────────────────────────────────────────────────────────
// Money
// ─────────────────────────────────────────────────────────────────────────────

describe('counting money', () => {
  it('reads a whole number of cents', () => {
    expect(cents('2500')).toBe(2500n)
    expect(cents('0')).toBe(0n)
  })

  it('refuses anything that is not exactly whole cents', () => {
    // A limit checked in fractions is eventually wrong by a fraction of a cent, in
    // whichever direction is worse.
    for (const bad of ['25.00', '-100', '1e3', '', '2,500', ' 2500', '025']) {
      expect(() => cents(bad), `"${bad}" was accepted`).toThrow(NotAWholeNumberOfCents)
    }
  })

  it('handles amounts far beyond what a plain number holds exactly', () => {
    const huge = '9007199254740993'
    expect(cents(huge).toString()).toBe(huge)
  })

  it('writes money the way a person reads it, for messages only', () => {
    expect(asMoney('2500')).toBe('$25.00')
    expect(asMoney('5')).toBe('$0.05')
    expect(asMoney('0')).toBe('$0.00')
  })

  it('works out what is left, and never goes below nothing', () => {
    expect(remainingUnder({ ...permission, spentCents: '1000' })).toBe('1500')
    expect(remainingUnder({ ...permission, spentCents: '9999' })).toBe('0')
  })
})

describe('the rule about spending', () => {
  it('refuses when nobody has given permission at all', () => {
    const verdict = maySpend(facts(), '1299', 'registering riverabakery.com')
    expect(verdict.allowed).toBe(false)
    if (verdict.allowed) return
    expect(verdict.reason).toContain('nobody has given permission')
    // And says why the agent cannot fix this itself.
    expect(verdict.reason).toContain('no tool that grants it')
  })

  it('allows a spend inside the permission', () => {
    const verdict = maySpend(facts({ spendAuthorisation: permission }), '1299', 'the address')
    expect(verdict).toEqual({ allowed: true, remainingCents: '1201' })
  })

  it('refuses a spend above what is left, even by one cent', () => {
    const verdict = maySpend(facts({ spendAuthorisation: permission }), '2501', 'the address')
    expect(verdict.allowed).toBe(false)
    if (verdict.allowed) return
    expect(verdict.reason).toContain('$25.01')
    expect(verdict.reason).toContain('$25.00')
    expect(verdict.reason).toContain('even by a cent')
  })

  it('allows a spend of exactly what is left', () => {
    const verdict = maySpend(facts({ spendAuthorisation: permission }), '2500', 'the address')
    expect(verdict).toEqual({ allowed: true, remainingCents: '0' })
  })

  it('counts what has already been spent under the same permission', () => {
    const partly = { ...permission, spentCents: '2000' }
    expect(maySpend(facts({ spendAuthorisation: partly }), '500', 'x').allowed).toBe(true)
    expect(maySpend(facts({ spendAuthorisation: partly }), '501', 'x').allowed).toBe(false)
  })

  it('adds a spend without changing anything, because nothing is held anywhere', () => {
    const after = afterSpending(permission, '1299')
    expect(after.spentCents).toBe('1299')
    expect(permission.spentCents, 'the original was changed').toBe('0')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Stage 1
// ─────────────────────────────────────────────────────────────────────────────

describe('asking the owners something', () => {
  it('puts the question in the record and says it is waiting', () => {
    return askQuestion
      .run({ question: 'Who is putting in the oven?', why: 'It changes the shares.' }, context())
      .then((outcome) => {
        expect(outcome.result['waitingForAnAnswer']).toBe(true)
        expect(outcome.events[0]?.kind).toBe('question.asked')
        expect(outcome.events[0]?.payload['question']).toBe('Who is putting in the oven?')
      })
  })
})

describe('writing down what the owners said', () => {
  it('records a fact with what it is about', async () => {
    const outcome = await recordFact.run({ about: 'state', value: 'TX' }, context())
    expect(outcome.events[0]).toEqual({
      kind: 'fact.recorded',
      payload: { about: 'state', value: 'TX' },
    })
  })

  it('keeps an owner\'s contribution in their own words', async () => {
    const outcome = await recordFact.run(
      { about: 'owner', value: 'Lucia Rivera', contribution: 'a commercial oven' },
      context(),
    )
    expect(outcome.events[0]?.payload['contribution']).toBe('a commercial oven')
  })
})

describe('asking for permission to spend', () => {
  it('asks, and says plainly that it cannot grant', async () => {
    const outcome = await requestSpendPermission.run(
      { limit_cents: 2500, for_what: 'the web address for one year' },
      context(),
    )
    expect(outcome.result['granted']).toBe(false)
    expect(String(outcome.result['note'])).toContain('person has to grant this')
    expect(outcome.events[0]?.kind).toBe('spend.requested')
  })

  it('does not produce a permission that the rule would then accept', async () => {
    // The whole point. Asking must not be a way of granting.
    const outcome = await requestSpendPermission.run(
      { limit_cents: 2500, for_what: 'the web address' },
      context(),
    )
    for (const event of outcome.events) {
      expect(event.kind, 'a tool produced a granted permission').not.toBe('spend.authorised')
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Stage 2
// ─────────────────────────────────────────────────────────────────────────────

describe('searching the live web', () => {
  const search = preparedSearch({
    'rivera sisters bakery texas': {
      hits: [{ title: 'Rivera Baking Co', url: 'https://example.com/1', snippet: 'A bakery.' }],
      answeredBy: 'the-first-service',
    },
  })

  it('returns what came back', async () => {
    const outcome = await searchWeb.run(
      { query: 'rivera sisters bakery texas' },
      context({ services: services({ search }) }),
    )
    expect(outcome.result['found']).toBe(1)
  })

  it('never tells the model which service answered', async () => {
    // A model that can see which service replied starts reasoning about the
    // services rather than the business, with no basis for judging either.
    const outcome = await searchWeb.run(
      { query: 'rivera sisters bakery texas' },
      context({ services: services({ search }) }),
    )
    expect(JSON.stringify(outcome.result)).not.toContain('the-first-service')
  })

  it('does tell the record which service answered', async () => {
    // Hiding a fallback from the model is sensible. Hiding it from the record
    // would not be.
    const outcome = await searchWeb.run(
      { query: 'rivera sisters bakery texas' },
      context({ services: services({ search }) }),
    )
    expect(outcome.events[0]?.payload['answeredBy']).toBe('the-first-service')
  })

  it('fails rather than quietly making a real call', async () => {
    await expect(
      searchWeb.run({ query: 'something nobody prepared' }, context({ services: services({ search }) })),
    ).rejects.toThrow(NoRecordedAnswer)
  })
})

describe('deciding whether the name collides', () => {
  it('reaches the verdict in code and hands the model the working', async () => {
    const outcome = await compareNamesTool.run(
      { found_names: ['Rivera Bakery, Inc.', 'Zenith Plumbing'] },
      context(),
    )
    expect(outcome.result['verdict']).toBe('needs-a-person')
    expect(JSON.stringify(outcome.result)).toContain('comparedAs')
  })

  it('tells the model not to decide a close one itself', async () => {
    // Close to "Rivera Sisters Bakery" without being it: one word changed.
    const outcome = await compareNamesTool.run(
      { found_names: ['Rivera Sisters Baking Co'] },
      context(),
    )
    expect(outcome.result['verdict']).toBe('needs-a-person')
    expect(String(outcome.result['note'])).toContain('Do not decide this yourself')
  })

  it('says a name is taken when it is the same name', async () => {
    const outcome = await compareNamesTool.run(
      { found_names: ['Rivera Sisters Bakery LLC'] },
      context(),
    )
    expect(outcome.result['verdict']).toBe('collides')
  })

  it('is clear when nothing found is close', async () => {
    const outcome = await compareNamesTool.run({ found_names: ['Zenith Plumbing'] }, context())
    expect(outcome.result['verdict']).toBe('clear')
  })

  it('refuses politely when there is no proposed name to compare against', async () => {
    const outcome = await compareNamesTool.run(
      { found_names: ['Anything'] },
      context({ facts: emptyCase('case-1') }),
    )
    expect(String(outcome.result['error'])).toContain('no proposed name')
    expect(outcome.events[0]?.kind).toBe('compare.refused')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Stage 3 — the one that spends money
// ─────────────────────────────────────────────────────────────────────────────

describe('checking a web address', () => {
  const registrar = preparedRegistrar({
    'riverabakery.com': { domain: 'riverabakery.com', available: true, priceCents: '1299' },
    'taken.com': { domain: 'taken.com', available: false },
  })

  it('says whether it is free and what it costs', async () => {
    const outcome = await checkAddress.run(
      { domain: 'riverabakery.com' },
      context({ services: services({ registrar }) }),
    )
    expect(outcome.result).toEqual({ domain: 'riverabakery.com', available: true, price: '$12.99' })
    expect(outcome.events[0]?.payload['priceCents']).toBe('1299')
  })

  it('says when it is taken, with no price', async () => {
    const outcome = await checkAddress.run(
      { domain: 'taken.com' },
      context({ services: services({ registrar }) }),
    )
    expect(outcome.result['available']).toBe(false)
    expect(outcome.result['price']).toBeUndefined()
  })
})

describe('registering a web address', () => {
  const quotes = {
    'riverabakery.com': { domain: 'riverabakery.com', available: true, priceCents: '1299' },
  }
  const checked = {
    candidate: 'riverabakery.com',
    available: true,
    priceCents: '1299',
  }

  it('registers when a person gave permission covering the price', async () => {
    const registrar = preparedRegistrar(quotes)
    const outcome = await registerAddress.run(
      { domain: 'riverabakery.com' },
      context({
        facts: facts({ address: checked, spendAuthorisation: permission }),
        services: services({ registrar }),
      }),
    )
    expect(outcome.result['registered']).toBe(true)
    expect(registrar.registered).toHaveLength(1)
  })

  it('does not contact the registrar at all when nobody gave permission', async () => {
    // Proved by nothing being charged rather than by an error being thrown. An
    // error thrown after the charge would still be an error.
    const registrar = preparedRegistrar(quotes)
    const outcome = await registerAddress.run(
      { domain: 'riverabakery.com' },
      context({ facts: facts({ address: checked }), services: services({ registrar }) }),
    )
    expect(outcome.result['registered']).toBe(false)
    expect(registrar.registered, 'money was spent without permission').toHaveLength(0)
    expect(String(outcome.result['why'])).toContain('nobody has given permission')
  })

  it('does not register when the price is above what is left', async () => {
    const registrar = preparedRegistrar(quotes)
    const nearlySpent = { ...permission, spentCents: '2400' }
    const outcome = await registerAddress.run(
      { domain: 'riverabakery.com' },
      context({
        facts: facts({ address: checked, spendAuthorisation: nearlySpent }),
        services: services({ registrar }),
      }),
    )
    expect(outcome.result['registered']).toBe(false)
    expect(registrar.registered).toHaveLength(0)
  })

  it('records the refusal, so a person can see what it would not do', async () => {
    const registrar = preparedRegistrar(quotes)
    const outcome = await registerAddress.run(
      { domain: 'riverabakery.com' },
      context({ facts: facts({ address: checked }), services: services({ registrar }) }),
    )
    expect(outcome.events[0]?.kind).toBe('address.registration.refused')
  })

  it('will not register an address nobody checked first', async () => {
    const registrar = preparedRegistrar(quotes)
    const outcome = await registerAddress.run(
      { domain: 'somethingelse.com' },
      context({
        facts: facts({ address: checked, spendAuthorisation: permission }),
        services: services({ registrar }),
      }),
    )
    expect(outcome.result['registered']).toBe(false)
    expect(registrar.registered).toHaveLength(0)
    expect(String(outcome.result['why'])).toContain('has not been checked')
  })

  it('will not register one that is already taken', async () => {
    const registrar = preparedRegistrar(quotes)
    const outcome = await registerAddress.run(
      { domain: 'riverabakery.com' },
      context({
        facts: facts({
          address: { ...checked, available: false },
          spendAuthorisation: permission,
        }),
        services: services({ registrar }),
      }),
    )
    expect(outcome.result['registered']).toBe(false)
    expect(registrar.registered).toHaveLength(0)
  })

  it('writes down what it spent, so the next spend counts it', async () => {
    const registrar = preparedRegistrar(quotes)
    const outcome = await registerAddress.run(
      { domain: 'riverabakery.com' },
      context({
        facts: facts({ address: checked, spendAuthorisation: permission }),
        services: services({ registrar }),
      }),
    )
    const applied = outcome.events.find((event) => event.kind === 'spend.applied')
    expect(applied?.payload['amountCents']).toBe('1299')
    expect(applied?.payload['spentCentsAfter']).toBe('1299')
  })

  it('says it used the registrar\'s sandbox, so nothing real was bought', async () => {
    const registrar = preparedRegistrar(quotes)
    const outcome = await registerAddress.run(
      { domain: 'riverabakery.com' },
      context({
        facts: facts({ address: checked, spendAuthorisation: permission }),
        services: services({ registrar }),
      }),
    )
    expect(outcome.result['sandbox']).toBe(true)
  })
})
