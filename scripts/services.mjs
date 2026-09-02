/**
 * Write the website's list of outside companies, and fail if it has drifted.
 *
 *     npm run services          write it
 *     npm run services:check    fail if the committed file disagrees with the code
 *
 * WHY THIS IS GENERATED RATHER THAN WRITTEN
 *
 * The list of companies Charter uses, what each one does, and whether that has
 * actually happened, existed in four places at once: the settings file, the readme,
 * the website and whatever anybody said out loud. Four copies of a list is one true
 * list and three that are slowly going wrong, and the wrong ones read exactly as
 * confidently as the right one.
 *
 * So there is one copy, in `src/vendors/who-does-what.ts`, and the page is made
 * from it. Nobody can update the page and forget the code, or the other way round.
 *
 * WHY IT FAILS RATHER THAN QUIETLY REWRITING
 *
 * Changing what this project claims about an outside company should be a
 * deliberate act that appears in a commit and gets read by a person. Regenerating
 * silently on every build would keep the file correct and would also mean nobody
 * ever notices the day "written, not proven" turns into "live".
 *
 * No dependencies, like every other check here.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const OUTPUT = 'site/services.js'

const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const OFF = '\x1b[0m'

/**
 * Ask the running code for the list.
 *
 * Run through the project's own TypeScript runner, so what is captured is what the
 * program is actually built from, rather than a copy of it reimplemented here in
 * JavaScript. A second copy is the whole thing this file exists to prevent.
 */
function generate() {
  const program = [
    "import { inRunOrder, howManyAreLive } from './src/vendors/who-does-what.ts'",
    'process.stdout.write(',
    '  JSON.stringify({ companies: inRunOrder(), live: howManyAreLive() }, null, 2),',
    ')',
  ].join('\n')

  const json = execFileSync(
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', '--eval', program],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] },
  )

  return [
    '// Generated from src/vendors/who-does-what.ts. Do not edit by hand.',
    '// Run "npm run services" after changing that file.',
    `window.CHARTER_SERVICES = ${json.trim()}`,
    '',
  ].join('\n')
}

const wanted = generate()
const checking = process.argv.includes('--check')

process.stdout.write(`\n${BOLD}Charter — the outside companies${OFF}\n`)
process.stdout.write(`${DIM}${'─'.repeat(60)}${OFF}\n`)

const held = JSON.parse(wanted.slice(wanted.indexOf('{')))
const live = held.companies.filter((one) => one.state === 'live').length
const written = held.companies.filter((one) => one.state === 'written, not proven').length
const missing = held.companies.filter((one) => one.state === 'not built').length

process.stdout.write(
  `  ${held.companies.length} companies: ${live} live, ${written} written but never called, ` +
    `${missing} not built\n`,
)

if (!checking) {
  writeFileSync(OUTPUT, wanted, 'utf8')
  process.stdout.write(`${GREEN}  written${OFF}  ${OUTPUT}\n`)
  process.stdout.write(`${DIM}${'─'.repeat(60)}${OFF}\n\n`)
  process.exit(0)
}

const onDisk = existsSync(OUTPUT) ? readFileSync(OUTPUT, 'utf8') : ''

if (onDisk === wanted) {
  process.stdout.write(`${GREEN}  ok${OFF}      ${OUTPUT} matches the code\n`)
  process.stdout.write(`${DIM}${'─'.repeat(60)}${OFF}\n\n`)
  process.exit(0)
}

process.stdout.write(`${RED}  FAIL${OFF}    ${OUTPUT} disagrees with src/vendors/who-does-what.ts.\n`)

const mine = wanted.split('\n')
const theirs = onDisk.split('\n')
for (let at = 0; at < Math.max(mine.length, theirs.length); at += 1) {
  if (mine[at] === theirs[at]) continue
  process.stdout.write(`\n          first difference, line ${at + 1}:\n`)
  process.stdout.write(`            committed: ${DIM}${theirs[at] ?? '(nothing)'}${OFF}\n`)
  process.stdout.write(`            the code:  ${DIM}${mine[at] ?? '(nothing)'}${OFF}\n`)
  break
}

process.stdout.write('\n          Run "npm run services" and read the change before committing it.\n')
process.stdout.write(`${DIM}${'─'.repeat(60)}${OFF}\n\n`)
process.exit(1)
