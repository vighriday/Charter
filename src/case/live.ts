/**
 * Charter, with your own idea.
 *
 * WHAT THIS IS
 *
 * The other way into this project is `npm run agent:demo`. That one replays a
 * bakery in Texas: the same two sisters, the same answers, the same record every
 * time. It exists so the whole thing can be checked line by line, and it is worth
 * exactly as much as a recording of somebody else driving.
 *
 * This is the other kind. You describe your own business, in your own words, and
 * Charter actually works: it asks a real model what to do next, searches the real
 * web for the name, talks to the real registrar, reads a real document, and hands
 * you a packet about YOUR company. It stops and asks you every time it reaches
 * something only a person can decide, and it does not guess while it waits.
 *
 * WHY IT REFUSES WITHOUT A MODEL KEY
 *
 * The whole claim of this project is that an agent decided these things and a
 * person decided the rest. With no model key there is no agent: there is a
 * written-out script that only knows about a bakery, and pointing it at a bicycle
 * repair shop would produce nonsense or nothing.
 *
 * So this stops, and says which key and where to get it, rather than running
 * something that would look like a live run and would not be one. A demonstration
 * that quietly degrades into a replay is the exact thing this project exists to
 * argue against.
 *
 * WHAT IT WILL NOT DO
 *
 * It will not spend your money. The registrar has a practice account: real API,
 * real HTTP, real validation, nothing registered and nobody charged. That is the
 * default and turning it off takes two deliberate settings. It will not sign
 * anything for you either, here or anywhere else.
 *
 * WHAT YOU GET AT THE END
 *
 * The same three files the demonstration leaves, about your company instead:
 * `out/record.jsonl`, `out/pack.pdf` and `out/attestation.json`. Check them with
 * `npm run verify`, which reads the files and sends nothing anywhere.
 */

import { openKeyboard, InputEnded } from './keyboard.js'
import { randomBytes } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { openBuiltIn } from '../db/driver.js'
import { migrate } from '../db/migrate.js'
import { readEvents, readHead, readPayload } from '../record/log.js'
import { attest, generateKeyPair, privateKeyFromEnv } from '../record/attestation.js'
import { buildRegistry, type Tool } from '../tools/registry.js'
import { ALL_TOOLS } from '../tools/stage-tools.js'
import { answerQuestion, writeDownWhatTheySaid } from './human.js'
import {
  driveEveryStep,
  answerWhateverIsWaiting,
  type AskAPerson,
  type Watching,
} from './drive.js'
import type { StageName } from '../stages/stages.js'
import { loadEnvFile, readSettings, SettingRefusal } from '../settings.js'
import { buildRouter } from '../model/build.js'
import { chooseServices, describeChoices } from '../vendors/build.js'

/** Where a run leaves the files somebody needs to check it. Never committed. */
const OUT = 'out'

const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'
const BLUE = '\x1b[34m'
const OFF = '\x1b[0m'

const rule = (): void => console.log(`${DIM}${'─'.repeat(74)}${OFF}`)

function heading(text: string): void {
  console.log('')
  rule()
  console.log(`  ${BOLD}${text}${OFF}`)
  rule()
}

/** A person is about to be asked something. Make it impossible to miss. */
function gate(text: string): void {
  console.log('')
  console.log(`${BLUE}  ┌${'─'.repeat(70)}${OFF}`)
  console.log(`${BLUE}  │  ONLY A PERSON CAN ANSWER THIS${OFF}`)
  console.log(`${BLUE}  │${OFF}  ${BOLD}${text}${OFF}`)
  console.log(`${BLUE}  └${'─'.repeat(70)}${OFF}`)
}

/**
 * A case identifier made from the business name.
 *
 * Readable, because it ends up in the record and in file names, and a person
 * comparing two runs should be able to tell which is which. The random tail is
 * there because two runs about the same idea are two different runs, and a record
 * that quietly appended to an earlier one would be a record of neither.
 */
function caseIdFrom(description: string): string {
  const words = description
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((one) => one.length > 2)
    .slice(0, 3)
    .join('-')

  return `${words === '' ? 'case' : words}-${randomBytes(3).toString('hex')}`
}

