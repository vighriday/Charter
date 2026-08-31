import { describe, it, expect } from 'vitest'
import { maySpend, afterSpending, cents, asMoney, remainingUnder, NotAWholeNumberOfCents } from '../src/tools/guard.js'
import { emptyCase, type CaseFacts, type SpendAuthorisation } from '../src/stages/facts.js'
import { preparedSearch, preparedRegistrar, preparedIdentity, preparedPublishing, NoRecordedAnswer, type Services } from '../src/tools/services.js'
import {
  askQuestion,
  recordFact,
  requestSpendPermission,
  searchWeb,
  compareNamesTool,
  checkAddress,
  registerAddress,
  recordAgreementChoice,
  draftAgreement,
} from '../src/tools/stage-tools.js'
import type { ToolContext } from '../src/tools/registry.js'
import { DEFAULT_SETTINGS } from '../src/settings.js'
import { makeSealCertificate } from '../src/seal/certificate.js'

// Made once for the whole file. A certificate takes a second or two to make, and
// the tools here are not what is being tested about it.
const sharedCertificate = makeSealCertificate({
  notBefore: new Date(Date.UTC(2026, 0, 1)),
  password: 'a-long-enough-password',
})

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
  identity: preparedIdentity({}),
  publishing: preparedPublishing(),
  ...over,
})

const context = (over: Partial<ToolContext> = {}): ToolContext => ({
  caseId: 'case-1',
  facts: facts(),
  services: services(),
  now: () => new Date('2026-08-28T11:00:00.000Z'),
  // The same settings a run with an empty `.env` would get, so what the tests
  // exercise is what a stranger cloning this project would get.
  settings: DEFAULT_SETTINGS,
  // One certificate for the whole file. Making one takes a second or two, and
  // nothing here is testing certificates.
  certificate: sharedCertificate,
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

/**
 * The two tools that touch the ownership agreement, and the one rule that makes
 * the first of them safe.
 *
 * An ownership agreement has two terms with no sensible default. Who runs the
 * company decides whether every owner can bind it or none of them can. Whether
 * there is a written way out decides whether an owner can ever leave at all —
 * Texas states that a member of a limited liability company may not withdraw or
 * be expelled, so an agreement that adds nothing leaves no exit, and that is a
 * term of the deal whether or not anybody meant to agree to it.
 *
 * So Charter never chooses either one. It asks, and it writes down what it is
 * told. The tests below are what make "writes down what it is told" checkable
 * rather than merely intended.
 */
describe('writing down a term of the deal', () => {
  const asked = (question: string, answer: string): CaseFacts => ({
    ...emptyCase('case-1'),
    answers: [{ question, answer }],
  })

  it('refuses when nobody has been asked, and records the refusal', () => {
    // The refusal goes into the record, not just back to the model. A term
    // arriving without anybody being asked is exactly what somebody reading this
    // run afterwards would want to see Charter refuse.
    return recordAgreementChoice
      .run({ which: 'exit_process', value: 'yes' }, context())
      .then((outcome) => {
        expect(String(outcome.result['refused'])).toContain('nobody has been asked')
        expect(outcome.events[0]?.kind).toBe('agreement.choice.refused')
      })
  })

  it('writes it down once the question has actually been put and answered', async () => {
    const facts = asked(
      'Do you want a written way for an owner to leave and be bought out?',
      'No, we trust each other.',
    )
    const outcome = await recordAgreementChoice.run(
      { which: 'exit_process', value: 'no' },
      context({ facts }),
    )

    expect(outcome.events[0]?.kind).toBe('agreement.choice.recorded')
    expect(outcome.events[0]?.payload).toEqual({ which: 'exit_process', value: 'no' })
  })

  it('does not accept an answer to a different question', async () => {
    // Somebody answering a question about the company name has not said anything
    // about whether an owner may leave.
    const facts = asked('What would you like the company to be called?', 'Rivera Sisters.')
    const outcome = await recordAgreementChoice.run(
      { which: 'exit_process', value: 'yes' },
      context({ facts }),
    )
    expect(String(outcome.result['refused'])).toContain('nobody has been asked')
  })

  it('refuses a value that is not one of the two possible answers', async () => {
    const facts = asked('Who will run the company day to day?', 'Both of us.')
    const outcome = await recordAgreementChoice.run(
      { which: 'managed_by', value: 'a committee' },
      context({ facts }),
    )
    expect(String(outcome.result['refused'])).toContain('not an answer to that question')
  })

  it('offers no way to record anything except those two terms', () => {
    const allowed = recordAgreementChoice.schema.properties['which']
    expect(allowed?.enum).toEqual(['managed_by', 'exit_process'])
  })
})

describe('preparing the agreement', () => {
  const ready = (): CaseFacts => ({
    ...emptyCase('case-1'),
    proposedName: 'Rivera Sisters Baking Co LLC',
    state: 'TX',
    owners: [
      {
        name: 'Ana Rivera',
        contribution: 'the delivery van and the ovens',
        contributionCents: '2500000',
        sharePercent: '50',
      },
      {
        name: 'Lucia Rivera',
        contribution: 'the lease deposit',
        contributionCents: '2500000',
        sharePercent: '50',
      },
    ],
    agreementChoices: { managedBy: 'the owners themselves', hasExitProcess: false },
  })

  it('prepares the document and records what it decided', async () => {
    const outcome = await draftAgreement.run({}, context({ facts: ready() }))

    expect(outcome.events[0]?.kind).toBe('agreement.drafted')
    expect(Number(outcome.result['articles'])).toBeGreaterThan(10)
    expect(outcome.result['dated']).toBe('28 August 2026')
  })

  it('records which side of every either/or term the document ended up with', async () => {
    const outcome = await draftAgreement.run({}, context({ facts: ready() }))
    const blocks = (outcome.events[0]?.payload as { blocks: string[] }).blocks

    expect(blocks).toContain('managed-by-members')
    expect(blocks).toContain('no-exit-exists')
    expect(blocks).not.toContain('managed-by-manager')
    expect(blocks).not.toContain('exit-process-exists')
  })

  it('refuses with the reason rather than crashing, when something is missing', async () => {
    const missing = { ...ready() }
    delete (missing as { agreementChoices?: unknown }).agreementChoices

    const outcome = await draftAgreement.run({}, context({ facts: missing }))
    expect(String(outcome.result['refused'])).toContain('no safe default')
    expect(outcome.events[0]?.kind).toBe('agreement.draft.refused')
  })

  it('will not divide a share the owners never agreed', async () => {
    const facts = ready()
    const noShare = { ...(facts.owners[1] as (typeof facts.owners)[number]) }
    delete (noShare as { sharePercent?: string }).sharePercent

    const outcome = await draftAgreement.run(
      {},
      context({ facts: { ...facts, owners: [facts.owners[0] as (typeof facts.owners)[number], noShare] } }),
    )
    expect(String(outcome.result['refused'])).toContain('will not divide the remainder')
  })

  it('takes no arguments at all, so the model cannot influence what it says', () => {
    // The model chooses WHEN the document is prepared. It contributes nothing to
    // WHAT the document says.
    expect(Object.keys(draftAgreement.schema.properties)).toHaveLength(0)
  })

  it('spends nothing and can be undone', () => {
    expect(draftAgreement.costsMoney).toBe(false)
    expect(draftAgreement.reversible).toBe(true)
  })
})
