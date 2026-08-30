/**
 * Check that the numbers printed in the readme are the numbers this project has.
 *
 *     npm run readme:check
 *
 * WHY THIS IS A SCRIPT AND NOT A TEST
 *
 * It counts the tests, so it cannot be one of them. A test that counts the suite it
 * belongs to has to know its own answer while producing it, and every way around
 * that is a way of being subtly wrong.
 *
 * Counting them by reading the files does not work either. This suite uses blocks
 * that produce one test per item in a list, and some of those lists are worked out
 * while the code runs — every operation that rewrites a file, every username worth
 * trying. Reading the source can see the block but not how many items it will
 * produce, so a file-reading counter is always short and always wrong in the
 * direction that looks fine.
 *
 * So this runs the suite and asks the test runner. That is slower and it is the
 * only count that is actually true.
 *
 * WHY IT EXISTS AT ALL
 *
 * On 30 August the readme said this project had 201 tests. It had 658. Nobody wrote
 * something false — somebody wrote something true and then the code moved, and prose
 * has no way of noticing.
 *
 * The readme is public and it is the only file most people will ever read. This
 * project already argues that a count worth printing is a count worth generating,
 * which is why the tool catalogue is built from the code that runs. The readme was
 * the last place still quoting a number by hand.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const DIM = '\x1b[2m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const OFF = '\x1b[0m'

/** Ask the test runner how many tests there are, in total and per file. */
function countTests() {
  // Run the test runner through Node directly rather than through npx. npx
  // resolves differently on Windows depending on which shell started it, and a
  // check that fails because of the shell is a check people learn to ignore.
  const output = execFileSync(
    process.execPath,
    ['node_modules/vitest/vitest.mjs', 'run', '--reporter=json'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
  )

  // The runner prints a little before the JSON on some platforms, so start at the
  // first brace rather than assuming the whole of it is the report.
  const report = JSON.parse(output.slice(output.indexOf('{')))

  // Per file as well as in total. The path comes back absolute and in whichever
  // slash the platform uses, so it is cut down to the last two parts —
  // "tests/thing.test.ts" — which is what the readme names.
  const perFile = new Map()
  for (const file of report.testResults) {
    const name = file.name.split(/[\/]/).slice(-2).join('/')
    perFile.set(name, (perFile.get(name) ?? 0) + file.assertionResults.length)
  }

  return { total: report.numTotalTests, failed: report.numFailedTests, perFile }
}

const readme = readFileSync('README.md', 'utf8')
const claimed = /npm test\s+#\s*([\d,]+) tests/.exec(readme)

console.log('')
console.log(`${DIM}Charter — do the readme's numbers match reality${OFF}`)
console.log(`${DIM}${'─'.repeat(60)}${OFF}`)

if (claimed === null) {
  console.log(`${RED}  The readme no longer prints a test count in the form "npm test # N tests".${OFF}`)
  console.log(`  Either put one back, or delete this check. A count nobody states is fine;`)
  console.log(`  a count nobody checks is not.`)
  process.exit(1)
}

const stated = Number(claimed[1].replace(/,/g, ''))
const { total, failed, perFile } = countTests()

if (failed > 0) {
  console.log(`${RED}  ${failed} test(s) are failing, so the count is not worth comparing yet.${OFF}`)
  process.exit(1)
}

if (stated !== total) {
  console.log(`${RED}  The readme says ${stated} tests. There are ${total}.${OFF}`)
  console.log('')
  console.log(`  The readme is public and it is the only file most people read. Change the`)
  console.log(`  line that reads "npm test          # ${stated} tests" to say ${total}.`)
  process.exit(1)
}

console.log(`${GREEN}  ok${OFF}    the readme says ${total} tests, and there are ${total}`)

// ── every row of the "what is built" table ───────────────────────────────────
//
// Each row that states a count carries the test file behind it in an HTML
// comment, which markdown does not show. Three counts in that table matched no
// file at all until 30 August: numbers that had been true once and had not been
// true for days, in the most quoted part of the most public file.
//
// A number nobody can trace is worse than no number. It reads as evidence.
let problems = 0

const ROW = /\*\*built, ([\d,]+) tests?\.?\*\*.*?<!--\s*([^>]*?)\s*-->/g
const claimedFiles = new Set()

for (const row of readme.matchAll(ROW)) {
  const said = Number(row[1].replace(/,/g, ''))
  const files = row[2].split(/\s+/).filter(Boolean)

  let real = 0
  for (const file of files) {
    claimedFiles.add(file)
    const count = perFile.get(file)
    if (count === undefined) {
      console.log(`${RED}  the readme names ${file}, and the runner produced nothing from it.${OFF}`)
      problems += 1
      continue
    }
    real += count
  }

  if (real !== said) {
    console.log(
      `${RED}  the readme says ${said} tests for ${files.join(' + ')}. There are ${real}.${OFF}`,
    )
    problems += 1
  }
}

if (problems === 0) {
  console.log(`${GREEN}  ok${OFF}    every per-row count matches its test file`)
}

// ── and nothing has silently fallen off the table ────────────────────────────
//
// The other direction, and the one that matters more. A wrong count is visible
// once somebody checks. A whole area of the project quietly missing from the
// table is invisible for ever, and the table reads as complete either way.
const unclaimed = [...perFile.keys()].filter((file) => !claimedFiles.has(file)).sort()
if (unclaimed.length > 0) {
  console.log(`${RED}  these test files are in the suite and no row of the readme claims them:${OFF}`)
  for (const file of unclaimed) console.log(`      ${file}  (${perFile.get(file)} tests)`)
  console.log('')
  console.log(`  Add a row, or add the file to an existing row's comment. A table that`)
  console.log(`  silently omits a whole area still reads as though it were complete.`)
  problems += 1
} else {
  console.log(`${GREEN}  ok${OFF}    every test file in the suite is claimed by a row`)
}

// The strongest form of the same check: the rows have to add up to the whole
// suite. Two rows claiming one file, or a row double-counted, fails here even
// though both of the checks above would pass.
const summed = [...claimedFiles].reduce((sum, file) => sum + (perFile.get(file) ?? 0), 0)
if (summed !== total) {
  console.log(`${RED}  the rows account for ${summed} tests and the suite has ${total}.${OFF}`)
  problems += 1
} else {
  console.log(`${GREEN}  ok${OFF}    the rows account for every one of the ${total} tests`)
}

console.log(`${DIM}${'─'.repeat(60)}${OFF}`)
console.log('')
process.exit(problems > 0 ? 1 : 0)