async function main(): Promise<void> {
  loadEnvFile()

  let settings
  try {
    settings = readSettings()
  } catch (problem) {
    if (problem instanceof SettingRefusal) {
      console.log('')
      console.log(`${RED}  A setting cannot mean anything, so nothing has run.${OFF}`)
      console.log(`  ${problem.message}`)
      console.log('')
      process.exitCode = 1
      return
    }
    throw problem
  }

  const ask = openKeyboard()

  console.log('')
  console.log(`  ${BOLD}Charter${OFF}  ${DIM}your own idea, a real run${OFF}`)

  // ── is there an agent at all ───────────────────────────────────────────────
  // Told about every model that was tried, skipped, or refused, so a run that
  // cannot find a model says which ones it asked and what each one said. The first
  // real run ended with a stack trace naming three providers and no explanation of
  // why the first two were passed over.
  const skipped: string[] = []
  const models = buildRouter({
    settings,
    env: process.env,
    onAttempt: (attempt) => {
      if (attempt.outcome === 'answered') return
      const why = attempt.detail === undefined ? '' : `  ${attempt.detail}`
      const line = `${attempt.providerId}  ${attempt.outcome}${why}`
      skipped.push(line)
      // Printed as it happens, not only when everything has failed. A model that
      // is passed over quietly on turn one and reported as "cooling" on turn six
      // hides the reason it was passed over, which is the only useful part.
      console.log(`  ${DIM}${'model.skipped'.padEnd(30)}${OFF} ${DIM}${line}${OFF}`)
    },
  })

  if (models.router === null) {
    console.log('')
    console.log(`${YELLOW}  There is no model key set, so there is no agent to run.${OFF}`)
    console.log('')
    console.log(`  ${models.why}`)
    console.log('')
    console.log(`  ${BOLD}What to do${OFF}`)
    console.log('    1. Get a free key at https://aistudio.google.com/apikey')
    console.log('    2. Put it in .env as   GEMINI_API_KEY=your-key')
    console.log('    3. Run this again')
    console.log('')
    console.log(
      `  ${DIM}A key is free and this run stays inside the free daily allowance, which${OFF}`,
    )
    console.log(
      `  ${DIM}Charter counts for itself and refuses to go past. Nothing here spends money.${OFF}`,
    )
    console.log('')
    console.log(
      `  ${DIM}To watch the recorded walkthrough instead, run:  npm run agent:demo${OFF}`,
    )
    console.log('')
    ask.close()
    process.exitCode = 1
    return
  }

  // ── is it allowed to reach anybody ─────────────────────────────────────────
  if (settings.replaying) {
    console.log('')
    console.log(`${YELLOW}  REPLAY_MODE is on, so every outside service is a stand-in.${OFF}`)
    console.log('')
    console.log(`  The run will still work end to end and will still be about your idea,`)
    console.log(`  but nothing will reach the real web, the real registrar, or the real`)
    console.log(`  document reader. To use the real ones, set REPLAY_MODE=false in .env.`)
    console.log('')

    const carryOn = (await ask.ask(`  Carry on with stand-ins? [y/N] `)).trim().toLowerCase()
    if (carryOn !== 'y' && carryOn !== 'yes') {
      console.log('')
      console.log(`  ${DIM}Nothing ran.${OFF}`)
      console.log('')
      ask.close()
      return
    }
  }

  // ── the idea ───────────────────────────────────────────────────────────────
  heading('Tell Charter about the business')
  console.log(
    `  ${DIM}Plain words. Who the owners are, what the business does, where it is, and${OFF}`,
  )
  console.log(`  ${DIM}what each person is putting in. One paragraph is plenty.${OFF}`)
  console.log('')

  const description = (await ask.ask('  > ')).trim()

  if (description.length < 20) {
    console.log('')
    console.log(`${YELLOW}  That is too short for Charter to work from.${OFF}`)
    console.log(`  It needs at least who the owners are and what the business does.`)
    console.log('')
    ask.close()
    process.exitCode = 1
    return
  }

  const state = (await ask.ask('  Which US state will it be formed in? ')).trim().toUpperCase()

  const caseId = caseIdFrom(description)
  const token = randomBytes(24).toString('hex')

  // ── what is real, said before anything runs ────────────────────────────────
  const db = await openBuiltIn()
  await migrate(db)

  const clock = (): Date => new Date()
  const registry: ReadonlyMap<string, Tool> = buildRegistry(ALL_TOOLS)

  const services = chooseServices({ settings, caseId, env: process.env, prepared: {} })

  heading('What is real in this run')
  console.log(`  ${DIM}the model    ${models.why}${OFF}`)
  console.log('')
  for (const line of describeChoices(services)) console.log(`  ${DIM}${line}${OFF}`)
  console.log('')
  console.log(
    `  ${DIM}money        nothing is spent. The registrar is on its ${settings.registrarEnv} ` +
      `account.${OFF}`,
  )
  console.log(`  ${DIM}this case    ${caseId}${OFF}`)

  // The description and the state go in as facts before the first turn, because
  // they are things a person said and not things a model worked out.
  const options = {
    db,
    caseId,
    clock,
    registry,
    // Not null: the run stopped above when there was nothing to build.
    router: models.router,
    services,
    settings,
    keepPack: async (bytes: Uint8Array): Promise<void> => {
      mkdirSync(OUT, { recursive: true })
      writeFileSync(join(OUT, 'pack.pdf'), bytes)
    },
    onEvent: (kind: string, _stage: StageName, detail: string): void => {
      console.log(`  ${DIM}${kind.padEnd(30)}${OFF} ${detail}`)
    },
  }

  const act = { db, caseId, token, expectedToken: token, clock }

  // One way of asking, so the driver below does not know it is talking to a
  // terminal. The tests hand it a written-out set of answers instead, which is how
  // the six places a person is asked can be exercised without a person.
  const fromTheTerminal: AskAPerson = async (prompt) => (await ask.ask(`  ${prompt} > `)).trim()

  // The two things a person said, recorded twice on purpose and for two different
  // reasons.
  //
  // As an ANSWER, because somebody was asked and replied, and the record of who
  // said what has to show that.
  //
  // As a FACT, in their exact words, because these two are not things that have to
  // be worked out from a conversation. The paragraph somebody types when asked to
  // describe their business is the description. Handing it to a model to be retyped
  // can only make it different, and on the first real run that is exactly what it
  // did: the retyped version lost its last sentence, which was the name they wanted
  // to trade under.
  await answerQuestion(act, 'Describe the business in your own words.', description)
  await writeDownWhatTheySaid(act, 'description', description)
  if (state !== '') {
    await answerQuestion(act, 'Which US state will it be formed in?', state)
    await writeDownWhatTheySaid(act, 'state', state)
  }

  // ── the eight steps ────────────────────────────────────────────────────────
  //
  // The run itself is in src/case/drive.ts and is the same code the website uses.
  // What is different here is only how a person is asked and how it is shown. Two
  // copies of "when does Charter stop and wait for a person" would eventually
  // disagree, and the one that was wrong would be the one nobody was watching.
  const watch: Watching = {
    onStep: (step) => {
      heading(`Step ${step.position} of ${step.of} — ${step.title}`)
      console.log(`  ${DIM}${step.whatHappens}${OFF}`)
      console.log(`  ${DIM}It may: ${step.mayDo.join('; ')}${OFF}`)
      console.log('')
    },
    onGate: (question, extra) => {
      gate(question)
      for (const line of extra ?? []) console.log(`    ${DIM}${line}${OFF}`)
    },
    onNote: (note) => console.log(`  ${YELLOW}${note}${OFF}`),
  }

  let ending
  try {
    ending = await driveEveryStep({ options, act, ask: fromTheTerminal, caseId, watch, skipped })
  } catch (problem) {
    // A company that did not answer, a document that would not open, or a fault of
    // our own. Whatever it was, it is said in plain words and the record is still
    // written out before anything stops.
    //
    // The record matters MORE when a run fails than when it finishes. It is the
    // only account of how far it got and what it had already done, and losing it to
    // a stack trace means the one run worth reading is the one nobody can read.
    // Two runs were lost exactly that way before this was here.
    console.log('')
    console.log(`${RED}  The run stopped because something it depends on did not work.${OFF}`)
    console.log('')
    console.log(`  ${problem instanceof Error ? problem.message : String(problem)}`)
    console.log('')
    await leaveTheFiles(db, caseId, clock)
    console.log(`  ${DIM}Everything that had happened is in out/record.jsonl.${OFF}`)
    console.log('')
    ask.close()
    process.exitCode = 1
    return
  }

  if (ending.kind !== 'finished') {
    console.log('')
    if (ending.kind === 'no model') {
      console.log(`${YELLOW}  No model was left that could answer this step.${OFF}`)
      console.log('')
      for (const line of ending.tried.slice(-6)) console.log(`    ${DIM}${line}${OFF}`)
      console.log('')
      console.log(`  ${DIM}A free allowance comes back at midnight in the provider's own${OFF}`)
      console.log(`  ${DIM}time zone.${OFF}`)
    } else if (ending.kind === 'refused') {
      console.log(`${YELLOW}  Stopped, because you said no.${OFF}`)
      console.log(`  ${ending.because}`)
    } else {
      console.log(`${YELLOW}  The run stopped here, and not because of you.${OFF}`)
      console.log(`  ${ending.because}`)
    }
    console.log('')
    console.log(`  ${DIM}Everything up to this point is in the record. Nothing was faked${OFF}`)
    console.log(`  ${DIM}to get past it, which is the whole point of stopping.${OFF}`)
    console.log('')
    await leaveTheFiles(db, caseId, clock)
    ask.close()
    process.exitCode = 1
    return
  }

  // ── the files ──────────────────────────────────────────────────────────────
  await leaveTheFiles(db, caseId, clock)

  heading('Done')
  console.log(`  ${GREEN}Your packet is at out/pack.pdf${OFF}`)
  console.log(`  ${GREEN}Everything that happened is at out/record.jsonl${OFF}`)
  console.log('')
  console.log(`  ${DIM}Check it yourself, on your own machine, sending nothing anywhere:${OFF}`)
  console.log(`    npm run verify`)
  console.log('')
  console.log(`  ${DIM}Nothing in that packet has been signed, and Charter cannot sign it.${OFF}`)
  console.log('')

  ask.close()
}

