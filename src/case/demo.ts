/**
 * Stages one to three, end to end.
 *
 *     npm run agent:demo
 *
 * WHAT THIS SHOWS
 *
 * A whole case moving through the first three stages against a real database, a
 * real append-only record, the real stage machine and the real tools. It runs with
 * no account, no key, no network and no cost.
 *
 * WHAT IS REAL HERE AND WHAT IS STOOD IN FOR — SAID PLAINLY
 *
 * Real: the database (PostgreSQL, compiled to WebAssembly, running inside this
 * process), the record and its chain of fingerprints, the rules the database
 * enforces on that record, the stage machine, every tool, the checking of the
 * model's arguments, the correction sent back when they do not fit, the spending
 * rule, and the name comparison.
 *
 * Stood in for: the model's replies and the two outside services. The model's
 * choices below are written out rather than asked for, and the search and
 * registrar answers are prepared. That is deliberate and it is not a mock-up of
 * the machinery — every one of those answers goes through exactly the code a real
 * one would. It is the same arrangement the recorded-response cache provides, and
 * it is what lets a stranger clone this and see it work.
 *
 * Nothing here is staged in the sense that matters: no output is printed that the
 * code did not produce, and the refusals are real refusals.
 *
 * WHY THIS FILE IS NOT IN THE AGENT'S FOLDER
 *
 * It stands in for a person's browser: it grants permission to spend and answers a
 * question, which are the two things only a person can do. Living beside the
 * agent's code would have made the code that writes a person's consent reachable
 * from the agent, and the boundary check refused the build until it moved. The
 * check found that, not a person reading it.
 *
 * THE SIX THINGS WORTH WATCHING FOR
 *
 *   1. The model is offered only the current stage's tools. Watch the list change.
 *   2. It sends a wrong argument, is told exactly which field and which values are
 *      allowed, and gets it right. That feedback is what makes a free model usable.
 *   3. It reaches for a tool from a later stage. Refused — it was never offered.
 *   4. It asks for permission to spend. It cannot grant one. A person does, and
 *      the record shows a different actor for that entry.
 *   5. It tries to register an address costing more than the permission covers.
 *      Refused, and the registrar is never contacted at all.
 *   6. Whether two business names collide is decided in plain code, and the
 *      working is shown.
 */

import { openBuiltIn } from '../db/driver.js'
import { migrate } from '../db/migrate.js'
import { fixedClock, readEvents, verifyRun } from '../record/log.js'
import { describeCheck } from '../record/chain.js'
import { buildRegistry, catalogue, type Tool } from '../tools/registry.js'
import { ALL_TOOLS } from '../tools/stage-tools.js'
import { preparedSearch, preparedRegistrar, preparedIdentity, type Services } from '../tools/services.js'
import { grantSpendPermission, answerQuestion } from './human.js'
import { STAGES, type StageName } from '../stages/stages.js'
import { readFacts, runStage, advance } from '../agent/run.js'
import type { TurnTaker } from '../agent/loop.js'
import type { JsonObject } from '../record/canonical.js'
import type { TurnResult } from '../model/types.js'

const CASE = 'demo-bakery'
const TOKEN = 'a-long-unguessable-token-for-this-case'

const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const OFF = '\x1b[0m'

const rule = () => console.log(`${DIM}${'─'.repeat(74)}${OFF}`)
const heading = (text: string) => {
  console.log('')
  rule()
  console.log(`${BOLD}  ${text}${OFF}`)
  rule()
}

/** The model's choices, written out. Each is one turn. */
const choosing = (name: string, args: JsonObject): TurnResult => ({
  kind: 'tool_call',
  name,
  args,
  raw: { chose: name, arguments: args },
  usage: { inputTokens: 120, outputTokens: 40 },
})

/**
 * A stand-in for the router that hands back the next written-out choice.
 *
 * It has no path to a network of any kind. Running out of prepared choices is an
 * error rather than a quiet real call, which is the same rule the recorded
 * response cache follows: a miss must never become a request.
 */
function scripted(choices: readonly TurnResult[]): TurnTaker {
  let at = 0
  return {
    async turn() {
      const choice = choices[at++]
      if (choice === undefined) {
        throw new Error(
          'the demonstration ran out of written-out model choices. Nothing was ' +
            'called: this stand-in has no path to a real model at all.',
        )
      }
      return { ...choice, providerId: 'written-out:for-this-demonstration' }
    },
  }
}

function watching(): (kind: string, stage: StageName, detail: string) => void {
  return (kind, stage, detail) => {
    const mark =
      kind.includes('refused') || kind.includes('rejected')
        ? `${YELLOW}!${OFF}`
        : kind === 'tool.ran'
          ? `${GREEN}·${OFF}`
          : `${DIM}·${OFF}`
    console.log(`  ${mark} ${DIM}${stage.padEnd(10)}${OFF} ${kind.padEnd(26)} ${detail}`)
  }
}

