import { describe, it, expect } from 'vitest'
import {
  STAGES,
  STAGE_ORDER,
  nextStage,
  toolsFor,
  moveTo,
  couldMoveOn,
  isStageName,
  StageOrderViolation,
} from '../src/stages/stages.js'
import { emptyCase, type CaseFacts } from '../src/stages/facts.js'
import { buildRegistry, specsFor, toolFor, catalogue } from '../src/tools/registry.js'
import { ALL_TOOLS } from '../src/tools/stage-tools.js'
import { DEFAULT_ROUTES } from '../src/model/router.js'

/**
 * The stage machine, and the invariants it exists to hold.
 *
 * Charter's work moves through eight stages in a fixed order. The stage machine's
 * whole job is to answer one question — which tools may the model use right now —
 * and to make sure a case only ever moves forwards, one step, when the work of the
 * stage it is leaving is genuinely finished.
 *
 * Two of the tests here are not really tests of the stage machine. They are the
 * boundary argument, written as code that runs: no signature-related tool exists
 * in any stage's list, and stage seven has no tools at all.
 */

const registry = buildRegistry(ALL_TOOLS)

/** A case with everything stage one needs, so other tests can start from it. */
const understood: CaseFacts = {
  ...emptyCase('case-1'),
  description: 'Two sisters opening a bakery. One put in cash, the other an oven.',
  state: 'TX',
  proposedName: 'Rivera Sisters Bakery',
  owners: [
    { name: 'Ana Rivera', contribution: '$20,000 in cash' },
    { name: 'Lucia Rivera', contribution: 'a commercial oven worth about $12,000' },
  ],
  openQuestions: [],
  spendAuthorisation: {
    limitCents: '2500',
    forWhat: 'the web address',
    grantedAt: '2026-08-28T10:00:00.000Z',
    spentCents: '0',
  },
}

/**
 * The same case with one thing not known yet.
 *
 * The field is left out rather than set to nothing, because in this project those
 * are different states and the compiler is set up to say so. "Not written down"
 * and "written down as nothing" would otherwise be told apart nowhere.
 */
const without = (field: keyof CaseFacts): CaseFacts => {
  const copy: Record<string, unknown> = { ...understood }
  delete copy[field]
  return copy as unknown as CaseFacts
}

// ─────────────────────────────────────────────────────────────────────────────
// The invariants — the part that carries the argument
// ─────────────────────────────────────────────────────────────────────────────

