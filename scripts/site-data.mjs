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
 * WHAT ELSE IT GATHERS, AND WHY EACH ONE HAD TO COME FROM SOMEWHERE REAL
 *
 *   The whole chain. Every entry's own fingerprint, the fingerprint of the entry
 *   before it, and the fingerprint of its detail. The page invites a visitor to
 *   alter an entry and watch the check fail, and that check is a real one done in
 *   their browser. It cannot be done from an abbreviation.
 *
 *   The checker's output. `npm run verify` is run over the pack and the record,
 *   and the page prints its questions and answers in its own words, including the
 *   four things it says it cannot prove. Writing those out again on the page would
 *   be a second copy able to drift from the code that does the checking.
 *
 *   The agreement. Every article, from the same code that wrote the document on
 *   disk. The page shows a reader the document, not just proof that a document
 *   happened.
 *
 *   The test count, by running the tests.
 *
 * WHY IT REFUSES RATHER THAN WARNS
 *
 * The page makes specific claims. That a live search changed the decision. That
 * the first address came back taken. That the records were read back from the
 * registrar. That stage seven has no tools. That a person had to act. That the
 * chain holds.
 *
 * Each of those is checked against the run here, and the file is not written while
 * any of them fails. That is the whole reason the site can be trusted. Not that
 * somebody was careful, but that the file cannot be written otherwise.
 *
 * No dependencies, like every other check in this project.
 */

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'

const OUTPUT = 'site/run.json'
const SCRIPT = 'site/run.js'
const RECORD = 'out/record.jsonl'
const META = 'out/run-meta.json'
const PACK = 'out/pack.pdf'
const ATTESTATION = 'out/attestation.json'
const PUBLIC_KEY = 'keys/attestation.pub'

const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'
const OFF = '\x1b[0m'

console.log('')
console.log(`${BOLD}Charter, the website's data, from a real run${OFF}`)
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
 * How many tests this project runs, counted by running them.
 *
 * The same call `scripts/check-readme-counts.mjs` makes. The number appears on the
 * website, so it is produced rather than remembered. A run that fails a test stops
 * the whole thing here, which is correct: a page that says the project is checked
 * should not be built out of a checkout where the checks do not pass.
 */
