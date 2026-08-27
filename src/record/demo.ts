/**
 * What day one built, shown rather than described.
 *
 *     npm run record:demo
 *
 * No accounts, no keys, no network, no database to install. Everything below runs
 * against a real PostgreSQL engine started inside this process, and a stand-in for
 * a model so that nothing is spent and nothing is sent anywhere.
 *
 * Five things are demonstrated:
 *
 *   1. A record being written, and holding together.
 *   2. Someone altering an entry, and the checker naming exactly which one.
 *   3. The database refusing to be altered at all.
 *   4. The one thing the chain cannot catch on its own, and the attestation
 *      catching it.
 *   5. The same question asked twice, reaching the network once.
 */

import { openBuiltIn } from '../db/driver.js'
import { migrate } from '../db/migrate.js'
import { append, readEvents, readHead, verifyRun, fixedClock } from './log.js'
import { checkChain, describeCheck, type ChainedEvent } from './chain.js'
import { attest, verifyAttestation, generateKeyPair, describeAttestation } from './attestation.js'
import { isRuleViolation } from '../db/driver.js'
import { through, memoryStore } from '../model/cache.js'

const DIM = '\x1b[2m', BOLD = '\x1b[1m', GREEN = '\x1b[32m', RED = '\x1b[31m', OFF = '\x1b[0m'

const heading = (n: number, text: string) => {
  console.log(`\n${BOLD}${n}. ${text}${OFF}`)
  console.log(`${DIM}${'─'.repeat(66)}${OFF}`)
}
const good = (text: string) => console.log(`  ${GREEN}✓${OFF} ${text}`)
const bad = (text: string) => console.log(`  ${RED}✗${OFF} ${text}`)
const note = (text: string) => console.log(`  ${DIM}${text}${OFF}`)

