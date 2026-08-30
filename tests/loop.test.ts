import { describe, it, expect } from 'vitest'
import { foldFacts, describeSituation, type RecordedEntry } from '../src/stages/fold.js'
import { takeTurn, MAX_REPAIR_ATTEMPTS, type TurnTaker } from '../src/agent/loop.js'
import { buildRegistry } from '../src/tools/registry.js'
import { ALL_TOOLS } from '../src/tools/stage-tools.js'
import { preparedSearch, preparedRegistrar, preparedIdentity, preparedPublishing, type Services } from '../src/tools/services.js'
import { emptyCase } from '../src/stages/facts.js'
import { STAGES } from '../src/stages/stages.js'
import { MalformedReply, type TurnRequest, type TurnResult } from '../src/model/types.js'
import type { JsonObject } from '../src/record/canonical.js'

/**
 * Reading the record forward, and taking one turn.
 *
 * Charter holds no running summary of a case. Every turn begins by reading the
 * record from the first entry to the last and folding it into a plain value. That
 * is what makes a run survive a closed browser tab, a restart or a crash with
 * nothing lost, and it is what stops what Charter believes from ever drifting from
 * what actually happened.
 *
 * The turn itself is one web request: send this stage's tools and nothing else,
 * take the model's one choice, check the arguments, run the tool, hand back the
 * entries to add to the record.
 */

const registry = buildRegistry(ALL_TOOLS)

const services = (over: Partial<Services> = {}): Services => ({
  search: preparedSearch({}),
  registrar: preparedRegistrar({}),
  identity: preparedIdentity({}),
  publishing: preparedPublishing(),
  ...over,
})

/** A stand-in for the router whose answers each test sets exactly. */
function answering(
  ...replies: Array<TurnResult | Error>
): TurnTaker & { readonly asked: TurnRequest[] } {
  const asked: TurnRequest[] = []
  let at = 0
  return {
    asked,
    async turn(request) {
      asked.push(request)
      const reply = replies[Math.min(at++, replies.length - 1)]
      if (reply === undefined) throw new Error('the test ran out of prepared replies')
      if (reply instanceof Error) throw reply
      return { ...reply, providerId: 'test:model' }
    },
  }
}

const calling = (name: string, args: JsonObject): TurnResult => ({
  kind: 'tool_call',
  name,
  args,
  raw: { pretendThisIsTheWholeReply: name },
  usage: { inputTokens: 10, outputTokens: 5 },
})

const saying = (text: string): TurnResult => ({
  kind: 'text',
  text,
  raw: { said: text },
  usage: { inputTokens: 10, outputTokens: 5 },
})

const turn = (over: Partial<Parameters<typeof takeTurn>[0]> = {}) =>
  takeTurn({
    caseId: 'case-1',
    stage: 'understand',
    facts: emptyCase('case-1'),
    registry,
    router: answering(calling('record_fact', { about: 'state', value: 'TX' })),
    services: services(),
    turnsSoFar: 0,
    now: () => new Date('2026-08-28T11:00:00.000Z'),
    ...over,
  })

// ─────────────────────────────────────────────────────────────────────────────
// Reading the record forward
// ─────────────────────────────────────────────────────────────────────────────