/**
 * Where the parts a person walks through actually live.
 *
 * `answerWhateverIsWaiting` used to be written out here. It moved to
 * src/case/drive.ts when the website grew a way to do the same run, because two
 * copies of "which six things only a person may decide" would eventually differ,
 * and the copy that was wrong would be the one nobody was looking at.
 *
 * It is handed back out from here so that anything reading this file, including
 * the tests that check all six of those places, still finds it where it expects.
 */
export { answerWhateverIsWaiting, type AskAPerson }

/**
 * The three files somebody needs to check this run, written the same way the
 * walkthrough writes them, because a run people can check differently from the one
 * in the demonstration is a run nobody can compare.
 */
async function leaveTheFiles(
  db: Parameters<typeof readEvents>[0],
  caseId: string,
  clock: () => Date,
): Promise<void> {
  mkdirSync(OUT, { recursive: true })

  const written: string[] = []
  for (const event of await readEvents(db, caseId)) {
    const payload = await readPayload(db, caseId, event.seq)
    written.push(JSON.stringify(payload === null ? event : { ...event, payload }))
  }
  writeFileSync(join(OUT, 'record.jsonl'), `${written.join('\n')}\n`, 'utf8')

  const head = await readHead(db, caseId)
  const ours = privateKeyFromEnv()
  const keys = ours === undefined ? generateKeyPair() : undefined
  const privateKeyPem = ours ?? (keys as NonNullable<typeof keys>).privateKeyPem

  writeFileSync(
    join(OUT, 'attestation.json'),
    `${JSON.stringify(
      attest(
        { runId: caseId, head: head.head, count: head.count, attestedAt: clock().toISOString() },
        privateKeyPem,
      ),
      null,
      2,
    )}\n`,
    'utf8',
  )

  if (keys === undefined) {
    rmSync(join(OUT, 'attestation.pub'), { force: true })
  } else {
    writeFileSync(join(OUT, 'attestation.pub'), keys.publicKeyPem, 'utf8')
  }
}

/**
 * Only when this file is the program somebody ran.
 *
 * The driver above is exported so it can be tested without a keyboard, and an
 * import is not a request to start an interactive program. Without this guard,
 * `import { answerWhateverIsWaiting }` would print a banner, read settings, and set
 * a failing exit code on a test run that had not failed.
 */
const wasRunDirectly = /live\.ts$/.test(process.argv[1] ?? '')

if (wasRunDirectly) {
  try {
    await main()
  } catch (problem) {
    // Running out of answers is not a crash and should not read like one. It
    // happens whenever this is driven from a file that has fewer answers than the
    // run needed, and the only right thing to do is say which question is still
    // waiting and stop.
    if (problem instanceof InputEnded) {
      console.log('')
      console.log(`${YELLOW}  ${problem.message}${OFF}`)
      console.log('')
      process.exitCode = 1
    } else {
      throw problem
    }
  }
}
