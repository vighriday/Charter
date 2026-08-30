/**
 * Write the tool catalogue into a committed file, and fail if it has drifted.
 *
 *     npm run catalogue          write it
 *     npm run catalogue:check    fail if the committed file disagrees with the code
 *
 * WHY THE CATALOGUE IS COMMITTED AT ALL
 *
 * The catalogue is the complete list of everything this agent can do, and in which
 * stage. It matters more than an ordinary feature list because of what it says at
 * the bottom: the things that are NOT on it, and cannot be reached from anything on
 * it. A list of what a program may do is ordinary. A list of what it may not, with
 * reasons, is not.
 *
 * Somebody deciding whether to trust this project should be able to read that list
 * without installing anything, without running anything, and without taking our
 * word for what the code does. That means it has to be a file in the repository.
 *
 * WHY IT IS GENERATED RATHER THAN WRITTEN
 *
 * A hand-written list drifts. It is right on the day it is written and wrong the
 * first time a tool is added, and the gap is invisible — the document still reads
 * as though it were complete.
 *
 * This project has already been bitten by the general version of that. One vendor's
 * own brief, readme and blog gave three different counts of their own tool set, and
 * none of the three matched the number in their code. We counted from the source
 * and found a fourth. The lesson taken from it was: **checkable beats quoted**, and
 * never print a number nobody has counted.
 *
 * So the catalogue is produced by the same declarations the running agent uses.
 * There is no second copy anybody could forget to update, and this check fails the
 * build the moment the file and the code disagree.
 *
 * WHY IT FAILS RATHER THAN QUIETLY REWRITING
 *
 * Regenerating on every build would keep the file correct and would also mean
 * nobody ever notices a tool appearing. Adding to what an agent can do should be a
 * deliberate act that shows up in a commit and gets read by a person. Failing is
 * the slower option and it is the one that keeps a human in the loop.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const OUTPUT = 'TOOLS.md'

const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const OFF = '\x1b[0m'

/**
 * Ask the running code for the catalogue.
 *
 * Run in a separate process through the project's own TypeScript runner, so that
 * what is captured is what the agent would actually be built from — not a copy of
 * the logic reimplemented here in JavaScript, which would be a second copy able to
 * drift, which is the whole thing this file exists to prevent.
 */
function generate() {
  const program = [
    "import { buildRegistry, catalogue } from './src/tools/registry.ts'",
    "import { ALL_TOOLS } from './src/tools/stage-tools.ts'",
    'process.stdout.write(catalogue(buildRegistry(ALL_TOOLS)))',
  ].join('\n')

  return execFileSync(
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', '--eval', program],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] },
  )
}

/** The catalogue wrapped as a document, with the note that it is generated. */
function asDocument(body) {
  return [
    '# What this agent can do',
    '',
    '**This file is generated from the code that runs.** It is not written by hand and',
    'it is not kept in step by anybody remembering. `npm run catalogue:check` fails the',
    'build if this file and the code disagree, so a tool cannot be added without this',
    'file changing in the same commit.',
    '',
    'The reason it is generated is worth stating. A hand-written list is right on the',
    'day it is written and wrong the first time a tool is added, and the gap is',
    'invisible — the document still reads as though it were complete. One vendor whose',
    'service this project uses publishes three different counts of their own tool set',
    'across their brief, their readme and their blog, and none of the three matches the',
    'number in their code. We counted from the source and found a fourth. **Checkable',
    'beats quoted.**',
    '',
    'The interesting part of this list is the end of it: the things that are not on it,',
    'and cannot be reached from anything that is.',
    '',
    '```',
    body.trimEnd(),
    '```',
    '',
  ].join('\n')
}

const checking = process.argv.includes('--check')
const generated = asDocument(generate())

console.log('')
console.log(`${BOLD}Charter — the tool catalogue${OFF}`)
console.log(`${DIM}${'─'.repeat(64)}${OFF}`)

if (!checking) {
  writeFileSync(OUTPUT, generated, 'utf8')
  console.log(`${GREEN}  written${OFF}  ${OUTPUT}`)
  console.log(`${DIM}${'─'.repeat(64)}${OFF}`)
  console.log('')
  process.exit(0)
}

if (!existsSync(OUTPUT)) {
  console.log(`${RED}  ${OUTPUT} does not exist.${OFF}`)
  console.log(`  Run "npm run catalogue" to write it, and commit it.`)
  process.exit(1)
}

const committed = readFileSync(OUTPUT, 'utf8')

if (committed !== generated) {
  console.log(`${RED}  ${OUTPUT} disagrees with the code.${OFF}`)
  console.log('')

  // Show the first line that differs, so the reason is obvious without a diff tool.
  const a = committed.split('\n')
  const b = generated.split('\n')
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if (a[index] === b[index]) continue
    console.log(`  first difference, line ${index + 1}:`)
    console.log(`    committed: ${DIM}${a[index] ?? '(nothing — the file is shorter)'}${OFF}`)
    console.log(`    the code:  ${DIM}${b[index] ?? '(nothing — the code produces less)'}${OFF}`)
    break
  }

  console.log('')
  console.log(`  Something the agent can do has changed. That is meant to be a deliberate`)
  console.log(`  act somebody reads, so this fails rather than quietly rewriting the file.`)
  console.log(`  Run "npm run catalogue" and read the change before committing it.`)
  process.exit(1)
}

console.log(`${GREEN}  ok${OFF}       ${OUTPUT} matches the code`)
console.log(`${DIM}${'─'.repeat(64)}${OFF}`)
console.log('')
