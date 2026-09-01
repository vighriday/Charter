/**
 * All eight stages, end to end.
 *
 *     npm run agent:demo
 *
 * WHAT THIS SHOWS
 *
 * A whole case moving from a plain-English description through to a published
 * website, against a real database, a real append-only record, the real stage
 * machine and the real tools. It runs with no account, no key, no network and no
 * cost.
 *
 * WHAT IS REAL HERE AND WHAT IS STOOD IN FOR — SAID PLAINLY
 *
 * Real: the database (PostgreSQL, compiled to WebAssembly, running inside this
 * process), the record and its chain of fingerprints, the rules the database
 * enforces on that record, the stage machine, every tool, the checking of the
 * model's arguments, the correction sent back when they do not fit, the spending
 * rule, and the name comparison.
 *
 * Also real: the settings, checked before anything runs, and the SEAL — a real
 * certificate on a real multi-page PDF at permission level 2, which is "filling in
 * and signing, and nothing else".
 *
 * Stood in for: the model's replies, and all FOUR outside services — search, the
 * registrar, the identity reader, and publishing. The model's choices below are
 * written out rather than asked for, and each service is a stand-in holding
 * answers recorded in advance with no path to a network at all, so a missing
 * answer is an error rather than a quiet real call. That is deliberate and it is
 * not a mock-up of the machinery — every one of those answers goes through exactly
 * the code a real one would. It is what lets a stranger clone this and see it work.
 *
 * The run prints all of this itself, before it does anything, rather than leaving
 * it to be found.
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
 * THE NINE THINGS WORTH WATCHING FOR
 *
 *   1. The model is offered only the current stage's tools. Watch the list change.
 *      A tool absent from a stage is not forbidden there — it does not exist there.
 *   2. It sends a wrong argument, is told exactly which field and which values are
 *      allowed, and gets it right. That feedback is what makes a free model usable.
 *   3. It reaches for a tool from a later stage. Refused — it was never offered.
 *   4. It asks for permission to spend. It cannot grant one. A person does, and
 *      the record shows a different actor for that entry.
 *   5. It tries to register an address costing more than the permission covers.
 *      Refused, and the registrar is never contacted at all.
 *   6. Whether two business names collide is decided in plain code, and the
 *      working is shown.
 *   7. The agreement is drafted, and Charter refuses to choose two of its terms —
 *      who runs the company, and whether there is a written way for an owner to
 *      leave. Neither has a safe default, so the tool that would write either one
 *      down refuses until the record shows a person was asked and answered.
 *   8. Values read from an identity document go to a person. One because it could
 *      only be matched approximately, though the reader was 94% sure of it — the
 *      question of whether a value can be FOUND is tested before how sure the
 *      reader FELT. Others because of the audit sample, which sends a share of the
 *      readings that passed every test to a person anyway, since nothing else can
 *      catch a reader that is confidently and quietly wrong.
 *   9. The run reaches the boundary and stops. Stage seven has no tools at all. A
 *      person approves sending the pack, naming it by its fingerprint, and only
 *      then does the last stage run.
 */

import { openBuiltIn } from '../db/driver.js'
import { migrate } from '../db/migrate.js'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixedClock, readEvents, readHead, readPayload, verifyRun } from '../record/log.js'
import { attest, generateKeyPair, privateKeyFromEnv } from '../record/attestation.js'
import { anchorHead } from '../record/anchor.js'

import { describeCheck } from '../record/chain.js'
import { buildRegistry, catalogue, type Tool } from '../tools/registry.js'
import { ALL_TOOLS } from '../tools/stage-tools.js'
import type { ReadDocument } from '../identity/fields.js'
import {
  grantSpendPermission,
  answerQuestion,
  approveSendingForSignature,
  checkIdentityField,
} from './human.js'
import { STAGES, couldMoveOn, type StageName } from '../stages/stages.js'
import { readFacts, runStage, advance, describe } from '../agent/run.js'
import { renderReport, type FeedEntry } from '../screens/report.js'
import { buildAgreementDocx } from '../pack/docx.js'
import { prepareAgreement } from '../agreement/prepare.js'
import type { TurnTaker } from '../agent/loop.js'
import type { JsonObject } from '../record/canonical.js'
import type { TurnResult } from '../model/types.js'
import { loadEnvFile, readSettings, SettingRefusal } from '../settings.js'
import { buildRouter } from '../model/build.js'
import { chooseServices, describeChoices, howManyAreReal } from '../vendors/build.js'

