/**
 * One case through all eight stages, as a test rather than as a demonstration.
 *
 * WHY THIS EXISTS, AND WHAT IT WOULD HAVE CAUGHT
 *
 * On 30 August three tool bodies in this project were replaced by stubs that
 * returned nothing at all. Every one of the 674 tests still passed, the type
 * checker was happy, the publish gate was happy, and the change was committed.
 *
 * The reason is embarrassing and worth writing down. Those three tools —  reading
 * an identity document, assembling the pack, publishing the site — had no direct
 * tests. The only thing that exercised them was `npm run agent:demo`, which is a
 * program a person runs and looks at. `npm test` never ran it. So the whole
 * back half of this product was covered by a human noticing.
 *
 * A demonstration proves something to a person who watches it. A test proves it
 * every time, to nobody in particular, including at three in the morning when
 * somebody is committing in a hurry. This project already argues that a rule the
 * build enforces beats a rule people remember. The same is true of a run.
 *
 * WHAT IS REAL HERE
 *
 * The database, the append-only record and its chain of fingerprints, the rules the
 * database enforces on that record, the stage machine, every tool, the argument
 * checking, the spending rule, the identity review rule, the pack ordering rule and
 * the boundary. All of it.
 *
 * Stood in for: the model's replies and the outside services, both written out.
 * That is the same arrangement the recorded-response cache provides, and every one
 * of those written-out answers still travels through exactly the code a real one
 * would.
 *
 * WHY IT ASSERTS ON THE RECORD RATHER THAN ON RETURN VALUES
 *
 * The record is the product. If something happened and the record does not say so,
 * it did not happen as far as anybody checking afterwards is concerned. So the
 * assertions read the record back the same way a stranger would.
 */

import { describe, expect, it, beforeAll } from 'vitest'
import { openBuiltIn, type Database } from '../src/db/driver.js'
import { migrate } from '../src/db/migrate.js'
import { fixedClock, readEvents, readPayload, verifyRun } from '../src/record/log.js'
import { buildRegistry, type Tool } from '../src/tools/registry.js'
import { ALL_TOOLS } from '../src/tools/stage-tools.js'
import {
  preparedSearch,
  preparedRegistrar,
  preparedIdentity,
  preparedPublishing,
  type Services,
} from '../src/tools/services.js'
import {
  answerQuestion,
  grantSpendPermission,
  approveSendingForSignature,
  checkIdentityField,
} from '../src/case/human.js'
import { readFacts, runStage, advance } from '../src/agent/run.js'
import type { TurnTaker } from '../src/agent/loop.js'
import type { JsonObject } from '../src/record/canonical.js'
import type { TurnResult } from '../src/model/types.js'
import type { CaseFacts } from '../src/stages/facts.js'

const CASE = 'whole-run'
const TOKEN = 'a-long-unguessable-token-for-this-case'

const choosing = (name: string, args: JsonObject): TurnResult => ({
  kind: 'tool_call',
  name,
  args,
  raw: { chose: name, arguments: args },
  usage: { inputTokens: 120, outputTokens: 40 },
})

/**
 * A stand-in for the router with no path to a network of any kind.
 *
 * Running out of written-out choices is an error rather than a quiet real call —
 * the same rule the recorded-response cache follows. A test that silently reached a
 * live service would spend a limited daily allowance and pass for the wrong reason.
 */
function scripted(choices: readonly TurnResult[]): TurnTaker {
  let at = 0
  return {
    async turn() {
      const choice = choices[at++]
      if (choice === undefined) {
        throw new Error('the run asked for more model choices than were written out')
      }
      return { ...choice, providerId: 'written-out:for-this-test' }
    },
  }
}