describe('folding the record into what is known', () => {
  const fold = (entries: RecordedEntry[]) => foldFacts('case-1', entries)

  it('starts from nothing', () => {
    expect(fold([])).toEqual({
      caseId: 'case-1',
      owners: [],
      openQuestions: [],
      answers: [],
      identityChecks: [],
    })
  })

  it('collects the plain facts', () => {
    const facts = fold([
      { kind: 'fact.recorded', payload: { about: 'description', value: 'A bakery.' } },
      { kind: 'fact.recorded', payload: { about: 'state', value: 'tx' } },
      { kind: 'fact.recorded', payload: { about: 'proposed_name', value: 'Rivera Bakery' } },
    ])
    expect(facts.description).toBe('A bakery.')
    expect(facts.state, 'the state is written the way the state writes it').toBe('TX')
    expect(facts.proposedName).toBe('Rivera Bakery')
  })

  it('collects owners, and lets a later entry correct an earlier one', () => {
    // How somebody correcting themselves works. Order matters, which is why the
    // entries must be read in the order the record keeps them.
    const facts = fold([
      { kind: 'fact.recorded', payload: { about: 'owner', value: 'Ana', contribution: 'cash' } },
      { kind: 'fact.recorded', payload: { about: 'owner', value: 'Lucia', contribution: 'an oven' } },
      { kind: 'fact.recorded', payload: { about: 'owner', value: 'Ana', contribution: '$20,000' } },
    ])
    expect(facts.owners).toEqual([
      { name: 'Ana', contribution: '$20,000' },
      { name: 'Lucia', contribution: 'an oven' },
    ])
  })

  it('holds a question open until it is answered', () => {
    const asked = fold([{ kind: 'question.asked', payload: { question: 'Who owns the oven?' } }])
    expect(asked.openQuestions).toEqual(['Who owns the oven?'])

    const answered = fold([
      { kind: 'question.asked', payload: { question: 'Who owns the oven?' } },
      { kind: 'question.answered', payload: { question: 'Who owns the oven?' } },
    ])
    expect(answered.openQuestions).toEqual([])
  })

  it('reads a permission a person granted', () => {
    const facts = fold([
      {
        kind: 'spend.authorised',
        payload: {
          limitCents: '2500',
          forWhat: 'the web address',
          grantedAt: '2026-08-28T10:00:00.000Z',
        },
      },
    ])
    expect(facts.spendAuthorisation).toEqual({
      limitCents: '2500',
      forWhat: 'the web address',
      grantedAt: '2026-08-28T10:00:00.000Z',
      spentCents: '0',
    })
  })

  it('counts what has been spent under it', () => {
    const facts = fold([
      {
        kind: 'spend.authorised',
        payload: { limitCents: '2500', forWhat: 'x', grantedAt: '2026-08-28T10:00:00.000Z' },
      },
      { kind: 'spend.applied', payload: { spentCentsAfter: '1299' } },
    ])
    expect(facts.spendAuthorisation?.spentCents).toBe('1299')
  })

  it('carries what is already spent across a second permission', () => {
    // A second permission is an ordinary path, not a hypothetical one. When a
    // price is above what is left, the spending rule refuses with the words "a
    // person has to raise the limit before this can run", and nothing stops a
    // person granting again.
    //
    // Starting the count at zero each time would let a raised limit be spent in
    // full a second time: 2500 granted twice would permit 5000 of spending while
    // every screen showed a limit of 2500. Money already gone is gone.
    const facts = fold([
      {
        kind: 'spend.authorised',
        payload: { limitCents: '5000', forWhat: 'x', grantedAt: '2026-08-30T10:00:00.000Z' },
      },
      { kind: 'spend.applied', payload: { spentCentsAfter: '3000' } },
      {
        kind: 'spend.authorised',
        payload: { limitCents: '5000', forWhat: 'x', grantedAt: '2026-08-30T11:00:00.000Z' },
      },
    ])

    expect(facts.spendAuthorisation?.spentCents, 'the amount already spent was reset').toBe('3000')
    expect(facts.spendAuthorisation?.limitCents).toBe('5000')
  })

  it('keeps an owner’s share when their description is corrected', () => {
    // Somebody correcting what an owner put in must not silently delete their
    // share and the value of it, which arrive as separate entries. Replacing the
    // whole record made the agreement refuse to draft with "no share has been
    // recorded", naming a person whose share had been recorded.
    const facts = fold([
      { kind: 'fact.recorded', payload: { about: 'owner', value: 'Ana', contribution: 'the van' } },
      { kind: 'fact.recorded', payload: { about: 'owner_share', value: '60', owner: 'Ana' } },
      {
        kind: 'fact.recorded',
        payload: { about: 'owner_contribution_value', value: '3000000', owner: 'Ana' },
      },
      {
        kind: 'fact.recorded',
        payload: { about: 'owner', value: 'Ana', contribution: 'the van and the ovens' },
      },
    ])

    expect(facts.owners[0]).toEqual({
      name: 'Ana',
      contribution: 'the van and the ovens',
      sharePercent: '60',
      contributionCents: '3000000',
    })
  })

  it('leaves a contribution alone when the correction does not mention one', () => {
    // An absent argument means "not said", not "erase what they told us".
    const facts = fold([
      { kind: 'fact.recorded', payload: { about: 'owner', value: 'Ana', contribution: 'the van' } },
      { kind: 'fact.recorded', payload: { about: 'owner', value: 'Ana' } },
    ])

    expect(facts.owners[0]?.contribution).toBe('the van')
  })

  it('ignores a spend applied against no permission', () => {
    // Nothing should ever produce this. If something does, it must not create a
    // permission out of nothing.
    const facts = fold([{ kind: 'spend.applied', payload: { spentCentsAfter: '1299' } }])
    expect(facts.spendAuthorisation).toBeUndefined()
  })

  it('collects the searches and the name verdict', () => {
    const facts = fold([
      {
        kind: 'search.performed',
        payload: { query: 'rivera bakery', resultCount: '3', answeredBy: 'first-service' },
      },
      { kind: 'names.compared', payload: { verdict: 'clear', comparisons: [] } },
    ])
    expect(facts.nameResearch?.searches).toHaveLength(1)
    expect(facts.nameResearch?.searches[0]?.answeredBy).toBe('first-service')
    expect(facts.nameResearch?.verdict).toBe('clear')
  })

  it('follows the web address from checked to registered', () => {
    const facts = fold([
      {
        kind: 'address.checked',
        payload: { domain: 'riverabakery.com', available: true, priceCents: '1299' },
      },
      { kind: 'address.registered', payload: { domain: 'riverabakery.com' } },
    ])
    expect(facts.address).toEqual({
      candidate: 'riverabakery.com',
      available: true,
      priceCents: '1299',
      registered: true,
    })
  })

  it('passes over an entry kind it has never heard of', () => {
    // A record written by a later version will hold kinds this code does not know.
    // Refusing such a record would make every past run unreadable the first time
    // an entry kind is added.
    const facts = fold([
      { kind: 'something.from.the.future', payload: { anything: 'at all' } },
      { kind: 'fact.recorded', payload: { about: 'state', value: 'TX' } },
    ])
    expect(facts.state).toBe('TX')
  })

  it('passes over a detail that was forgotten', () => {
    // Personal details can be cleared from the record while the entry itself
    // stays, so the chain still checks out. A fold that crashed on one would make
    // forgetting break every past run.
    const facts = fold([
      { kind: 'fact.recorded', payload: null },
      { kind: 'fact.recorded', payload: { about: 'state', value: 'TX' } },
    ])
    expect(facts.state).toBe('TX')
  })

  it('passes over an entry missing the field it expected', () => {
    const facts = fold([
      { kind: 'fact.recorded', payload: { about: 'state' } },
      { kind: 'address.checked', payload: {} },
      { kind: 'fact.recorded', payload: { about: 'proposed_name', value: 'Rivera Bakery' } },
    ])
    expect(facts.state).toBeUndefined()
    expect(facts.address).toBeUndefined()
    expect(facts.proposedName).toBe('Rivera Bakery')
  })

  it('gives the same answer every time the same record is read', () => {
    // The property the whole design rests on: a resumed run is identical to one
    // that never stopped.
    const entries: RecordedEntry[] = [
      { kind: 'fact.recorded', payload: { about: 'state', value: 'TX' } },
      { kind: 'question.asked', payload: { question: 'Who owns the oven?' } },
    ]
    expect(fold(entries)).toEqual(fold(entries))
  })
})