async function main(): Promise<void> {
  const db = await openBuiltIn()
  await migrate(db)
  const clock = fixedClock('2026-08-27T09:00:00.000Z', 60_000)
  const run = 'run-bakery-demo'

  console.log(`\n${BOLD}Charter — the record${OFF}`)
  console.log(`${DIM}A real PostgreSQL engine, running inside this process. Nothing installed,`)
  console.log(`nothing spent, nothing sent anywhere.${OFF}`)

  // ── 1 ──────────────────────────────────────────────────────────────────────
  heading(1, 'Writing a record')

  const steps: Array<[string, 'system' | 'model' | 'human' | 'vendor', string | null, object]> = [
    ['run.started', 'system', null, { state: 'TX', owners: 2 }],
    ['question.asked', 'model', 'understand', { question: 'What did each of you put in?' }],
    ['answer.received', 'human', 'understand', { cash: '15000', equipment: 'a commercial oven, 9000' }],
    ['counterfactual.computed', 'system', 'understand', {
      agreed: '60/40',
      defaultRule: '62.5/37.5',
      note: 'the split they agreed is not the split the default rule gives them',
    }],
    ['refusal.recorded', 'system', 'understand', {
      refused: 'sign_document',
      reason: 'no such tool exists in any stage',
    }],
  ]

  for (const [kind, actor, stage, payload] of steps) {
    const event = await append(db, { runId: run, kind, actor, stage, payload: payload as never }, clock)
    console.log(`  ${DIM}${event.seq}${OFF}  ${kind.padEnd(26)} ${DIM}${event.hash.slice(0, 12)}…${OFF}`)
  }

  const first = await verifyRun(db, run)
  console.log()
  good(describeCheck(first))

  // ── 2 ──────────────────────────────────────────────────────────────────────
  heading(2, 'Somebody alters entry 3')

  const events = await readEvents(db, run)
  const tampered: ChainedEvent[] = [...events]
  tampered[2] = { ...events[2]!, payloadHash: 'f'.repeat(64) }
  note('changing what the owners said they contributed…')
  console.log()

  const check = checkChain(tampered, run)
  if (check.ok) {
    bad('the checker missed it — this would be a serious bug')
  } else {
    bad(`entry ${check.firstBreak.seq}: ${check.firstBreak.detail}`)
    note(`expected ${check.firstBreak.expected?.slice(0, 24)}…`)
    note(`found    ${check.firstBreak.found?.slice(0, 24)}…`)
    console.log()
    good('named exactly which entry changed, without anyone needing to trust us')
  }

  // ── 3 ──────────────────────────────────────────────────────────────────────
  heading(3, 'And the database will not allow it in the first place')

  for (const [what, sql] of [
    ['change a past entry', `UPDATE events SET kind = 'nothing.happened' WHERE run_id = $1`],
    ['remove an entry', `DELETE FROM events WHERE run_id = $1`],
  ] as const) {
    try {
      await db.query(sql, [run])
      bad(`${what} — SUCCEEDED, which should be impossible`)
    } catch (error) {
      if (isRuleViolation(error)) {
        good(`refused: ${what}`)
        note(`${(error as Error).message.split('\n')[0]}`)
      } else {
        bad(`${what} failed for the wrong reason: ${(error as Error).message}`)
      }
    }
  }
  note('')
  note('Enforced by the database, not by our code being careful. Code that is careful')
  note('is worth little — the next change may not be, and anyone with the connection')
  note('string ignores it entirely.')

  // ── 4 ──────────────────────────────────────────────────────────────────────
  heading(4, 'The one thing the chain cannot catch by itself')

  const head = await readHead(db, run)
  const keys = generateKeyPair()
  const attestation = attest({ ...head, attestedAt: clock().toISOString() }, keys.privateKeyPem)

  good(`record attested: ${head.count} entries, ending ${head.head.slice(0, 16)}…`)
  console.log()
  note('Now somebody quietly drops the last two entries — including the refusal.')

  const shortened = events.slice(0, 3)
  const stillValid = checkChain(shortened, run)
  console.log()
  if (stillValid.ok) {
    bad(`the chain still verifies: ${stillValid.count} entries, and nothing looks wrong`)
    note('A shortened chain IS a valid chain. Nothing inside a list can tell you')
    note('something used to follow it. This is a real limitation and we say so.')
  }

  console.log()
  const against = verifyAttestation(attestation, keys.publicKeyPem, {
    runId: run,
    head: stillValid.ok ? stillValid.head : '',
    count: String(shortened.length),
  })
  if (!against.ok) {
    good(`but the attestation catches it: ${against.reason}`)
  } else {
    bad('the attestation missed it — this would be a serious bug')
  }

  console.log()
  const honest = verifyAttestation(attestation, keys.publicKeyPem, head)
  console.log(
    describeAttestation(honest)
      .split('\n')
      .map((line) => `  ${DIM}${line}${OFF}`)
      .join('\n'),
  )

  // ── 5 ──────────────────────────────────────────────────────────────────────
  heading(5, 'The same question twice, one call')

  const store = memoryStore()
  let networkCalls = 0
  const askModel = async () => {
    networkCalls++
    return { tool: 'ask_question', question: 'Did either of you put in equipment rather than cash?' }
  }
  const question = { model: 'gemini-3.5-flash-lite', stage: 'understand', situation: 'two sisters, a bakery' }

  const one = await through(question, 'stage one, first turn', askModel, { mode: 'auto', store })
  const two = await through(question, 'stage one, first turn', askModel, { mode: 'auto', store })

  good(`first ask  — from ${one.from}`)
  good(`second ask — from ${two.from}`)
  good(`identical answer: ${JSON.stringify(one.value) === JSON.stringify(two.value)}`)
  good(`times the network was reached: ${networkCalls}`)
  note('')
  note('The measured free allowance is about five hundred requests a day on the models')
  note('that do the work. Rerunning one stage two hundred times while debugging would')
  note('spend forty per cent of a day in twenty minutes. This is why the cache was')
  note('built before the agent.')
  note('')
  note('And a demonstration run never uses it. The cache protects development; it')
  note('never fakes a live run.')

  console.log(`\n${DIM}${'─'.repeat(66)}${OFF}`)
  console.log(`${DIM}Nothing above needed an account, a key, a container or a network.${OFF}\n`)

  await db.close()
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