function countTests() {
  console.log(`${YELLOW}  running${OFF}  the tests, to count them`)
  let output
  try {
    output = execFileSync(
      process.execPath,
      ['node_modules/vitest/vitest.mjs', 'run', '--reporter=json'],
      { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
    )
  } catch (problem) {
    console.error('')
    console.error(`${RED}  The tests did not pass, so there is no honest count to print.${OFF}`)
    console.error(`  Run npm test and fix what it says before building the site.`)
    process.exit(1)
  }

  // vitest prints its report as the last JSON object on stdout, and anything a
  // test logged comes before it. Find the report rather than assuming it is alone.
  const at = output.indexOf('{"numTotalTestSuites"')
  const report = JSON.parse(at === -1 ? output : output.slice(at))

  if (report.numFailedTests > 0) {
    console.error(`${RED}  ${report.numFailedTests} test(s) failed.${OFF}`)
    process.exit(1)
  }
  return report.numTotalTests
}

const tests = countTests()

/**
 * Read the run into the shape the page replays.
 *
 * Run through the project's own TypeScript runner, in a separate process, so the
 * reading is done by the same code the product uses. Rebuilding it here in
 * JavaScript would be a second copy able to drift, which is the thing this file
 * exists to prevent.
 */
const program = `
  import { readFileSync, existsSync } from 'node:fs'
  import { readRun, complaintsAbout } from './src/screens/run-data.ts'
  import { describe } from './src/agent/run.ts'
  import { STAGES } from './src/stages/stages.ts'
  import { foldFacts } from './src/stages/fold.ts'
  import { genesisHash } from './src/record/chain.ts'
  import { verifyEverything, packFingerprintFromRecord } from './src/verify/check.ts'
  import { prepareAgreement } from './src/agreement/prepare.ts'
  import { numberArticles } from './src/agreement/articles.ts'
  import { decisionParagraphs } from './src/pack/docx.ts'
  import { pagesOf } from './src/pack/read.ts'
  import { COMPANY_BEHIND, complaintsAboutCompanies } from './src/settings.ts'

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

  // ---- the agreement, from the code that wrote the file on disk --------------
  const prepared = prepareAgreement(facts, facts.agreement?.dated ?? '')
  const articles = numberArticles(prepared.shape).map((one) => ({
    number: one.number,
    heading: one.heading,
    fullHeading: one.fullHeading,
    why: one.why,
    becauseOfAnAnswer: one.becauseOfAnAnswer,
    readFirst: one.readFirst,
  }))

  // ---- the checker, run over the same files a visitor can download ----------
  const attestation = existsSync('${ATTESTATION}')
    ? JSON.parse(readFileSync('${ATTESTATION}', 'utf8'))
    : undefined

  const verification = verifyEverything({
    pack: new Uint8Array(readFileSync('${PACK}')),
    events,
    runId: events[0]?.runId ?? meta.caseId,
    attestation,
    publicKeyPem: readFileSync('${PUBLIC_KEY}', 'utf8'),
    recordedPackFingerprint: packFingerprintFromRecord(events, (event) => payloads.get(event.seq) ?? null),
  })

  // ---- which company is behind each service, from the credential catalogue ---
  const companyComplaints = complaintsAboutCompanies()
  const services = meta.services.map((one) => {
    const behind = COMPANY_BEHIND[one.name]
    return {
      ...one,
      company: behind?.company ?? null,
      host: behind?.host ?? '',
    }
  })
  for (const one of meta.services) {
    if (COMPANY_BEHIND[one.name] === undefined) {
      companyComplaints.push(
        \`The run used a service called "\${one.name}" and the settings catalogue does not \` +
          \`know which company that is, so the page could not say.\`,
      )
    }
  }

  const run = readRun({
    caseId: meta.caseId,
    events,
    payloadOf: (seq) => payloads.get(seq) ?? null,
    describe,
    stages,
    businessName: facts.proposedName ?? meta.caseId,
    state: facts.state ?? '',
    owners: facts.owners.map((one) => one.name),
    services,
    anchor: meta.anchor,
    generatedAt: meta.generatedAt,
    genesis: genesisHash(events[0]?.runId ?? meta.caseId),
    ...(attestation === undefined
      ? {}
      : { attestation: { head: attestation.head, count: attestation.count, keyId: attestation.keyId } }),
    tests: ${tests},
    verify: { findings: verification.findings, cannotProve: verification.cannotProve },
    articles,
    decisions: decisionParagraphs(prepared.data),
    packPages: pagesOf(new Uint8Array(readFileSync('${PACK}'))),
  })

  process.stdout.write(
    JSON.stringify({ run, complaints: [...complaintsAbout(run), ...companyComplaints] }),
  )
`

const { run, complaints } = JSON.parse(
  execFileSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', '--eval', program], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  }),
)

/**
 * The page as plain text.
 *
 * WHY THIS IS GENERATED AND NOT WRITTEN
 *
 * Anything that reads rather than looks gets this file: a screen reader taking a
 * shortcut, somebody grepping, a program summarising the page. If it were written
 * by hand it would be a second copy of every claim, free to drift from the page,
 * and the drift would be invisible because almost nobody opens both.
 *
 * So it is built from the same object the page is built from, in the same pass.
 * Every number in it was counted, exactly as on the page.
 */
function plainText(run) {
  const yes = run.verify.findings.filter((one) => one.answer === 'yes').length
  const lines = []

  const say = (...text) => lines.push(...text)
  const rule = () => lines.push('', '-'.repeat(70), '')

  say(
    'CHARTER',
    '',
    'It prepares the whole packet. It signs nothing.',
    '',
    'Charter turns a plain description of a business into a prepared packet for a',
    'United States company with more than one owner. It researches the name, secures',
    'a web address, drafts the ownership agreement, reads the owners\' identity',
    'documents, and seals one file. Then it stops.',
    '',
    'Forming a business on your own is already solved and it is free. The hard part',
    'was never the paperwork. It is writing down an agreement between two people who',
    'trust each other completely today and might not in three years.',
    '',
    `The website replays one real run, case ${run.caseId}, entry by entry. It stops at`,
    `each of the ${run.counts.human} entries a person caused and will not carry on until somebody`,
    'clicks. Nothing on it was typed in by hand. Every value below is read from the',
    'record of that run, which is beside this file as record.jsonl.',
  )

  rule()
  say('THE RUN, COUNTED', '')
  for (const [what, value] of [
    ['entries', run.totalEntries],
    ['by the model', run.counts.model],
    ['by ordinary code', run.counts.system],
    ['by an outside service', run.counts.vendor],
    ['by a person', run.counts.human],
    ['refusals', run.refusals.length],
    ['stages', run.stages.length],
    ['tools in the boundary stage', 0],
    ['articles in the agreement', run.agreement?.articleCount ?? 0],
    ['bytes in the sealed packet', run.pack?.sizeBytes ?? ''],
    ['PDF permission level', run.pack?.permissionLevel ?? ''],
    ['tests', run.tests],
  ]) {
    say(`  ${String(value).padStart(6)}  ${what}`)
  }

  rule()
  say('THE EIGHT STAGES', '')
  for (const stage of run.stages) {
    const mine = run.entries.filter((one) => one.stage === stage.name).length
    say(
      `  ${stage.position}. ${stage.title}`,
      `     ${mine} entries, ${stage.tools.length} tools, ${stage.from} to ${stage.to}`,
      `     ${stage.whatHappens}`,
      '',
    )
  }
  const loose = run.totalEntries - run.stages.reduce(
    (n, stage) => n + run.entries.filter((one) => one.stage === stage.name).length,
    0,
  )
  say(
    `  ${loose} entries belong to no stage. ${run.counts.human} of them are a person. The rest are`,
    '  Charter refusing a person, because the token did not match.',
  )

  rule()
  say('WHAT CHARTER WAS ASKED TO DO AND WOULD NOT', '')
  for (const refusal of run.refusals) say(`  entry ${refusal.seq}: ${refusal.why}`, '')

  rule()
  say(
    'WHAT THE CHECKER ANSWERS',
    '',
    `  npm run verify -- out/pack.pdf out/record.jsonl out/attestation.json`,
    '',
  )
  for (const finding of run.verify.findings) {
    const mark = finding.answer === 'yes' ? '[yes]' : finding.answer === 'no' ? '[NO ]' : '[ ? ]'
    say(`  ${mark}  ${finding.question}`)
  }
  say(
    '',
    `  ${run.verify.findings.length} questions. ${yes} answered yes. ${run.verify.findings.length - yes} it cannot answer, and it says so`,
    '  rather than leaving it out.',
    '',
    'WHAT THIS CHECK CANNOT PROVE',
    '',
  )
  for (const cannot of run.verify.cannotProve) say(`  - ${cannot}`, '')

  rule()
  say('THE AGREEMENT', '')
  for (const paragraph of run.agreement?.decisions ?? []) say(`  ${paragraph}`, '')
  for (const article of run.agreement?.articles ?? []) {
    say(`  ${article.fullHeading}`, `    ${article.why}`, '')
  }

  rule()
  say('THE OUTSIDE SERVICES', '')
  for (const service of run.services) {
    say(
      `  ${service.company ?? 'not built yet'}${service.host ? ` (${service.host})` : ''}, the ${service.name}: ${service.kind}`,
      `    ${service.why}`,
      '',
    )
  }

  rule()
  say(
    'THE LIMIT',
    '',
    'The Uniform Electronic Transactions Act, section 14, lets a contract be formed',
    'by electronic agents even when no person is aware of it, and the result is',
    'attributed to the person to be bound. So the honest claim is not that a machine',
    'may not act. It is that the same law defines a signature as a process executed',
    'or adopted by a person, with the intent to sign. Forming can be handed over.',
    'The signature is the act of a person, and a machine has no intent to lend it.',
    '',
    'That limit is not a setting. There is no chain of imports from anything the',
    'model can trigger to the module that carries a document to a person to sign,',
    'and a test walks every import on every build and fails if that ever changes.',
    '',
    'The record is append-only and tamper-evident. Modification is detected, not',
    'prevented. Nothing here is legal advice.',
    '',
  )

  return lines.join('\n')
}

console.log(`  ${run.totalEntries} entries, from case ${run.caseId}`)
for (const [actor, count] of Object.entries(run.counts).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(count).padStart(4)} ${actor}`)
}
console.log(
  `  ${run.refusals.length} refusal(s), ${run.addresses.length} address(es) tried, ` +
    `${run.identity.length} document(s) read`,
)
console.log(
  `  ${run.agreement?.articles.length ?? 0} article(s), ` +
    `${run.verify.findings.length} question(s) checked, ` +
    `${run.verify.cannotProve.length} thing(s) it cannot prove, ` +
    `${run.tests} test(s)`,
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

// The same object again, as a script the page loads.
//
// WHY BOTH, AND WHY NOT ONE FETCH
//
// The page must work when somebody opens the file straight off a disk, with no
// server and no network. A browser refuses to let a page opened that way fetch a
// neighbouring file, so a fetch would leave a judge looking at a blank screen with
// no explanation. A script tag has no such rule.
//
// The .json file is the same data, written out separately so a reader can download
// it, open it, and compare it against the record themselves. Neither is derived
// from the other. Both are written here, from one object, in one pass.
writeFileSync(
  SCRIPT,
  '/* Written by scripts/site-data.mjs from a real run. Do not edit by hand. */\n' +
    `window.CHARTER_RUN = ${JSON.stringify(run)}\n`,
  'utf8',
)

// The page invites a reader to check it against the record and the packet, and to
// run the checker themselves. That invitation is only real if the files are
// actually beside the page, so they are copied rather than merely offered.
for (const [from, to] of [
  [RECORD, 'site/record.jsonl'],
  [PACK, 'site/pack.pdf'],
  [ATTESTATION, 'site/attestation.json'],
]) {
  copyFileSync(from, to)
  console.log(`${GREEN}  copied${OFF}   ${to}`)
}

// A plain text version of the page, for anything that reads rather than looks.
// Written from the same object the page is, so the two cannot say different things.
writeFileSync('site/llms.txt', plainText(run), 'utf8')
console.log(`${GREEN}  written${OFF}  site/llms.txt`)

console.log('')
console.log(`${GREEN}  ok${OFF}       every claim the page makes is backed by this run`)
console.log(`${GREEN}  written${OFF}  ${OUTPUT}`)
console.log(`${GREEN}  written${OFF}  ${SCRIPT}`)
console.log(`${DIM}${'─'.repeat(68)}${OFF}`)
console.log('')