describe('the invariants', () => {
  it('has no signature-related tool in any stage, anywhere', () => {
    // The strongest form of "Charter never signs on a human's behalf" is not a
    // rule the model is asked to follow. It is that no such tool exists in any
    // list the model is ever shown, and a model cannot choose what it has never
    // been offered.
    const forbidden = /sign|signature|signing|esign|envelope|docusign|execute/i
    const offences: string[] = []
    for (const stage of Object.values(STAGES)) {
      for (const name of stage.tools) {
        if (forbidden.test(name)) offences.push(`stage "${stage.name}" offers "${name}"`)
      }
    }
    expect(
      offences,
      'A signature-related tool appeared in a stage tool list. Charter never signs ' +
        'on a person\'s behalf, and this is one of the four places that is enforced ' +
        'rather than promised.',
    ).toEqual([])
  })

  it('has no signature-related tool in the registry at all', () => {
    // Wider than the check above. A tool could exist without being listed by any
    // stage today and be quietly added tomorrow.
    const forbidden = /sign|signature|signing|esign|envelope|docusign|execute/i
    expect([...registry.keys()].filter((name) => forbidden.test(name))).toEqual([])
  })

  it('gives stage seven no tools, which is the design and not an omission', () => {
    // This is where a person signs. The agent stops, ordinary code carries the
    // pack to them, and the approval never passes through the agent loop.
    expect(STAGES.boundary.tools).toEqual([])
    expect(STAGES.boundary.title).toBe('Hand it to a person')
  })

  it('offers the model exactly the current stage\'s tools and nothing else', () => {
    // Not "told not to use the others" — the others are absent from the request.
    for (const stage of Object.values(STAGES)) {
      const specs = specsFor(registry, stage.name)
      expect(specs.map((spec) => spec.name)).toEqual([...stage.tools])
    }
  })

  it('refuses to run a real tool reached for from the wrong stage', () => {
    // register_address exists, but not in stage one.
    expect(() => toolFor(registry, 'understand', 'register_address')).toThrow(/but not during/)
  })

  it('refuses a tool that does not exist at all, and says what does', () => {
    try {
      toolFor(registry, 'understand', 'sign_the_agreement')
      expect.unreachable('should have refused')
    } catch (error) {
      expect((error as Error).message).toContain('which does not exist')
      // The refusal says what it CAN do here, in the same words a reader of the
      // website gets, rather than in the names the code uses for those tools.
      expect((error as Error).message).toContain('ask you a question')
    }
  })

  it('marks the one tool that spends money and cannot be undone', () => {
    // Both flags are read by code — the spend guard runs on anything marked as
    // costing money — rather than being documentation that drifts.
    const costly = [...registry.values()].filter((tool) => tool.costsMoney)
    expect(costly.map((tool) => tool.name)).toEqual(['register_address'])
    expect(costly.every((tool) => !tool.reversible)).toBe(true)
  })

  it('has no tool that grants permission to spend', () => {
    // The agent can ask. Only a person can grant, from their browser, along a
    // path the model is not on. If granting were a tool, a model could be talked
    // into granting itself permission and then spending under it.
    const granting = [...registry.keys()].filter((name) => /grant|authorise|authorize|approve/i.test(name))
    expect(granting).toEqual([])
    expect(registry.has('request_spend_permission')).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The stages themselves
// ─────────────────────────────────────────────────────────────────────────────

describe('the eight stages', () => {
  it('has exactly eight, numbered one to eight, in the order the documents use', () => {
    expect(STAGE_ORDER).toHaveLength(8)
    expect(STAGE_ORDER.map((name) => STAGES[name].position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('describes every stage, because the descriptions are what a person reads', () => {
    for (const stage of Object.values(STAGES)) {
      expect(stage.title.length, stage.name).toBeGreaterThan(2)
      expect(stage.whatHappens.length, stage.name).toBeGreaterThan(30)
    }
  })

  it('names only tools that actually exist', () => {
    // A stage naming a tool nobody wrote would fail at the moment the model was
    // asked, which is the middle of a run.
    for (const stage of Object.values(STAGES)) {
      for (const name of stage.tools) {
        expect(registry.has(name), `stage "${stage.name}" names "${name}", which does not exist`).toBe(true)
      }
    }
  })

  it('has a route for every stage in the routing table', () => {
    for (const name of STAGE_ORDER) {
      expect(Object.hasOwn(DEFAULT_ROUTES, name), `no models routed for stage "${name}"`).toBe(true)
    }
  })

  it('lets only the first stage decline to call a tool', () => {
    // Forcing a call in stage one makes the model invent a question rather than
    // admit it has heard enough. Everywhere else, declining would just stall.
    const optional = Object.values(STAGES).filter((stage) => stage.toolChoice === 'auto')
    expect(optional.map((stage) => stage.name)).toEqual(['understand'])
  })

  it('sends nobody\'s personal details to a model, in any stage', () => {
    // The right number of stages carrying a person's details is zero, and it is
    // zero. The one stage that touches identity documents decides what to do with
    // a fixed comparison against a score, which needs no model at all.
    for (const stage of Object.values(STAGES)) {
      expect(stage.sensitivity, `stage "${stage.name}"`).toBe('public')
    }
  })

  it('puts a ceiling on turns in every stage that has any tools', () => {
    for (const stage of Object.values(STAGES)) {
      if (stage.tools.length === 0) continue
      expect(stage.maxTurns, `stage "${stage.name}"`).toBeGreaterThan(0)
      expect(stage.maxTurns, `stage "${stage.name}"`).toBeLessThanOrEqual(30)
    }
  })

  it('knows a stage name from anything else', () => {
    expect(isStageName('understand')).toBe(true)
    expect(isStageName('signing')).toBe(false)
    expect(isStageName(7)).toBe(false)
    expect(isStageName(undefined)).toBe(false)
  })

  it('says what comes next, and that nothing comes after the last', () => {
    expect(nextStage('understand')).toBe('research')
    expect(nextStage('publish')).toBeUndefined()
  })

  it('gives the tools for a stage without anything being able to add to them', () => {
    expect(toolsFor('understand')).toEqual([
      'ask_question',
      'record_fact',
      'request_spend_permission',
    ])
    expect(toolsFor('boundary')).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Moving forward
// ─────────────────────────────────────────────────────────────────────────────

describe('moving a case from one stage to the next', () => {
  it('moves on when the stage is genuinely finished', () => {
    expect(() => moveTo('understand', 'research', understood)).not.toThrow()
  })

  it('refuses to skip a stage, and says which one comes next', () => {
    try {
      moveTo('understand', 'address', understood)
      expect.unreachable('should have refused')
    } catch (error) {
      expect(error).toBeInstanceOf(StageOrderViolation)
      expect((error as Error).message).toContain('"research"')
      expect((error as Error).message).toContain('not skipped')
    }
  })

  it('refuses to go backwards, and says why that is worse than it sounds', () => {
    const facts: CaseFacts = {
      ...understood,
      nameResearch: {
        searches: [
          { query: 'rivera sisters bakery', resultCount: '3', answeredBy: 'test', found: [] },
        ],
        collisions: [],
        verdict: 'clear',
      },
    }
    try {
      moveTo('research', 'understand', facts)
      expect.unreachable('should have refused')
    } catch (error) {
      expect((error as Error).message).toContain('backwards')
      expect((error as Error).message).toContain('two answers to the same question')
    }
  })

  it('refuses to move at all when the stage is not finished', () => {
    const barely: CaseFacts = { ...emptyCase('case-2') }
    expect(() => moveTo('understand', 'research', barely)).toThrow(StageOrderViolation)
  })

  it('refuses a destination that is not a stage', () => {
    expect(() => moveTo('understand', 'sign_it', understood)).toThrow(/no stage called/)
  })

  it('refuses to move past the last stage', () => {
    expect(() => moveTo('publish', 'done', understood)).toThrow(/there is no stage called/)
  })

  it('is not moved by anything the model says, only by what the record holds', () => {
    // There is no argument to this function that the model controls. A model
    // announcing a stage is finished changes nothing at all.
    expect(() => moveTo('understand', 'research', without('spendAuthorisation'))).toThrow(
      /permission to spend/,
    )
  })
})

describe('what stage one waits for', () => {
  const missing = (field: keyof CaseFacts): string => {
    const result = couldMoveOn('understand', without(field))
    return result.ready ? '' : result.because
  }
  const asking = (over: Partial<CaseFacts>): string => {
    const result = couldMoveOn('understand', { ...understood, ...over })
    return result.ready ? '' : result.because
  }

  it('waits for somebody to describe the business', () => {
    expect(missing('description')).toContain('described')
  })

  it('waits for the state', () => {
    expect(missing('state')).toContain('state')
  })

  it('waits for a proposed name', () => {
    expect(missing('proposedName')).toContain('name')
  })

  it('waits for a second owner, and says why that is the whole product', () => {
    // Charter is for businesses with more than one owner. Forming one alone is
    // already solved and already free; everything hard lives in the second owner.
    const because = asking({ owners: [{ name: 'Ana Rivera', contribution: 'cash' }] })
    expect(because).toContain('more than one owner')
    expect(because).toContain('second owner')
  })

  it('waits for every question it asked to be answered', () => {
    // Stops the agent deciding it has heard enough while somebody is still typing.
    const because = asking({ openQuestions: ['who is putting in the oven?'] })
    expect(because).toContain('who is putting in the oven?')
  })

  it('waits for permission to spend, before anything that spends', () => {
    expect(missing('spendAuthorisation')).toContain('costs money and cannot be undone')
  })
})

describe('every stage refuses for a reason about the case, never about the code', () => {
  it('never says a stage is unfinished because it has not been written', () => {
    // Until 29 August 2026 the later stages shared a helper that refused with
    // "this is not built yet". That was honest while their work did not exist.
    // All eight now do their work, and this test is what stops that answer coming
    // back: a refusal must always be about this particular case.
    for (const name of STAGE_ORDER) {
      const result = couldMoveOn(name, emptyCase('case-1'))
      if (!result.ready) {
        expect(result.because, `stage "${name}"`).not.toContain('not built yet')
      }
    }
  })
})

const sealedFingerprint = 'a'.repeat(64)

/** A case that has got as far as a sealed pack. */
const assembled: CaseFacts = {
  ...understood,
  agreement: {
    articleCount: '15',
    dated: '2026-09-03',
    blocks: ['managed-by-members', 'no-exit-exists'],
    explanation: ['Shares total exactly 100%.'],
  },
  pack: { fingerprint: sealedFingerprint, sizeBytes: '2048', refusedAfterSealing: [] },
}

describe('assembling the pack', () => {
  it('waits for an agreement to put in it', () => {
    const result = couldMoveOn('assemble', understood)
    expect(result.ready).toBe(false)
    if (!result.ready) expect(result.because).toContain('no agreement to put in the pack')
  })

  it('waits for the pack to be sealed', () => {
    const drafted = { ...assembled }
    delete (drafted as { pack?: unknown }).pack

    const result = couldMoveOn('assemble', drafted)
    expect(result.ready).toBe(false)
    if (!result.ready) expect(result.because).toContain('has not been assembled and sealed')
  })

  it('lets the case through once the pack is sealed', () => {
    expect(couldMoveOn('assemble', assembled).ready).toBe(true)
  })
})

describe('the boundary, which is where the agent stops', () => {
  const because = (facts: CaseFacts): string => {
    const result = couldMoveOn('boundary', facts)
    if (result.ready) throw new Error('expected the boundary to hold')
    return result.because
  }

  it('has no tools at all, and no turns to take', () => {
    // Not an omission. There is nothing here for a model to do, so it is given
    // nothing to do it with.
    expect(STAGES.boundary.tools).toEqual([])
    expect(STAGES.boundary.maxTurns).toBe(0)
  })

  it('holds until a person approves, and says nothing in the agent can write it', () => {
    expect(because(assembled)).toContain('no person has approved')
    expect(because(assembled)).toContain('Nothing in the agent can write that approval')
  })

  it('lets the case through on an approval for this exact pack', () => {
    const approved: CaseFacts = {
      ...assembled,
      approvalToSend: {
        approvedBy: 'Ana Rivera',
        packFingerprint: sealedFingerprint,
        approvedAt: '2026-09-03T10:00:00.000Z',
      },
    }
    expect(couldMoveOn('boundary', approved).ready).toBe(true)
  })

  it('refuses an approval given for a different pack', () => {
    // An approval that survives the document changing underneath it is how a
    // person ends up having approved something they never saw.
    const stale: CaseFacts = {
      ...assembled,
      approvalToSend: {
        approvedBy: 'Ana Rivera',
        packFingerprint: 'b'.repeat(64),
        approvedAt: '2026-09-03T10:00:00.000Z',
      },
    }
    expect(because(stale)).toContain('does not carry across to another')
  })

  it('has nothing to approve when no pack was ever sealed', () => {
    expect(because(understood)).toContain('nothing to approve')
  })
})

describe('publishing the site', () => {
  const approved: CaseFacts = {
    ...assembled,
    approvalToSend: {
      approvedBy: 'Ana Rivera',
      packFingerprint: sealedFingerprint,
      approvedAt: '2026-09-03T10:00:00.000Z',
    },
  }

  it('will not publish without a registered address', () => {
    // A site at an address we do not hold is a site that belongs to somebody else.
    const result = couldMoveOn('publish', approved)
    expect(result.ready).toBe(false)
    if (!result.ready) expect(result.because).toContain('no registered web address')
  })

  it('waits until the site is actually live', () => {
    const registered: CaseFacts = {
      ...approved,
      address: { candidate: 'riverasisters.com', available: true, registered: true },
    }
    const result = couldMoveOn('publish', registered)
    expect(result.ready).toBe(false)
    if (!result.ready) expect(result.because).toContain('has not been published yet')
  })

  it('finishes once the site is live', () => {
    const live: CaseFacts = {
      ...approved,
      address: { candidate: 'riverasisters.com', available: true, registered: true },
      site: { address: 'riverasisters.com', liveAt: 'https://riverasisters.com' },
    }
    expect(couldMoveOn('publish', live).ready).toBe(true)
  })
})

describe('drafting the agreement, and what it will not decide by itself', () => {
  const withShares = (extra: Partial<CaseFacts> = {}): CaseFacts => ({
    ...understood,
    owners: understood.owners.map((owner) => ({
      ...owner,
      sharePercent: '50',
      contributionCents: '2500000',
    })),
    ...extra,
  })

  const because = (facts: CaseFacts): string => {
    const result = couldMoveOn('draft', facts)
    if (result.ready) throw new Error('expected the stage to refuse')
    return result.because
  }

  it('will not divide the remaining share for an owner who has not stated one', () => {
    // The split is the one thing the owners have to decide themselves. A number
    // chosen by a program is a term nobody agreed to, in the article people open
    // the document to read.
    expect(because(understood)).toContain('will not divide the remainder')
  })

  it('waits for a value on every contribution, and says which statute needs it', () => {
    const unvalued = withShares({
      owners: understood.owners.map((owner) => ({ ...owner, sharePercent: '50' })),
    })
    expect(because(unvalued)).toContain('no record for the statute to read')
  })

  it('will not assume who runs the company, because neither answer is safe', () => {
    expect(because(withShares())).toContain('no safe default')
  })

  it('will not assume whether there is a way out, and says what silence means', () => {
    // Texas states that a member may not withdraw or be expelled. An agreement
    // that adds nothing leaves no way out at all, and that is a term whether or
    // not anybody meant to agree to it.
    const chosen = withShares({ agreementChoices: { managedBy: 'the owners themselves' } })
    expect(because(chosen)).toContain('may not withdraw or be expelled')
  })

  it('waits for the agreement to actually be prepared', () => {
    const answered = withShares({
      agreementChoices: { managedBy: 'the owners themselves', hasExitProcess: false },
    })
    expect(because(answered)).toContain('has not been prepared yet')
  })

  it('lets the case through once everything is answered and the document exists', () => {
    const done = withShares({
      agreementChoices: { managedBy: 'the owners themselves', hasExitProcess: false },
      agreement: {
        articleCount: '15',
        dated: '2026-09-03',
        blocks: ['managed-by-members', 'no-exit-exists'],
        explanation: ['Shares total exactly 100%.'],
      },
    })
    expect(couldMoveOn('draft', done).ready).toBe(true)
  })

  it('offers no tool that could write a term nobody was asked about', () => {
    // The model may ask, and may write down an answer. Whether there is a way out
    // of the company is checked against the record before it can be written.
    expect(STAGES.draft.tools).toContain('record_agreement_choice')
    expect(STAGES.draft.tools).toContain('draft_agreement')
    expect(STAGES.draft.tools).not.toContain('register_address')
  })
})

describe('the tool catalogue', () => {
  const printed = catalogue(registry)

  it('is generated from the code that runs, so it cannot drift', () => {
    for (const tool of registry.values()) {
      expect(printed, `"${tool.name}" is missing from the catalogue`).toContain(tool.name)
    }
  })

  it('marks what spends money and what cannot be undone', () => {
    expect(printed).toContain('spends money')
    expect(printed).toContain('cannot be undone')
  })

  it('says out loud that stage seven has no tools, and why', () => {
    // The empty stage is the most interesting entry in the whole catalogue.
    expect(printed).toContain('No tools')
    expect(printed).toContain('Its emptiness is the design')
  })

  it('states what is not on the list and cannot be reached from it', () => {
    expect(printed).toContain('Asking a person to sign')
  })

  it('explains each tool in words a person can read', () => {
    for (const tool of registry.values()) {
      expect(tool.why.length, `"${tool.name}" has no explanation`).toBeGreaterThan(60)
    }
  })
})

describe('reading identity documents, and who decides what a person sees', () => {
  const owners = understood.owners
  const because = (facts: CaseFacts): string => {
    const result = couldMoveOn('verify', facts)
    if (result.ready) throw new Error('expected the stage to refuse')
    return result.because
  }

  it('waits until every owner has had a document read', () => {
    expect(because(understood)).toContain('no identity document has been read')
  })

  it('waits while any value is still with a person, and names the values', () => {
    const half = {
      ...understood,
      identityChecks: owners.map((owner, index) => ({
        owner: owner.name,
        fieldsRead: '4',
        depth: 'understand',
        toReview: index === 0 ? ['expiry_date'] : [],
        missing: [],
        checkedByAPerson: [],
      })),
    }
    expect(because(half)).toContain('expiry_date')
  })

  it('says plainly that nothing in the agent can clear a review', () => {
    const half = {
      ...understood,
      identityChecks: owners.map((owner) => ({
        owner: owner.name,
        fieldsRead: '4',
        depth: 'understand',
        toReview: ['full_name'],
        missing: [],
        checkedByAPerson: [],
      })),
    }
    expect(because(half)).toContain('No model takes any part in that decision')
  })

  it('lets the case through when every document is read and nothing is waiting', () => {
    const done = {
      ...understood,
      identityChecks: owners.map((owner) => ({
        owner: owner.name,
        fieldsRead: '4',
        depth: 'understand',
        toReview: [],
        missing: [],
        checkedByAPerson: [],
      })),
    }
    expect(couldMoveOn('verify', done).ready).toBe(true)
  })

  it('will not leave with a required value the document never produced', () => {
    // A different problem from a doubtful value, and it cannot be cleared the same
    // way. A person looking at a document can confirm that a value was read
    // correctly. Nobody can confirm a value that is not there.
    const short = {
      ...understood,
      identityChecks: owners.map((owner) => ({
        owner: owner.name,
        fieldsRead: '3',
        depth: 'understand',
        // Empty on purpose: this is the shape the record is in AFTER somebody has
        // answered "the value is correct" to every item in the queue. Until 30
        // August 2026 that emptied the queue and the case moved on with a date of
        // birth nobody had.
        toReview: [],
        missing: ['date_of_birth'],
        checkedByAPerson: [],
      })),
    }

    expect(because(short)).toContain('date_of_birth')
    expect(because(short)).toContain('did not produce a required value')
  })

  it('says why confirming it is not the fix', () => {
    const short = {
      ...understood,
      identityChecks: owners.map((owner) => ({
        owner: owner.name,
        fieldsRead: '3',
        depth: 'understand',
        toReview: [],
        missing: ['document_number'],
        checkedByAPerson: [],
      })),
    }
    expect(because(short)).toContain('nothing to confirm')
    expect(because(short)).toContain('clearer document')
  })

  it('offers the model no tool that could clear a review', () => {
    // It may read a document. Whether a value needs a person is decided in code
    // afterwards, and there is nothing here that could reverse that.
    expect(STAGES.verify.tools).toEqual(['read_identity_document', 'record_fact'])
  })

  it('carries nobody personal details to a model in this stage', () => {
    expect(STAGES.verify.sensitivity).toBe('public')
  })
})