/** Where a run leaves the three files somebody needs to check it. Never committed. */
const OUT = 'out'

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
  // Settings first, before anything else happens.
  //
  // `.env` is read from disk and fills in anything the surrounding environment
  // has not already said — the environment wins, because a value somebody set for
  // this one run must not be overridden by a file. Then every setting is checked,
  // and a value that cannot mean anything stops the program here with an
  // explanation rather than being quietly replaced by a default halfway through.
  //
  // Read once, at the edge of the program, and carried down. Nothing deeper reads
  // the environment for itself, so this run can be reproduced by anybody holding
  // the same settings rather than by anybody who happens to have the same shell.
  loadEnvFile()
  const settings = readSettings()

  const db = await openBuiltIn()
  await migrate(db)

  const clock = fixedClock('2026-08-28T09:00:00.000Z', 1000)
  const registry: ReadonlyMap<string, Tool> = buildRegistry(ALL_TOOLS)

  // What the stand-ins answer with. Written out here rather than fetched, because
  // this walkthrough has to produce the same record every time so it can be checked
  // line by line.
  //
  // These go to chooseServices, which is the same code the running product uses to
  // decide, per service, between the real company and a stand-in. So this
  // demonstration takes the same path a real run does — it is not a second
  // arrangement that happens to look similar.
  const preparedAnswers: {
    readonly documents: Readonly<Record<string, ReadDocument>>
    readonly searches: Readonly<Record<string, { readonly hits: readonly { readonly title: string; readonly url: string; readonly snippet: string }[]; readonly answeredBy: string }>>
    readonly quotes: Readonly<Record<string, { readonly domain: string; readonly available: boolean; readonly priceCents?: string }>>
  } = {
    // Two invented documents. No real person's identity document is used here,
    // and none ever will be: that is a rule of this project, not a limit of a
    // free tier. Lucia's expiry date is deliberately one the reader could only
    // match approximately, so the review rule can be seen firing.
    documents: {
      'ana-passport': {
        owner: 'Ana Rivera',
        kind: 'passport',
        depth: 'understand',
        fields: [
          { name: 'full_name', value: 'ANA MARIA RIVERA', label: 'id_match', confidence: 0.98 },
          { name: 'date_of_birth', value: '1988-04-12', label: 'id_match', confidence: 0.97 },
          { name: 'document_number', value: 'X1234567', label: 'id_match', confidence: 0.99 },
          { name: 'expiry_date', value: '2031-04-11', label: 'id_match', confidence: 0.96 },
        ],
      },
      'lucia-passport': {
        owner: 'Lucia Rivera',
        kind: 'passport',
        depth: 'understand',
        fields: [
          { name: 'full_name', value: 'LUCIA RIVERA', label: 'id_match', confidence: 0.98 },
          { name: 'date_of_birth', value: '1991-11-02', label: 'id_match', confidence: 0.96 },
          { name: 'document_number', value: 'X7654321', label: 'id_match', confidence: 0.98 },
          // Approximately matched. The reader was confident; it still goes to a
          // person, because the label is tested before the number.
          { name: 'expiry_date', value: '2030-08-19', label: 'fuzzy_match', confidence: 0.94 },
        ],
      },
    },
    searches: {
      // The first search finds a bakery already trading under the exact name the
      // owners chose. This is the beat that matters: a live search changes the
      // decision. No trained model could have known this business exists, because
      // it opened after every model was trained.
      'Rivera Sisters Bakery Texas': {
        answeredBy: 'the-first-search-service',
        hits: [
          {
            title: 'Rivera Sisters Bakery',
            url: 'https://example.com/rivera-sisters-bakery',
            snippet: 'Family bakery on South Congress. Open since March. Austin, TX.',
          },
          {
            title: 'Zenith Plumbing LLC — Austin, TX',
            url: 'https://example.com/zenith',
            snippet: 'Plumbing services in central Austin.',
          },
        ],
      },
      // The second search, after the owners changed the name.
      'Rivera Sisters Baking Co Texas': {
        answeredBy: 'the-first-search-service',
        hits: [
          {
            title: 'Riviera Boat Hire',
            url: 'https://example.com/riviera',
            snippet: 'Boats on Lake Travis.',
          },
        ],
      },
    },
    quotes: {
      // The first choice is gone. Somebody else holds it, which is the ordinary
      // case and almost never demonstrated.
      'riverasistersbaking.com': {
        domain: 'riverasistersbaking.com',
        available: false,
      },
      // The second is free and costs more than the owners agreed to spend.
      'riverabaking.com': {
        domain: 'riverabaking.com',
        available: true,
        priceCents: '9900',
      },
      // The third is free and inside the permission.
      'riverasistersbakingco.com': {
        domain: 'riverasistersbakingco.com',
        available: true,
        priceCents: '1299',
      },
    },
  }

  // The four outside services, chosen by the same code the running product uses.
  //
  // Each one is either the real company or a stand-in, and which it is depends on
  // two things: whether REPLAY_MODE was turned off deliberately, and whether the
  // credential that service needs is actually present. On a fresh clone all four
  // are stand-ins and the run still finishes, which is the point.
  const services = chooseServices({
    settings,
    caseId: CASE,
    env: process.env,
    prepared: preparedAnswers,
  })

  // ── What is real, said before anything runs ───────────────────────────────
  //
  // A judge is entitled to ask whether this only works because everything is
  // pretend. The honest answer is printed here, at the top, rather than left to be
  // discovered — and it is generated from the same decision the code just made,
  // not written out beside it where it could drift.
  heading('What is real in this run')

  const models = buildRouter({ settings, env: process.env })
  console.log(`  ${DIM}models       ${models.why}${OFF}`)
  console.log(
    `  ${DIM}the model    a written-out stand-in, so this walkthrough produces the same
` +
      `               record every time and can be checked line by line${OFF}`,
  )
  console.log('')
  for (const line of describeChoices(services)) console.log(`  ${DIM}${line}${OFF}`)
  console.log('')
  console.log(
    `  ${DIM}the seal     REAL. A self-issued certificate on a real multi-page PDF, at
` +
      `               permission level 2 — filling in and signing, and nothing else${OFF}`,
  )
  console.log(
    `  ${DIM}the record   REAL. Every entry fingerprinted with the one before it, and
` +
      `               the end of it attested. Check it with: npm run verify${OFF}`,
  )
  console.log(
    `  ${DIM}settings     depth ${settings.extractionDepth} (EXTRACTION_DEPTH), review floor ` +
      `${settings.reviewConfidenceFloor}, audit sample ${settings.reviewAuditSampleRate}${OFF}`,
  )
  console.log('')
  console.log(
    `  ${DIM}${howManyAreReal(services)} of the four outside services are talking to a real ` +
      `company in this run.${OFF}`,
  )

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
    { db, caseId: CASE, registry, router: stageOne, services, clock, settings, onEvent: watching() },
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
    { db, caseId: CASE, registry, router: stageOneAgain, services, clock, settings, onEvent: watching() },
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
    { db, caseId: CASE, registry, router: scripted([]), services, clock, settings, onEvent: watching() },
    'understand',
  )
  console.log(
    `\n  ${afterGrant.finished ? GREEN : YELLOW}Stage 1 ${afterGrant.finished ? 'finished' : 'stopped'}:${OFF} ` +
      `${afterGrant.because}`,
  )

  // ── Stage two ──────────────────────────────────────────────────────────────
  const two = await advance(
    { db, caseId: CASE, registry, router: scripted([]), services, clock, settings },
    'understand',
  )
  heading(`Stage 2 of 8 — ${two === undefined ? '?' : STAGES[two].title}`)
  console.log(
    `  ${DIM}Different stage, different tools: ${STAGES.research.tools.join(', ')}\n` +
      `  Whether two names collide is decided in plain code, not by the model.${OFF}\n`,
  )

  const stageTwo = scripted([
    choosing('search_web', { query: 'Rivera Sisters Bakery Texas' }),
    // The comparison is made in plain code. The model hands over what it found and
    // is told the verdict; it does not reach one.
    choosing('compare_names', {
      found_names: ['Rivera Sisters Bakery', 'Zenith Plumbing LLC'],
    }),
    // The verdict came back "collides", so the name has to change. This is the
    // decision changing because of something found live.
    choosing('record_fact', { about: 'proposed_name', value: 'Rivera Sisters Baking Co' }),
    choosing('search_web', { query: 'Rivera Sisters Baking Co Texas' }),
    choosing('compare_names', { found_names: ['Riviera Boat Hire'] }),
  ])
  const research = await runStage(
    { db, caseId: CASE, registry, router: stageTwo, services, clock, settings, onEvent: watching() },
    'research',
  )
  console.log(
    `\n  ${research.finished ? GREEN : YELLOW}Stage 2 ${research.finished ? 'finished' : 'stopped'}:${OFF} ` +
      `${research.because}`,
  )

  // ── Stage three ────────────────────────────────────────────────────────────
  const three = await advance(
    { db, caseId: CASE, registry, router: scripted([]), services, clock, settings },
    'research',
  )
  heading(`Stage 3 of 8 — ${three === undefined ? '?' : STAGES[three].title}`)
  console.log(
    `  ${DIM}This stage holds the one tool that spends money and cannot be undone.${OFF}\n`,
  )

  const stageThree = scripted([
    // The first choice. Somebody else already holds it.
    choosing('check_address', { domain: 'riverasistersbaking.com' }),
    choosing('register_address', { domain: 'riverasistersbaking.com' }),
    // The second. Free, and dearer than the owners agreed to spend.
    choosing('check_address', { domain: 'riverabaking.com' }),
    choosing('register_address', { domain: 'riverabaking.com' }),
    // The third. Free, and inside the permission.
    choosing('check_address', { domain: 'riverasistersbakingco.com' }),
    choosing('register_address', { domain: 'riverasistersbakingco.com' }),
    // Registering a name and pointing it somewhere are two different acts.
    choosing('set_address_records', { domain: 'riverasistersbakingco.com' }),
    // And accepted is not the same as stored, so the records are read back.
    choosing('list_address_records', { domain: 'riverasistersbakingco.com' }),
  ])
  const address = await runStage(
    { db, caseId: CASE, registry, router: stageThree, services, clock, settings, onEvent: watching() },
    'address',
  )
  console.log(
    `\n  ${address.finished ? GREEN : YELLOW}Stage 3 ${address.finished ? 'finished' : 'stopped'}:${OFF} ` +
      `${address.because}`,
  )

  // ── Stage four ─────────────────────────────────────────────────────────────
  const four = await advance(
    { db, caseId: CASE, registry, router: scripted([]), services, clock, settings },
    'address',
  )
  heading(`Stage 4 of 8 — ${four === undefined ? '?' : STAGES[four].title}`)
  console.log(
    `  ${DIM}Every number, every article number and every cross-reference is worked\n` +
      `  out in plain code. The model chooses when, and nothing about what.${OFF}\n`,
  )

  // Charter refuses to draft before the owners have answered the two questions
  // that have no safe default, so it asks them first.
  const stageFourAsking = scripted([
    choosing('ask_question', {
      question: 'Who will run the company day to day — the two of you, or someone you appoint?',
      why: 'There is no safe default. One answer lets either owner bind the company; the other takes that away from both.',
    }),
  ])
  const asking = await runStage(
    { db, caseId: CASE, registry, router: stageFourAsking, services, clock, settings, onEvent: watching() },
    'draft',
  )
  console.log(`\n  ${YELLOW}Stopped:${OFF} ${asking.because}\n`)

  await answerQuestion(
    { db, caseId: CASE, token: TOKEN, expectedToken: TOKEN, clock },
    'Who will run the company day to day — the two of you, or someone you appoint?',
    'The two of us.',
  )
  await answerQuestion(
    { db, caseId: CASE, token: TOKEN, expectedToken: TOKEN, clock },
    'Do you want a written way for an owner to leave and be bought out?',
    'No. We have not agreed one.',
  )
  // The third question, and the one worth watching.
  //
  // One owner is putting in $20,000 cash. The other is putting in an oven she
  // already owns, and when asked what it is worth a person said "about $12,000".
  // Those two numbers do not make an even split, and an even split is what the
  // shares say.
  //
  // What used to happen here: the model wrote down $20,000 for both, nobody was
  // asked, and the finished packet said the oven was "worth about $12,000, valued
  // at $20,000.00" on the same page. The number was invented to make the
  // arithmetic work.
  //
  // It is not a small thing to invent. Texas allocates profit by contribution value
  // AS STATED IN THE COMPANY'S RECORDS, and this agreement is that record, so that
  // number decides how money is split for as long as the company exists.
  //
  // The two of them may very well agree to credit the oven at $20,000 — it is an
  // ordinary and sensible thing to agree, and it is the honest reason the split is
  // even. So they are asked, and the tool refuses the value until they have
  // answered.
  await answerQuestion(
    { db, caseId: CASE, token: TOKEN, expectedToken: TOKEN, clock },
    'The oven was said to be worth about $12,000 and the cash is $20,000. For the ' +
      'agreement, what value do you both agree to credit each contribution at?',
    'We agree to credit them equally, at $20,000 each. The oven is worth less on ' +
      'paper but it is what makes the bakery work, and we want an even split.',
  )
  console.log(`  ${GREEN}·${OFF} Three people answered. The run carries on.\n`)
  console.log(
    `  ${DIM}The third one is the one to watch. What a contribution is WORTH is a term\n` +
      `  of the deal, not an observation, and Texas splits profit by that number. The\n` +
      `  tool refuses to write one down that nobody has said out loud.${OFF}\n`,
  )

  const stageFourAgain = scripted([
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
  ])
  const draft = await runStage(
    { db, caseId: CASE, registry, router: stageFourAgain, services, clock, settings, onEvent: watching() },
    'draft',
  )
  console.log(
    `\n  ${draft.finished ? GREEN : YELLOW}Stage 4 ${draft.finished ? 'finished' : 'stopped'}:${OFF} ` +
      `${draft.because}`,
  )

  const drafted = await readFacts(db, CASE)
  if (drafted.agreement !== undefined) {
    console.log('')
    for (const line of drafted.agreement.explanation) console.log(`    ${DIM}${line}${OFF}`)
  }

  // ── Stage five ─────────────────────────────────────────────────────────────
  const five = await advance(
    { db, caseId: CASE, registry, router: scripted([]), services, clock, settings },
    'draft',
  )
  heading(`Stage 5 of 8 — ${five === undefined ? '?' : STAGES[five].title}`)
  console.log(
    `  ${DIM}Whether a value needs a person is decided by a fixed comparison in code.\n` +
      `  No model takes any part in it, and nothing here can clear a review.${OFF}\n`,
  )

  const stageFive = scripted([
    choosing('read_identity_document', { owner: 'Ana Rivera', document: 'ana-passport' }),
    choosing('read_identity_document', { owner: 'Lucia Rivera', document: 'lucia-passport' }),
  ])
  const identity = await runStage(
    { db, caseId: CASE, registry, router: stageFive, services, clock, settings, onEvent: watching() },
    'verify',
  )
  console.log(
    `\n  ${identity.finished ? GREEN : YELLOW}Stage 5 ${identity.finished ? 'finished' : 'stopped'}:${OFF} ` +
      `${identity.because}`,
  )
  console.log(
    `\n  ${DIM}The reader was 94% confident of that value. It went to a person anyway,\n` +
      `  because it could only be matched approximately — and the label is tested\n` +
      `  before the number. Nothing in the agent can clear it.${OFF}\n`,
  )

  // A person looks, in their own browser, along a path nothing in the agent can
  // reach. Every value waiting is cleared, whatever put it there — the match
  // label, or the audit sample. Clearing one field by name here would leave the
  // other waiting and the stage would refuse to move, which is exactly right and
  // would look like a bug.
  const waiting = await readFacts(db, CASE)
  for (const check of waiting.identityChecks) {
    for (const field of check.toReview) {
      await checkIdentityField(
        { db, caseId: CASE, token: TOKEN, expectedToken: TOKEN, clock },
        check.owner,
        field,
        'the value is correct',
      )
      console.log(
        `  ${GREEN}·${OFF} A person checked ${check.owner}'s ${field.replace(/_/g, ' ')} ` +
          `against the document and confirmed it.`,
      )
    }
  }

  // ── Stage six ──────────────────────────────────────────────────────────────
  const six = await advance(
    { db, caseId: CASE, registry, router: scripted([]), services, clock, settings },
    'verify',
  )
  heading(`Stage 6 of 8 — ${six === undefined ? '?' : STAGES[six].title}`)
  console.log(
    `  ${DIM}Merge, then seal, then fingerprint the sealed bytes. Nothing that would\n` +
      `  rewrite the file may run afterwards.${OFF}\n`,
  )

  const assembled = await runStage(
    {
      db,
      caseId: CASE,
      registry,
      router: scripted([choosing('assemble_pack', {})]),
      services,
      clock,
      settings,
      // The one way the finished bytes leave this process. The record keeps the
      // fingerprint of them and never the bytes, so a person handed the file
      // compares it against the record rather than being handed both by us.
      keepPack: async (bytes) => {
        mkdirSync(OUT, { recursive: true })
        writeFileSync(join(OUT, 'pack.pdf'), bytes)
      },
      onEvent: watching(),
    },
    'assemble',
  )
  console.log(
    `\n  ${assembled.finished ? GREEN : YELLOW}Stage 6 ${assembled.finished ? 'finished' : 'stopped'}:${OFF} ` +
      `${assembled.because}`,
  )

  const sealedFacts = await readFacts(db, CASE)
  const sealedPack = sealedFacts.pack
  if (sealedPack !== undefined) {
    console.log(`\n    sealed ${sealedPack.sizeBytes} bytes`)
    console.log(`    fingerprint ${sealedPack.fingerprint}`)
  }

  // ── Stage seven ────────────────────────────────────────────────────────────
  const seven = await advance(
    { db, caseId: CASE, registry, router: scripted([]), services, clock, settings },
    'assemble',
  )
  heading(`Stage 7 of 8 — ${seven === undefined ? '?' : STAGES[seven].title}`)
  console.log(
    `  ${DIM}This stage has no tools. That is the design, not an omission.${OFF}\n`,
  )

  const held = couldMoveOn('boundary', sealedFacts)
  console.log(`  ${YELLOW}Held:${OFF} ${held.ready ? '(it did not hold)' : held.because}\n`)

  // A person approves, in their own browser, along a path nothing in the agent
  // can reach. This is not a signature and never becomes one.
  await approveSendingForSignature(
    { db, caseId: CASE, token: TOKEN, expectedToken: TOKEN, clock },
    'Ana Rivera',
    sealedPack?.fingerprint ?? '',
  )
  console.log(
    `  ${GREEN}·${OFF} A person approved sending this exact pack — named by its fingerprint.\n` +
      `    ${DIM}The owners sign it themselves. Charter signs nothing for anybody.${OFF}\n`,
  )

  // ── Stage eight ────────────────────────────────────────────────────────────
  const eight = await advance(
    { db, caseId: CASE, registry, router: scripted([]), services, clock, settings },
    'boundary',
  )
  heading(`Stage 8 of 8 — ${eight === undefined ? '?' : STAGES[eight].title}`)

  const published = await runStage(
    {
      db,
      caseId: CASE,
      registry,
      // The picture is drawn from the sentence the owners typed in stage one,
      // which is already in the record because it started the legal work. A
      // business formed this morning owns no photographs.
      router: scripted([choosing('draw_storefront', {}), choosing('publish_site', {})]),
      services,
      clock,
      settings,
      onEvent: watching(),
    },
    'publish',
  )
  console.log(
    `\n  ${published.finished ? GREEN : YELLOW}Stage 8 ${published.finished ? 'finished' : 'stopped'}:${OFF} ` +
      `${published.because}`,
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
    `\n  ${DIM}Every entry caused by a human is one the software could not produce for\n` +
      `  itself: answering a question, granting permission to spend, checking a value\n` +
      `  against a document, and approving that the pack be sent. None of the four has\n` +
      `  a tool, and none of them is reachable from anything the model can trigger.${OFF}\n`,
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
  console.log(
    `    agreement  ${facts.agreement === undefined ? '(not drafted)' : `${facts.agreement.articleCount} articles, dated ${facts.agreement.dated}`}`,
  )
  console.log(
    `    identity   ${facts.identityChecks.length} document(s) read, ` +
      `${facts.identityChecks.reduce((count, one) => count + one.toReview.length, 0)} value(s) sent to a person`,
  )
  console.log(
    `    pack       ${facts.pack === undefined ? '(not sealed)' : `sealed, ${facts.pack.sizeBytes} bytes`}`,
  )
  console.log(
    `    approval   ${facts.approvalToSend === undefined ? '(none)' : `${facts.approvalToSend.approvedBy}, for this exact pack`}`,
  )
  console.log(`    site       ${facts.site?.liveAt ?? '(not published)'}`)

  console.log(
    `\n  ${DIM}Eight stages, start to finish, with no account, no key and no network.\n` +
      `  Four things a person did and the software could not: answering a question,\n` +
      `  granting permission to spend, checking a value against the document it was\n` +
      `  read from, and approving that the pack be sent. None of the four has a tool.${OFF}`,
  )

  // ── What a stranger can check for themselves ───────────────────────────────
  //
  // The three files needed to check this run, written where anybody can point the
  // checker at them. Without this, everything above is a claim somebody would have
  // to take our word for.
  //
  // `out/` is never committed. These are the output of one run and they carry
  // whatever was fed into it.
  heading('Check this run yourself')

  mkdirSync(OUT, { recursive: true })

  // The record, one entry per line, with each entry's payload beside it rather
  // than inside what is fingerprinted. A payload can be forgotten at somebody's
  // request while the entry stays and the chain still holds.
  const written: string[] = []
  for (const event of await readEvents(db, CASE)) {
    const payload = await readPayload(db, CASE, event.seq)
    written.push(JSON.stringify(payload === null ? event : { ...event, payload }))
  }
  writeFileSync(join(OUT, 'record.jsonl'), `${written.join('\n')}\n`, 'utf8')

  // The attestation over the END of the record. This is what catches entries
  // removed from the end, which the chain cannot do on its own — a shortened chain
  // is still a valid chain.
  //
  // Made with Charter's own key when this machine holds the private half, and with
  // a key made here when it does not.
  //
  // Most machines running this will not hold Charter's private key — it lives in
  // `.env` and is never committed, which is the whole point of it. A demonstration
  // that only worked on our machine would prove nothing to anybody else, so the
  // fallback exists and says so out loud rather than failing.
  const head = await readHead(db, CASE)
  const ours = privateKeyFromEnv()
  const keys = ours === undefined ? generateKeyPair() : undefined
  const privateKeyPem = ours ?? (keys as NonNullable<typeof keys>).privateKeyPem

  writeFileSync(
    join(OUT, 'attestation.json'),
    `${JSON.stringify(
      attest(
        {
          runId: CASE,
          head: head.head,
          count: head.count,
          attestedAt: clock().toISOString(),
        },
        privateKeyPem,
      ),
      null,
      2,
    )}\n`,
    'utf8',
  )
  if (keys === undefined) {
    // Charter's own key was used, so the checker will find the matching public
    // half in this repository. A leftover key file from an earlier run would be a
    // key somebody might pass with --key, and it would not match — so it goes.
    rmSync(join(OUT, 'attestation.pub'), { force: true })
  } else {
    writeFileSync(join(OUT, 'attestation.pub'), keys.publicKeyPem, 'utf8')
  }

  // An outside timestamp over the end of the record — somebody who is not us
  // saying they were shown this fingerprint at this moment.
  //
  // Only attempted when saved answers were turned off deliberately. These are free
  // services run as a public good, and a demonstration that stamped a fingerprint
  // on every rehearsal would be abusing something somebody pays for out of
  // goodwill. When it is not attempted, that is said plainly rather than left to
  // look like a failure.
  let anchorNote =
    'Not attempted, because REPLAY_MODE is true and this run reached no network at ' +
    'all. Run with REPLAY_MODE=false to ask an authority to stamp the head of the record.'

  if (!settings.replaying) {
    const attempt = await anchorHead(head.head, { nonce: head.count })
    anchorNote = attempt.why
    if (attempt.anchor !== undefined) {
      writeFileSync(join(OUT, 'anchor.json'), `${JSON.stringify(attempt.anchor, null, 2)}\n`, 'utf8')
    }
  }

  // One page a person opens by double-clicking it. Everything on it is read out of
  // the record that was just written, and nothing on it is fetched from anywhere —
  // so it survives being emailed and cannot quietly disagree with the record beside
  // it.
  const feed: FeedEntry[] = []
  for (const event of await readEvents(db, CASE)) {
    const payload = await readPayload(db, CASE, event.seq)
    feed.push({
      seq: event.seq,
      kind: event.kind,
      actor: event.actor,
      stage: event.stage,
      at: event.ts,
      detail: describe(event.kind, payload ?? {}),
    })
  }

  writeFileSync(
    join(OUT, 'report.html'),
    renderReport({
      caseId: CASE,
      businessName: facts.proposedName ?? CASE,
      state: facts.state ?? 'Texas',
      owners: facts.owners.map((owner) => owner.name),
      entries: feed,
      ...(facts.pack === undefined
        ? {}
        : { pack: { fingerprint: facts.pack.fingerprint, sizeBytes: facts.pack.sizeBytes } }),
      anchor: anchorNote,
      services: describeChoices(services),
      generatedAt: clock().toISOString(),
    }),
    'utf8',
  )

  // The few facts about the run that are not in the record itself: which of the
  // outside services were real, and whether anybody outside Charter vouched for
  // when this record existed. The website is built from these together with the
  // record, so nothing on it is typed in by hand.
  writeFileSync(
    join(OUT, 'run-meta.json'),
    `${JSON.stringify(
      {
        caseId: CASE,
        services: Object.entries(services.chosen).map(([name, one]) => ({
          name,
          kind: one.kind,
          why: one.why,
        })),
        anchor: anchorNote,
        generatedAt: clock().toISOString(),
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  console.log(`  ${GREEN}·${OFF} ${join(OUT, 'pack.pdf')}          the sealed pack, as a real PDF`)
  console.log(`  ${GREEN}·${OFF} ${join(OUT, 'record.jsonl')}      every entry, in order`)
  console.log(`  ${GREEN}·${OFF} ${join(OUT, 'attestation.json')}  vouches for the end of it`)
  // The same agreement again, editable. The sealed pack is what the owners sign
  // and is sealed so nobody can change it; this is what they take to somebody they
  // trust and argue about. Both are built from the same worked-out values, so they
  // cannot disagree.
  writeFileSync(join(OUT, 'agreement.docx'), buildAgreementDocx(prepareAgreement(facts, facts.agreement?.dated ?? '2026-09-03').data))

  console.log(`  ${GREEN}·${OFF} ${join(OUT, 'report.html')}       one page. Open it in a browser`)
  console.log(`  ${GREEN}·${OFF} ${join(OUT, 'agreement.docx')}    the same agreement, editable`)
  console.log('')
  console.log(
    `  ${BOLD}npm run verify -- out/pack.pdf out/record.jsonl out/attestation.json` +
      `${keys === undefined ? '' : ' --key out/attestation.pub'}${OFF}`,
  )
  console.log('')
  console.log(
    `  ${DIM}That reads its key from keys/attestation.pub in this repository, never\n` +
      `  from the pack. A checker that took its key out of the thing it was checking\n` +
      `  would prove nothing at all: anybody could invent a key, vouch for anything\n` +
      `  with it, and ship both together.${OFF}`,
  )
  console.log('')
  console.log(`  ${DIM}An outside timestamp: ${anchorNote}${OFF}`)
  console.log(
    `  ${DIM}Charter holds the record AND the key that vouches for it, so everything\n` +
      `  else here is checked with things Charter made. An outside timestamp is\n` +
      `  somebody who is not us saying they were shown this fingerprint at a moment.\n` +
      `  It does not stop a record being rewritten. It means a rewritten record\n` +
      `  produces a different ending while the old statement still exists — the past\n` +
      `  can still be rewritten, but no longer quietly.${OFF}`,
  )
  if (keys === undefined) {
    console.log(
      `\n  ${DIM}The attestation was made with Charter's own key, whose private half is in\n` +
        `  .env on this machine. The checker finds the matching public half in\n` +
        `  keys/attestation.pub, committed to this repository.${OFF}`,
    )
  } else {
    console.log(
      `\n  ${DIM}This machine does not hold Charter's private key — it lives in .env and is\n` +
        `  never committed, which is the point of it. So the attestation above was made\n` +
        `  with a key generated for this run, and out/attestation.pub is its public\n` +
        `  half. Pass it with --key, as shown above. A demonstration that only worked\n` +
        `  on our own machine would prove nothing to anybody else.${OFF}`,
    )
  }

  // ── The catalogue ──────────────────────────────────────────────────────────
  heading('Everything this agent can do')
  console.log(catalogue(registry))

  await db.close()
}

main().catch((error: unknown) => {
  // A settings problem is not a crash and should not read like one. The message
  // already names every setting that is wrong and what was expected, and a stack
  // trace on top of it only buries the part somebody can act on.
  if (error instanceof SettingRefusal) {
    console.error(`
${error.message}
`)
    process.exitCode = 1
    return
  }
  console.error(error)
  process.exitCode = 1
})
