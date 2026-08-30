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

/** Ask the test runner how many tests there are. */
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
  return { total: report.numTotalTests, failed: report.numFailedTests }
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
const { total, failed } = countTests()

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
console.log(`${DIM}${'─'.repeat(60)}${OFF}`)
console.log('')