async function main(): Promise<void> {
  const db = await openBuiltIn()
  await migrate(db)

  const clock = fixedClock('2026-08-28T09:00:00.000Z', 1000)
  const registry: ReadonlyMap<string, Tool> = buildRegistry(ALL_TOOLS)

  const services: Services = {
    // No identity document is read in this demonstration, and none is prepared.
    // A request for one is an error rather than a quiet real call.
    identity: preparedIdentity({}),
    search: preparedSearch({
      'Rivera Sisters Bakery Texas': {
        answeredBy: 'the-first-search-service',
        hits: [
          {
            title: 'Zenith Plumbing LLC — Austin, TX',
            url: 'https://example.com/zenith',
            snippet: 'Plumbing services in central Austin.',
          },
          {
            title: 'Riviera Boat Hire',
            url: 'https://example.com/riviera',
            snippet: 'Boats on Lake Travis.',
          },
        ],
      },
    }),
    registrar: preparedRegistrar({
      'riverasistersbakery.com': {
        domain: 'riverasistersbakery.com',
        available: true,
        priceCents: '1299',
      },
      'riverabakery.com': {
        domain: 'riverabakery.com',
        available: true,
        // Deliberately above the permission the owners will grant.
        priceCents: '9900',
      },
    }),
  }

  // ── Stage one ──────────────────────────────────────────────────────────────
  heading('Stage 1 of 8 — Understand')
  console.log(
    `  ${DIM}The model is offered only this stage's tools: ` +
      `${STAGES.understand.tools.join(', ')}${OFF}\n`,
  )

  const stageOne = scripted([
    choosing('ask_question', {
      question: 'Which of you is putting in the oven, and roughly what is it worth?',
      why: 'What each owner puts in decides the shares, and the shares decide the agreement.',
    }),
  ])

  const asked = await runStage(
    { db, caseId: CASE, registry, router: stageOne, services, clock, onEvent: watching() },
    'understand',
  )
  console.log(`\n  ${YELLOW}Stopped:${OFF} ${asked.because}`)
  console.log(
    `  ${DIM}No further turns are taken. Asking the model again would spend a request\n` +
      `  from a daily allowance to learn nothing.${OFF}\n`,
  )

  await answerQuestion(
    { db, caseId: CASE, token: TOKEN, expectedToken: TOKEN, clock },
    'Which of you is putting in the oven, and roughly what is it worth?',
    'Lucia is. It is a commercial oven she already owns, worth about $12,000.',
  )
  console.log(`  ${GREEN}·${OFF} A person answered. The run carries on.\n`)

  const stageOneAgain = scripted([
    choosing('record_fact', {
      about: 'description',
      value:
        'Two sisters opening a bakery in Austin. Ana is putting in $20,000 cash, ' +
        'Lucia is putting in a commercial oven she already owns.',
    }),
    choosing('record_fact', { about: 'state', value: 'TX' }),
    choosing('record_fact', { about: 'proposed_name', value: 'Rivera Sisters Bakery' }),
    choosing('record_fact', { about: 'owner', value: 'Ana Rivera', contribution: '$20,000 in cash' }),
    // Wrong on purpose: the field is called `about`, and `owner_name` is not a
    // field this tool has. Watch what it is told, and what it does next.
    choosing('record_fact', { about: 'owner', owner_name: 'Lucia Rivera' }),
    choosing('record_fact', {
      about: 'owner',
      value: 'Lucia Rivera',
      contribution: 'a commercial oven she already owns, worth about $12,000',
    }),
    // Reaching for a tool from stage three. It was never offered here.
    choosing('register_address', { domain: 'riverasistersbakery.com' }),
    choosing('request_spend_permission', {
      limit_cents: 2500,
      for_what: 'registering the web address for one year',
    }),
  ])

  const one = await runStage(
    { db, caseId: CASE, registry, router: stageOneAgain, services, clock, onEvent: watching() },
    'understand',
  )
  console.log(`\n  ${YELLOW}Stopped:${OFF} ${one.because}`)

  // ── The part only a person can do ──────────────────────────────────────────
  heading('What only a person can do')
  console.log(
    `  ${DIM}The agent asked to spend. It has no tool that grants permission, and the\n` +
      `  code that writes one is not reachable from anything the model can trigger.\n` +
      `  A test walks the whole import graph and fails the build if that changes.${OFF}\n`,
  )
  await grantSpendPermission(
    { db, caseId: CASE, token: TOKEN, expectedToken: TOKEN, clock },
    '2500',
    'registering the web address for one year',
  )
  console.log(`  ${GREEN}·${OFF} A person granted permission to spend up to $25.00.`)

  try {
    await grantSpendPermission(
      { db, caseId: CASE, token: 'a-guess', expectedToken: TOKEN, clock },
      '999999',
      'anything at all',
    )
  } catch (error) {
    console.log(
      `  ${YELLOW}!${OFF} A grant without the case token was refused. ` +
        `${DIM}${error instanceof Error ? error.name : 'refused'}${OFF}`,
    )
  }

  const afterGrant = await runStage(
    { db, caseId: CASE, registry, router: scripted([]), services, clock, onEvent: watching() },
    'understand',
  )
  console.log(
    `\n  ${afterGrant.finished ? GREEN : YELLOW}Stage 1 ${afterGrant.finished ? 'finished' : 'stopped'}:${OFF} ` +
      `${afterGrant.because}`,
  )

  // ── Stage two ──────────────────────────────────────────────────────────────
  const two = await advance(
    { db, caseId: CASE, registry, router: scripted([]), services, clock },
    'understand',
  )
  heading(`Stage 2 of 8 — ${two === undefined ? '?' : STAGES[two].title}`)
  console.log(
    `  ${DIM}Different stage, different tools: ${STAGES.research.tools.join(', ')}\n` +
      `  Whether two names collide is decided in plain code, not by the model.${OFF}\n`,
  )

  const stageTwo = scripted([
    choosing('search_web', { query: 'Rivera Sisters Bakery Texas' }),
    choosing('compare_names', { found_names: ['Zenith Plumbing LLC', 'Riviera Boat Hire'] }),
  ])
  const research = await runStage(
    { db, caseId: CASE, registry, router: stageTwo, services, clock, onEvent: watching() },
    'research',
  )
  console.log(
    `\n  ${research.finished ? GREEN : YELLOW}Stage 2 ${research.finished ? 'finished' : 'stopped'}:${OFF} ` +
      `${research.because}`,
  )

  // ── Stage three ────────────────────────────────────────────────────────────
  const three = await advance(
    { db, caseId: CASE, registry, router: scripted([]), services, clock },
    'research',
  )
  heading(`Stage 3 of 8 — ${three === undefined ? '?' : STAGES[three].title}`)
  console.log(
    `  ${DIM}This stage holds the one tool that spends money and cannot be undone.${OFF}\n`,
  )

  const stageThree = scripted([
    // An address costing more than the permission covers.
    choosing('check_address', { domain: 'riverabakery.com' }),
    choosing('register_address', { domain: 'riverabakery.com' }),
    // The one the owners actually asked for, inside the permission.
    choosing('check_address', { domain: 'riverasistersbakery.com' }),
    choosing('register_address', { domain: 'riverasistersbakery.com' }),
  ])
  const address = await runStage(
    { db, caseId: CASE, registry, router: stageThree, services, clock, onEvent: watching() },
    'address',
  )
  console.log(
    `\n  ${address.finished ? GREEN : YELLOW}Stage 3 ${address.finished ? 'finished' : 'stopped'}:${OFF} ` +
      `${address.because}`,
  )

  // ── What the record now holds ──────────────────────────────────────────────
  heading('The record')
  const events = await readEvents(db, CASE)
  const byActor = new Map<string, number>()
  for (const event of events) byActor.set(event.actor, (byActor.get(event.actor) ?? 0) + 1)

  console.log(`  ${events.length} entries, each carrying the fingerprint of the one before it.\n`)
  for (const [actor, count] of [...byActor].sort()) {
    console.log(`    ${String(count).padStart(3)} caused by ${actor}`)
  }
  console.log(
    `\n  ${DIM}The entry granting permission to spend is the only one caused by a human,\n` +
      `  and it is the only reason anything was allowed to be bought.${OFF}\n`,
  )

  const check = await verifyRun(db, CASE)
  console.log(`  ${check.ok ? GREEN : YELLOW}${describeCheck(check).split('\n')[0]}${OFF}`)

  const facts = await readFacts(db, CASE)
  console.log(`\n  What Charter knows, read back from the record:`)
  console.log(`    name       ${facts.proposedName ?? '(none)'}`)
  console.log(`    state      ${facts.state ?? '(none)'}`)
  console.log(`    owners     ${facts.owners.map((owner) => owner.name).join(', ') || '(none)'}`)
  console.log(
    `    spending   ${facts.spendAuthorisation === undefined ? '(no permission)' : `${facts.spendAuthorisation.spentCents} of ${facts.spendAuthorisation.limitCents} cents used`}`,
  )
  console.log(
    `    address    ${facts.address?.candidate ?? '(none)'} ` +
      `${facts.address?.registered === true ? '(registered)' : ''}`,
  )

  // ── The catalogue ──────────────────────────────────────────────────────────
  heading('Everything this agent can do')
  console.log(catalogue(registry))

  await db.close()
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
