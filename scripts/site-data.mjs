/**
 * Write the website's data file from a real run, and refuse if the run does not
 * back what the page says.
 *
 *     npm run site:data
 *
 * WHY THE WEBSITE IS FED FROM A RUN
 *
 * A marketing page can say anything, and most readers have been trained by four
 * hundred landing pages to assume every number on one was typed in by hand.
 *
 * So nothing on Charter's website is typed in by hand. Every entry a visitor
 * scrolls through, every count, every fingerprint, every refusal and every address
 * is read out of the append-only record of a run that really happened. The same
 * record is downloadable beside the page, so anybody can check one against the
 * other.
 *
 * IT READS THE SAME FILES A VISITOR CAN DOWNLOAD
 *
 * `npm run agent:demo` leaves the record in `out/`. This reads that, rather than
 * running its own copy of the case. So the data behind the website is the same
 * data anybody gets by running the demonstration themselves, and a visitor who
 * doubts a number can produce it.
 *
 * WHY IT REFUSES RATHER THAN WARNS
 *
 * The page makes specific claims. That a live search changed the decision. That
 * the first address came back taken. That the records were read back from the
 * registrar. That stage seven has no tools. That a person had to act.
 *
 * Each of those is checked against the run here, and the file is not written while
 * any of them fails. That is the whole reason the site can be trusted. Not that
 * somebody was careful, but that the file cannot be written otherwise.
 *
 * No dependencies, like every other check in this project.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'

const OUTPUT = 'site/run.json'
const RECORD = 'out/record.jsonl'
const META = 'out/run-meta.json'

const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'
const OFF = '\x1b[0m'

console.log('')
console.log(`${BOLD}Charter — the website's data, from a real run${OFF}`)
console.log(`${DIM}${'─'.repeat(68)}${OFF}`)

// Run the demonstration first unless its output is already there. The website is
// built from what a person gets by running it themselves, so producing that is
// part of building the site rather than a separate thing to remember.
if (!existsSync(RECORD) || !existsSync(META) || process.argv.includes('--fresh')) {
  console.log(`${YELLOW}  running${OFF}  npm run agent:demo, to produce ${RECORD}`)
  execFileSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/case/demo.ts'], {
    stdio: ['ignore', 'ignore', 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
  })
}

/**
 * Read the run into the shape the page replays.
 *
 * Run through the project's own TypeScript runner, in a separate process, so the
 * reading is done by the same code the product uses. Rebuilding it here in
 * JavaScript would be a second copy able to drift, which is the thing this file
 * exists to prevent.
 */
const program = `
  import { readFileSync } from 'node:fs'
  import { readRun, complaintsAbout } from './src/screens/run-data.ts'
  import { describe } from './src/agent/run.ts'
  import { STAGES } from './src/stages/stages.ts'
  import { foldFacts } from './src/stages/fold.ts'

  const events = []
  const payloads = new Map()
  const entries = []

  for (const line of readFileSync('${RECORD}', 'utf8').split('\\n')) {
    const text = line.trim()
    if (text === '') continue
    const parsed = JSON.parse(text)
    const { payload, ...event } = parsed
    events.push(event)
    if (payload !== undefined && payload !== null) payloads.set(event.seq, payload)
    entries.push({ kind: event.kind, stage: event.stage, payload: payload ?? null })
  }

  const meta = JSON.parse(readFileSync('${META}', 'utf8'))
  const facts = foldFacts(meta.caseId, entries)

  const stages = Object.values(STAGES).map((stage) => {
    const mine = events.filter((one) => one.stage === stage.name)
    return {
      name: stage.name,
      position: stage.position,
      title: stage.title,
      whatHappens: stage.whatHappens,
      tools: [...stage.tools],
      from: mine[0]?.seq ?? '',
      to: mine[mine.length - 1]?.seq ?? '',
    }
  })

  const run = readRun({
    caseId: meta.caseId,
    events,
    payloadOf: (seq) => payloads.get(seq) ?? null,
    describe,
    stages,
    businessName: facts.proposedName ?? meta.caseId,
    state: facts.state ?? '',
    owners: facts.owners.map((one) => one.name),
    services: meta.services,
    anchor: meta.anchor,
    generatedAt: meta.generatedAt,
  })

  process.stdout.write(JSON.stringify({ run, complaints: complaintsAbout(run) }))
`

const { run, complaints } = JSON.parse(
  execFileSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', '--eval', program], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  }),
)

console.log(`  ${run.totalEntries} entries, from case ${run.caseId}`)
for (const [actor, count] of Object.entries(run.counts).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(count).padStart(4)} ${actor}`)
}
console.log(
  `  ${run.refusals.length} refusal(s), ${run.addresses.length} address(es) tried, ` +
    `${run.identity.length} document(s) read`,
)

if (complaints.length > 0) {
  console.log('')
  console.log(`${RED}  The page would say things this run did not do:${OFF}`)
  for (const complaint of complaints) console.log(`    - ${complaint}`)
  console.log('')
  console.log(`  Nothing was written. Fix the run, not the page.`)
  process.exit(1)
}

mkdirSync('site', { recursive: true })
writeFileSync(OUTPUT, `${JSON.stringify(run, null, 2)}\n`, 'utf8')

console.log('')
console.log(`${GREEN}  ok${OFF}       every claim the page makes is backed by this run`)
console.log(`${GREEN}  written${OFF}  ${OUTPUT}`)
console.log(`${DIM}${'─'.repeat(68)}${OFF}`)
console.log('')