const passport = (owner: string, expiryLabel: 'id_match' | 'fuzzy_match') => ({
  owner,
  kind: 'passport',
  depth: 'understand',
  fields: [
    { name: 'full_name', value: owner.toUpperCase(), label: 'id_match' as const, confidence: 0.98 },
    { name: 'date_of_birth', value: '1988-04-12', label: 'id_match' as const, confidence: 0.97 },
    { name: 'document_number', value: 'X1234567', label: 'id_match' as const, confidence: 0.99 },
    { name: 'expiry_date', value: '2031-04-11', label: expiryLabel, confidence: 0.94 },
  ],
})

let db: Database
let facts: CaseFacts
let stagesFinished: string[]

beforeAll(async () => {
  db = await openBuiltIn()
  await migrate(db)

  const clock = fixedClock('2026-08-28T09:00:00.000Z', 1000)
  const registry: ReadonlyMap<string, Tool> = buildRegistry(ALL_TOOLS)
  const person = { db, caseId: CASE, token: TOKEN, expectedToken: TOKEN, clock }

  const services: Services = {
    identity: preparedIdentity({
      'ana-passport': passport('Ana Rivera', 'id_match'),
      // Deliberately only approximately matched, so the review rule has to fire.
      'lucia-passport': passport('Lucia Rivera', 'fuzzy_match'),
    }),
    publishing: preparedPublishing(),
    search: preparedSearch({
      'Rivera Sisters Bakery Texas': {
        answeredBy: 'the-first-search-service',
        hits: [
          { title: 'Zenith Plumbing LLC', url: 'https://example.com/z', snippet: 'Plumbing.' },
        ],
      },
    }),
    registrar: preparedRegistrar({
      'riverasistersbakery.com': {
        domain: 'riverasistersbakery.com',
        available: true,
        priceCents: '1299',
      },
    }),
  }

  const run = (router: TurnTaker, stage: Parameters<typeof runStage>[1]) =>
    runStage({ db, caseId: CASE, registry, router, services, clock }, stage)

  const step = (from: Parameters<typeof advance>[1]) =>
    advance({ db, caseId: CASE, registry, router: scripted([]), services, clock }, from)

  stagesFinished = []
  const note = (name: string, result: { finished: boolean }) => {
    if (result.finished) stagesFinished.push(name)
  }

  // ---- one: understand -----------------------------------------------------
  await run(
    scripted([
      choosing('record_fact', { about: 'description', value: 'Two sisters opening a bakery.' }),
      choosing('record_fact', { about: 'state', value: 'TX' }),
      choosing('record_fact', { about: 'proposed_name', value: 'Rivera Sisters Bakery' }),
      choosing('record_fact', { about: 'owner', value: 'Ana Rivera', contribution: 'cash' }),
      choosing('record_fact', { about: 'owner', value: 'Lucia Rivera', contribution: 'an oven' }),
      choosing('request_spend_permission', {
        limit_cents: 2500,
        for_what: 'registering the web address for one year',
      }),
    ]),
    'understand',
  )
  await grantSpendPermission(person, '2500', 'the web address')
  note('understand', await run(scripted([]), 'understand'))
  await step('understand')

  // ---- two: research the name ----------------------------------------------
  note(
    'research',
    await run(
      scripted([
        choosing('search_web', { query: 'Rivera Sisters Bakery Texas' }),
        choosing('compare_names', { found_names: ['Zenith Plumbing LLC'] }),
      ]),
      'research',
    ),
  )
  await step('research')

  // ---- three: secure the address -------------------------------------------
  note(
    'address',
    await run(
      scripted([
        choosing('check_address', { domain: 'riverasistersbakery.com' }),
        choosing('register_address', { domain: 'riverasistersbakery.com' }),
      ]),
      'address',
    ),
  )
  await step('address')

  // ---- four: draft the agreement -------------------------------------------
  await run(
    scripted([
      choosing('ask_question', {
        question: 'Who will run the company day to day?',
        why: 'There is no safe default for this.',
      }),
    ]),
    'draft',
  )
  await answerQuestion(person, 'Who will run the company day to day?', 'The two of us.')
  await answerQuestion(person, 'Do you want a way for an owner to leave?', 'No.')

  note(
    'draft',
    await run(
      scripted([
        choosing('record_fact', { about: 'owner_share', value: '50', owner: 'Ana Rivera' }),
        choosing('record_fact', { about: 'owner_share', value: '50', owner: 'Lucia Rivera' }),
        choosing('record_fact', {
          about: 'owner_contribution_value',
          value: '2000000',
          owner: 'Ana Rivera',
        }),
        choosing('record_fact', {
          about: 'owner_contribution_value',
          value: '2000000',
          owner: 'Lucia Rivera',
        }),
        choosing('record_agreement_choice', { which: 'managed_by', value: 'the owners themselves' }),
        choosing('record_agreement_choice', { which: 'exit_process', value: 'no' }),
        choosing('draft_agreement', {}),
      ]),
      'draft',
    ),
  )
  await step('draft')

  // ---- five: verify identity -----------------------------------------------
  await run(
    scripted([
      choosing('read_identity_document', { owner: 'Ana Rivera', document: 'ana-passport' }),
      choosing('read_identity_document', { owner: 'Lucia Rivera', document: 'lucia-passport' }),
    ]),
    'verify',
  )
  // Clear whatever is actually waiting, rather than a list written down here.
  // Two different rules put values in this queue — the match label, and the audit
  // sample — and a test that cleared one field by name would pass while silently
  // leaving the other, which is how the queue stops being a queue.
  const waiting = await readFacts(db, CASE)
  for (const check of waiting.identityChecks) {
    for (const field of check.toReview) {
      await checkIdentityField(person, check.owner, field, 'the value is correct')
    }
  }
  note('verify', await run(scripted([]), 'verify'))
  await step('verify')

  // ---- six: assemble the pack ----------------------------------------------
  note('assemble', await run(scripted([choosing('assemble_pack', {})]), 'assemble'))
  await step('assemble')

  // ---- seven: the boundary --------------------------------------------------
  const sealed = await readFacts(db, CASE)
  await approveSendingForSignature(person, 'Ana Rivera', sealed.pack?.fingerprint ?? '')
  await step('boundary')

  // ---- eight: publish --------------------------------------------------------
  note('publish', await run(scripted([choosing('publish_site', {})]), 'publish'))

  facts = await readFacts(db, CASE)
}, 120_000)