describe('what the model is told', () => {
  it('says where things stand, not what was said', () => {
    const facts = foldFacts('case-1', [
      { kind: 'fact.recorded', payload: { about: 'description', value: 'A bakery.' } },
      { kind: 'fact.recorded', payload: { about: 'owner', value: 'Ana', contribution: 'cash' } },
    ])
    const situation = describeSituation(facts)
    expect(situation).toContain('A bakery.')
    expect(situation).toContain('Ana')
    expect(situation).toContain('Nobody has given permission to spend')
  })

  it('stays short as a run gets long', () => {
    // The reason nothing is carried between turns. There is a hard four thousand
    // token ceiling, and a description that grew every turn would quietly stop a
    // run at turn thirty — first noticed during a demonstration.
    const many: RecordedEntry[] = []
    for (let i = 0; i < 200; i++) {
      many.push({ kind: 'search.performed', payload: { query: `search ${i}`, resultCount: '5' } })
    }
    const situation = describeSituation(foldFacts('case-1', many))
    expect(situation.length).toBeLessThan(1000)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// One turn
// ─────────────────────────────────────────────────────────────────────────────

describe('taking one turn', () => {
  it('offers only the current stage\'s tools', async () => {
    const router = answering(calling('record_fact', { about: 'state', value: 'TX' }))
    await turn({ router })
    expect(router.asked[0]?.tools.map((tool) => tool.name)).toEqual([
      'ask_question',
      'record_fact',
      'request_spend_permission',
    ])
  })

  it('carries nothing between turns, so turn thirty costs what turn one did', async () => {
    const router = answering(calling('record_fact', { about: 'state', value: 'TX' }))
    await turn({ router, turnsSoFar: 9 })
    expect(router.asked[0]?.history).toEqual([])
  })

  it('runs the tool and hands back what to record', async () => {
    const report = await turn()
    expect(report.outcome.kind).toBe('tool ran')
    const kinds = report.events.map((event) => event.kind)
    expect(kinds).toContain('turn.started')
    expect(kinds).toContain('model.answered')
    expect(kinds).toContain('tool.ran')
    expect(kinds).toContain('fact.recorded')
  })

  it('keeps the model\'s reply exactly as it arrived', async () => {
    // Never summarised. A later model may need it handed back unchanged, and a
    // summary would break the record's fingerprints as well.
    const report = await turn()
    const answered = report.events.find((event) => event.kind === 'model.answered')
    expect(answered?.payload['raw']).toEqual({ pretendThisIsTheWholeReply: 'record_fact' })
  })

  it('writes nothing itself, so the whole loop can be tested without a database', async () => {
    const report = await turn()
    expect(report.events.length).toBeGreaterThan(0)
  })

  it('records which model answered', async () => {
    const report = await turn()
    const answered = report.events.find((event) => event.kind === 'model.answered')
    expect(answered?.payload['providerId']).toBe('test:model')
  })
})

describe('when the arguments do not fit', () => {
  it('tells the model what is wrong and asks again', async () => {
    const router = answering(
      calling('record_fact', { about: 'the_state', value: 'TX' }),
      calling('record_fact', { about: 'state', value: 'TX' }),
    )
    const report = await turn({ router })
    expect(report.outcome.kind).toBe('tool ran')

    // The second request carries the correction, naming the field and the values.
    const second = router.asked[1]?.situation ?? ''
    expect(second).toContain('about')
    expect(second).toContain('"description", "state", "proposed_name", "owner"')
  })

  it('records the rejection, so the record shows the model being corrected', async () => {
    const router = answering(
      calling('record_fact', { about: 'the_state', value: 'TX' }),
      calling('record_fact', { about: 'state', value: 'TX' }),
    )
    const report = await turn({ router })
    const rejected = report.events.find((event) => event.kind === 'tool.arguments.rejected')
    expect(rejected?.payload['tool']).toBe('record_fact')
  })

  it('does not run the tool with arguments that did not fit', async () => {
    const router = answering(calling('record_fact', { about: 'the_state', value: 'TX' }))
    const report = await turn({ router })
    expect(report.events.some((event) => event.kind === 'fact.recorded')).toBe(false)
  })

  it('gives up after two corrections rather than spending the day', async () => {
    // Each attempt costs a request from an allowance of a few hundred a day that
    // does not return until midnight in the provider's own time zone.
    const router = answering(calling('record_fact', { about: 'wrong', value: 'TX' }))
    const report = await turn({ router })
    expect(report.outcome.kind).toBe('gave up')
    expect(router.asked).toHaveLength(MAX_REPAIR_ATTEMPTS + 1)
  })

  it('says why it gave up, in words about the cost', async () => {
    const router = answering(calling('record_fact', { about: 'wrong', value: 'TX' }))
    const report = await turn({ router })
    if (report.outcome.kind !== 'gave up') return expect.unreachable('should have given up')
    expect(report.outcome.why).toContain('daily')
  })
})

describe('when the model asks for a tool it was not offered', () => {
  it('refuses, and tells it what it may call instead', async () => {
    const router = answering(
      calling('register_address', { domain: 'riverabakery.com' }),
      calling('record_fact', { about: 'state', value: 'TX' }),
    )
    const report = await turn({ router })
    expect(report.outcome.kind).toBe('tool ran')
    expect(report.events.some((event) => event.kind === 'tool.refused')).toBe(true)
    expect(router.asked[1]?.situation).toContain('ask_question')
  })

  it('refuses a tool that does not exist at all', async () => {
    const router = answering(calling('sign_the_agreement', {}))
    const report = await turn({ router })
    expect(report.outcome.kind).toBe('gave up')
    const refused = report.events.find((event) => event.kind === 'tool.refused')
    expect(String(refused?.payload['why'])).toContain('there is no tool called')
  })

  it('never runs a tool from another stage, whatever the model asked for', async () => {
    const registrar = preparedRegistrar({
      'riverabakery.com': { domain: 'riverabakery.com', available: true, priceCents: '1299' },
    })
    const router = answering(calling('register_address', { domain: 'riverabakery.com' }))
    await turn({ router, services: services({ registrar }) })
    expect(registrar.registered, 'a tool from another stage spent money').toHaveLength(0)
  })
})

describe('when the reply was cut off part-way through', () => {
  it('asks again rather than acting on half a call', async () => {
    // Running a truncated call means acting on arguments nobody wrote.
    const router = answering(
      new MalformedReply('test:model', 'the reply stopped mid-way through the tool call'),
      calling('record_fact', { about: 'state', value: 'TX' }),
    )
    const report = await turn({ router })
    expect(report.outcome.kind).toBe('tool ran')
    expect(report.events.some((event) => event.kind === 'model.reply.unusable')).toBe(true)
  })

  it('gives up rather than asking for ever', async () => {
    const router = answering(new MalformedReply('test:model', 'cut off again'))
    await expect(turn({ router })).rejects.toThrow(MalformedReply)
  })
})

describe('when the model answers with words instead of a tool', () => {
  it('lets the first stage say there is nothing left to ask', async () => {
    // The one stage that must be able to say it has heard enough. Forcing a call
    // here makes a model invent a question rather than admit it.
    const router = answering(saying('I have everything I need.'))
    const report = await turn({ router })
    expect(report.outcome.kind).toBe('said nothing to do')
  })

  it('asks again anywhere a tool is required', async () => {
    const router = answering(
      saying('I think we should search for the name.'),
      calling('search_web', { query: 'rivera bakery' }),
    )
    const search = preparedSearch({
      'rivera bakery': { hits: [], answeredBy: 'first-service' },
    })
    const report = await turn({
      stage: 'research',
      router,
      services: services({ search }),
      facts: { ...emptyCase('case-1'), proposedName: 'Rivera Bakery' },
    })
    expect(report.outcome.kind).toBe('tool ran')
    expect(router.asked[1]?.situation).toContain('call one of the tools')
  })
})

describe('the ceiling on turns', () => {
  it('stops a stage that has taken all its turns', async () => {
    const router = answering(calling('record_fact', { about: 'state', value: 'TX' }))
    const report = await turn({ router, turnsSoFar: STAGES.understand.maxTurns })
    expect(report.outcome.kind).toBe('gave up')
    expect(router.asked, 'a model was asked after the ceiling was reached').toHaveLength(0)
  })

  it('says why stopping is cheaper than continuing', async () => {
    const report = await turn({ turnsSoFar: STAGES.understand.maxTurns })
    if (report.outcome.kind !== 'gave up') return expect.unreachable('should have given up')
    expect(report.outcome.why).toContain('midnight')
  })

  it('records giving up, so a stalled run explains itself', async () => {
    const report = await turn({ turnsSoFar: STAGES.understand.maxTurns })
    expect(report.events[0]?.kind).toBe('turn.abandoned')
  })
})

describe('what the model is told about the situation', () => {
  it('never says the word "undefined" to the model', () => {
    // The name verdict is deliberately absent until something has actually been
    // compared. Putting it straight into the sentence printed "Name check so far:
    // undefined", which is meaningless and is exactly the sort of thing a model
    // will try to make sense of.
    const facts = foldFacts('case-1', [
      {
        kind: 'search.performed',
        payload: { query: 'Rivera Sisters Baking', resultCount: '3', answeredBy: 'a-service' },
      },
    ])

    const said = describeSituation(facts)
    expect(said).not.toContain('undefined')
    expect(said).toContain('nothing compared against the proposed name yet')
  })

  it('says the verdict once there is one', () => {
    const facts = foldFacts('case-1', [
      {
        kind: 'search.performed',
        payload: { query: 'x', resultCount: '1', answeredBy: 'a-service' },
      },
      { kind: 'names.compared', payload: { verdict: 'clear', comparisons: [] } },
    ])

    expect(describeSituation(facts)).toContain('clear')
  })
})
