/**
 * Write `.env.example` from the code, and fail if the committed file has drifted.
 *
 *     npm run settings          write it
 *     npm run settings:check    fail if the committed file disagrees with the code
 *
 * WHY THIS EXISTS
 *
 * `.env.example` is the file that tells a stranger what to put in `.env`, the file
 * of settings and credentials that is never committed. Until 30 August 2026 it
 * listed seven settings that **no code anywhere read**. Somebody following it
 * exactly would have set the depth an identity document is read at, the ceiling on
 * how large a request to a model may be, and the confidence floor below which a
 * value goes to a person — and every one of those would have been ignored.
 *
 * A setting that is documented and ignored is worse than no setting. It tells a
 * reader the program can be steered, invites them to steer it, and then quietly
 * does something else.
 *
 * So the file is now produced from one list in `src/settings.ts`, and every entry
 * in that list names the file that reads it or says plainly that nothing does yet.
 * There is no second copy anybody can forget to update, and this check fails the
 * build the moment the file and the code disagree.
 *
 * WHY IT FAILS RATHER THAN QUIETLY REWRITING
 *
 * Regenerating on every build would keep the file correct and would also mean
 * nobody ever notices a setting appearing or a reader disappearing. Both are meant
 * to be deliberate acts that show up in a commit and get read by a person.
 *
 * It also checks the real `.env`, if there is one, against the same rules the
 * program uses at startup — so a value that would stop a run is found now rather
 * than in the middle of a demonstration.
 *
 * No dependencies on purpose, like every other check here.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const OUTPUT = '.env.example'

const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'
const OFF = '\x1b[0m'

/**
 * Ask the running code for the file and for what it thinks of the real `.env`.
 *
 * Run in a separate process through the project's own TypeScript runner, so what
 * is captured is what the program itself would be built from — not the same logic
 * written a second time here in JavaScript, which would be a second copy able to
 * drift, which is the whole thing this file exists to prevent.
 *
 * The answer comes back as one JSON object rather than as two runs, because two
 * runs of the same code could disagree and there would be no way to tell.
 */
function askTheCode() {
  const program = [
    "import { readFileSync, existsSync } from 'node:fs'",
    "import { renderEnvExample, settingsNothingReads, parseEnvText, readSettings, SETTINGS } from './src/settings.ts'",
    '',
    'let realEnv = null',
    "if (existsSync('.env')) {",
    '  try {',
    "    readSettings(parseEnvText(readFileSync('.env', 'utf8')))",
    '    realEnv = { ok: true, complaints: [] }',
    '  } catch (error) {',
    '    realEnv = { ok: false, complaints: error.complaints ?? [String(error.message)] }',
    '  }',
    '}',
    '',
    'process.stdout.write(JSON.stringify({',
    '  file: renderEnvExample(),',
    '  total: SETTINGS.length,',
    '  unread: settingsNothingReads().map((one) => one.name),',
    '  realEnv,',
    '}))',
  ].join('\n')

  return JSON.parse(
    execFileSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', '--eval', program], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'inherit'],
    }),
  )
}

const checking = process.argv.includes('--check')
const answer = askTheCode()

console.log('')
console.log(`${BOLD}Charter — the settings${OFF}`)
console.log(`${DIM}${'─'.repeat(64)}${OFF}`)
console.log(
  `  ${answer.total} settings, ${answer.total - answer.unread.length} read by something, ` +
    `${answer.unread.length} not read by anything yet`,
)

if (!checking) {
  writeFileSync(OUTPUT, answer.file, 'utf8')
  console.log(`${GREEN}  written${OFF}  ${OUTPUT}`)
  console.log(`${DIM}${'─'.repeat(64)}${OFF}`)
  console.log('')
  process.exit(0)
}

let problems = 0

// ── 1. does the committed file match the code? ────────────────────────────────
if (!existsSync(OUTPUT)) {
  console.log(`${RED}  ${OUTPUT} does not exist.${OFF}`)
  console.log(`  Run "npm run settings" to write it, and commit it.`)
  process.exit(1)
}

const committed = readFileSync(OUTPUT, 'utf8')

if (committed !== answer.file) {
  problems += 1
  console.log(`${RED}  FAIL${OFF}    ${OUTPUT} disagrees with src/settings.ts.`)
  console.log('')

  // The first differing line, so the reason is obvious without a diff tool.
  const a = committed.split('\n')
  const b = answer.file.split('\n')
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if (a[index] === b[index]) continue
    console.log(`          first difference, line ${index + 1}:`)
    console.log(`            committed: ${DIM}${a[index] ?? '(nothing — the file is shorter)'}${OFF}`)
    console.log(`            the code:  ${DIM}${b[index] ?? '(nothing — the code produces less)'}${OFF}`)
    break
  }
  console.log('')
  console.log(`          Run "npm run settings" and read the change before committing it.`)
} else {
  console.log(`${GREEN}  ok${OFF}      ${OUTPUT} matches src/settings.ts`)
}

// ── 2. is every unread setting honest about it? ───────────────────────────────
// The generated file says so in words, so this cannot fail while the file matches.
// It is here because it is the thing a reader actually cares about, and a number
// nobody prints is a number nobody checks.
if (answer.unread.length > 0) {
  console.log(
    `${YELLOW}  note${OFF}    nothing reads these yet, and ${OUTPUT} says so: ` +
      `${answer.unread.join(', ')}`,
  )
}

// ── 3. would the real .env actually start? ────────────────────────────────────
if (answer.realEnv === null) {
  console.log(`${DIM}  note    no .env here, so there was nothing to check. That is fine —${OFF}`)
  console.log(`${DIM}          the whole project runs with no settings at all.${OFF}`)
} else if (answer.realEnv.ok) {
  console.log(`${GREEN}  ok${OFF}      your .env passes every rule the program checks at startup`)
} else {
  problems += 1
  console.log(`${RED}  FAIL${OFF}    your .env would stop the program from starting:`)
  for (const complaint of answer.realEnv.complaints) console.log(`            - ${complaint}`)
}

console.log(`${DIM}${'─'.repeat(64)}${OFF}`)
console.log('')
process.exit(problems > 0 ? 1 : 0)