describe('a whole case, end to end', () => {
  it('finishes every one of the eight stages', () => {
    expect(stagesFinished).toEqual([
      'understand',
      'research',
      'address',
      'draft',
      'verify',
      'assemble',
      'publish',
    ])
  })

  it('leaves a record whose chain holds from the first entry to the last', async () => {
    const check = await verifyRun(db, CASE)
    expect(check.ok, 'the chain of fingerprints is broken').toBe(true)

    const events = await readEvents(db, CASE)
    expect(events.length).toBeGreaterThan(80)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The three tools that were gutted and that nothing noticed
// ─────────────────────────────────────────────────────────────────────────────

describe('the work each stage actually did, read back from the record', () => {
  it('drafted an agreement with articles and a date', () => {
    // A tool returning nothing would leave this undefined, which is exactly what
    // happened and exactly what no test was looking at.
    expect(facts.agreement).toBeDefined()
    expect(Number(facts.agreement?.articleCount)).toBeGreaterThan(10)
    expect(facts.agreement?.dated).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('read an identity document for every owner', () => {
    expect(facts.identityChecks).toHaveLength(2)
    for (const check of facts.identityChecks) {
      expect(Number(check.fieldsRead), `${check.owner} had no fields read`).toBe(4)
      expect(check.depth).toBe('understand')
    }
  })

  it('sent the approximately-matched value to a person', async () => {
    // Read from the RECORD, not from the facts. By the end of the run a person has
    // cleared the review, so the queue is empty either way — an empty queue cannot
    // tell "the rule fired and somebody looked" apart from "the rule never fired".
    // The record still holds the moment it happened.
    const events = await readEvents(db, CASE)
    const sent = events.filter((event) => event.kind === 'identity.field.sent.for.review')
    const payloads = await Promise.all(sent.map((one) => readPayload(db, CASE, one.seq)))

    // The reader was 94% confident of this value. It went to a person anyway,
    // because whether a value can be FOUND is tested before how sure the reader
    // FELT. Ana's document, identical except for that one label, produced nothing
    // from this rule.
    const fuzzy = payloads.filter((one) => one?.['label'] === 'fuzzy_match')
    expect(fuzzy, 'the match-label rule never fired at all').toHaveLength(1)
    expect(fuzzy[0]?.['owner']).toBe('Lucia Rivera')
    expect(fuzzy[0]?.['field']).toBe('expiry_date')
  })

  it('also sent a value nothing was wrong with, because of the audit sample', async () => {
    // The rule every other rule cannot cover. Everything else in the review fires
    // when something looks wrong; none of it can catch a reader that is
    // confidently, quietly wrong about a value it grounded and scored highly. The
    // only way to find that is to look at some of the ones that passed.
    //
    // Which ones are chosen is worked out from a fingerprint of the case, the
    // owner and the field name, so this test asserts a real outcome rather than
    // a coin toss: the same run always chooses the same fields.
    const events = await readEvents(db, CASE)
    const sent = events.filter((event) => event.kind === 'identity.field.sent.for.review')
    const payloads = await Promise.all(sent.map((one) => readPayload(db, CASE, one.seq)))

    const sampled = payloads.filter((one) =>
      (one?.['reasons'] as string[] | undefined)?.some((why) =>
        why.startsWith('Nothing is wrong with this value'),
      ),
    )

    expect(sampled.length, 'the audit sample never fired in a whole run').toBeGreaterThan(0)

    // What the reviewer is told. "Nothing is wrong with this value" has to be the
    // first thing they read, or they spend the review hunting for a fault that is
    // not there.
    const why = ((sampled[0]?.['reasons'] as string[] | undefined) ?? []).join(' ')
    expect(why).toMatch(/Nothing is wrong with this value/)
  })

  it('leaves nothing waiting once a person has looked', () => {
    for (const check of facts.identityChecks) {
      expect(check.toReview, `${check.owner} still has values waiting`).toEqual([])
    }
  })

  it('sealed a pack and fingerprinted exactly what was sealed', () => {
    expect(facts.pack).toBeDefined()
    expect(facts.pack?.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(Number(facts.pack?.sizeBytes)).toBeGreaterThan(0)
  })

  it('published the site at the address that was actually registered', () => {
    expect(facts.address?.registered).toBe(true)
    expect(facts.site?.address).toBe(facts.address?.candidate)
    expect(facts.site?.liveAt).toContain(facts.address?.candidate as string)
  })

  it('spent only what a person permitted, and recorded what was spent', () => {
    expect(facts.spendAuthorisation?.limitCents).toBe('2500')
    expect(Number(facts.spendAuthorisation?.spentCents)).toBe(1299)
  })
})

describe('what only a person could do, counted in the record', () => {
  it('records four kinds of entry the software cannot produce for itself', async () => {
    const events = await readEvents(db, CASE)
    const byHuman = new Set(
      events.filter((event) => event.actor === 'human').map((event) => event.kind),
    )

    // None of these four has a tool, and the code that writes them is not
    // reachable from anything the model can trigger.
    expect(byHuman).toContain('question.answered')
    expect(byHuman).toContain('spend.authorised')
    expect(byHuman).toContain('identity.field.checked')
    expect(byHuman).toContain('signature.approved')
  })

  it('has the approval naming the exact pack that was sealed', () => {
    // An approval that survives the document changing underneath it is how a
    // person ends up having approved something they never saw.
    expect(facts.approvalToSend?.packFingerprint).toBe(facts.pack?.fingerprint)
  })
})
