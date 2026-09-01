/**
 * Check that the website cannot say anything the run does not say.
 *
 *     npm run site:check
 *
 * WHY THIS EXISTS
 *
 * The whole argument of Charter's website is that no number on it was typed in by
 * hand. That is a promise, and a promise is worth what the thing enforcing it is
 * worth. When the page was being designed, a draft of it carried a fingerprint
 * that does not exist anywhere in this repository, in a document whose entire
 * thesis is that nothing is typed by hand. Nobody noticed for a day.
 *
 * So the promise is a check now, which is the same argument this project already
 * makes about its tool boundary: a rule written in a document is followed until the
 * day somebody is in a hurry, and a rule the build enforces is followed on that day
 * too.
 *
 * WHAT IT LOOKS FOR
 *
 *   1. A token on the page that resolves to nothing. The page prints the token's
 *      own name in brackets when that happens, so a visitor sees "[counts.humna]"
 *      where a number should be. This catches it before anybody else does.
 *
 *   2. A fingerprint written into the markup by hand. Eight or more hexadecimal
 *      characters in a row, anywhere a reader would see them.
 *
 *   3. A count written into the markup by hand. Three or more digits in a row.
 *
 *   4. An em dash in our own writing. The record and the agreement contain them,
 *      and those are quoted as they were written. Ours do not, and this is where
 *      that is enforced rather than remembered.
 *
 *   5. Anything the page loads from another company. The page says it sends
 *      nothing anywhere, and that has to be true of the page as well as of the
 *      software.
 *
 *   6. The two data files disagreeing with each other.
 *
 *   7. innerHTML in the replay. Every value on the page is set as text, so nothing
 *      out of the record can become an element, whatever it holds.
 *
 * No dependencies, like every other check in this project.
 */

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'

const PAGE = 'site/index.html'
const STYLE = 'site/charter.css'
const REPLAY = 'site/demo.js'
const DATA = 'site/run.json'
const SCRIPT = 'site/run.js'

const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const OFF = '\x1b[0m'

const complaints = []

function need(path) {
  if (!existsSync(path)) {
    complaints.push(
      `${path} is missing. Run npm run site:data, which builds it from a real run.`,
    )
    return null
  }
  return readFileSync(path, 'utf8')
}

const page = need(PAGE)
const style = need(STYLE)
const replay = need(REPLAY)
const dataText = need(DATA)
const scriptText = need(SCRIPT)

if (page === null || style === null || replay === null || dataText === null || scriptText === null) {
  for (const complaint of complaints) console.error(`  - ${complaint}`)
  process.exit(1)
}

const run = JSON.parse(dataText)

/** The markup with its comments and tags taken out, which is what a reader sees. */
const visible = page.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]*>/g, ' ')

/* ─────────────────────────────────────────────────────────── 1. every token ── */

/**
 * The names the replay works out for itself, rather than reading straight off the
 * run. Read out of the replay's own list so the two cannot drift: adding a name
 * there is enough, and this file never needs touching.
 */
function derivedNames() {
  const block = /var DERIVED = \{([\s\S]*?)\n  \}/.exec(replay)
  if (block === null) {
    complaints.push(
      `${REPLAY} no longer has a DERIVED list this check can read, so it cannot tell ` +
        `a real token from a typo. Restore the list, or teach this check where the names live.`,
    )
    return new Set()
  }

  const names = new Set(['here'])
  const line = /^\s*(?:'([^']+)'|([A-Za-z][\w]*)):/gm
  let found
  while ((found = line.exec(block[1])) !== null) names.add(found[1] ?? found[2])
  return names
}

const derived = derivedNames()

function resolves(path) {
  if (derived.has(path)) return true

  let at = run
  for (const bit of path.split('.')) {
    if (at === null || at === undefined || typeof at !== 'object') return false
    at = at[bit]
  }
  return at !== undefined && at !== null && at !== ''
}

const tokens = [...page.matchAll(/data-run="([^"]+)"/g)].map((one) => one[1])
if (tokens.length === 0) {
  complaints.push(
    `${PAGE} carries no data-run tokens at all, which would mean every value on the ` +
      `page is typed into the markup. That is the one thing this page must never do.`,
  )
}

for (const token of [...new Set(tokens)]) {
  if (!resolves(token)) {
    complaints.push(
      `${PAGE} asks for "${token}" and neither the run nor the replay has it. The page ` +
        `would print "[${token}]" where a value belongs.`,
    )
  }
}

/* ────────────────────────────────────────────────── 2 and 3. nothing typed ── */

for (const found of visible.matchAll(/\b[0-9a-f]{8,}\b/g)) {
  complaints.push(
    `${PAGE} has "${found[0]}" written into it, which is the shape of a fingerprint. ` +
      `Every fingerprint on this page comes from the run through a data-run token.`,
  )
}

for (const found of visible.matchAll(/\b\d{3,}\b/g)) {
  complaints.push(
    `${PAGE} has the number ${found[0]} written into it. Every count on this page is ` +
      `read from the run, so a number in the markup is one nobody checked.`,
  )
}

/* ───────────────────────────────────────────────────────── 4. our own words ── */

for (const [what, text] of [
  [PAGE, page],
  [STYLE, style],
  [REPLAY, replay],
]) {
  const lines = text.split('\n')
  lines.forEach((line, at) => {
    if (!line.includes('—')) return
    complaints.push(
      `${what} line ${at + 1} contains an em dash. The record and the agreement contain ` +
        `them and are quoted as they were written, at the moment the page runs. Ours do ` +
        `not: ${line.trim().slice(0, 80)}`,
    )
  })
}

/* ────────────────────────────────────────────── 5. nothing from anybody else ── */

const addresses = [
  ...[...page.matchAll(/(?:href|src)="([^"]+)"/g)].map((one) => one[1]),
  ...[...style.matchAll(/url\('?([^')]+)'?\)/g)].map((one) => one[1]),
]

for (const address of [...new Set(addresses)]) {
  if (/^(https?:)?\/\//.test(address)) {
    complaints.push(
      `${PAGE} loads "${address}" from another company. The page says it sends nothing ` +
        `anywhere, and a request for a font or a script is a visitor's address handed to ` +
        `somebody they were never asked about.`,
    )
    continue
  }
  if (address.startsWith('#') || address.startsWith('data:') || address.startsWith('mailto:')) {
    continue
  }

  const from = address.startsWith('fonts/') ? 'site' : 'site'
  const path = normalize(join(from, address)).replace(/\\/g, '/')
  if (!existsSync(path)) {
    complaints.push(`${PAGE} points at ${address}, and there is no file at ${path}.`)
  }
}

/* ───────────────────────────────────────── 6. the two data files must agree ── */

const inScript = /^window\.CHARTER_RUN = ([\s\S]*)$/m.exec(scriptText)
if (inScript === null) {
  complaints.push(`${SCRIPT} is not the shape this page loads. Run npm run site:data.`)
} else if (JSON.stringify(JSON.parse(inScript[1])) !== JSON.stringify(run)) {
  complaints.push(
    `${SCRIPT} and ${DATA} hold different data. The page reads one and a visitor ` +
      `downloads the other, so they have to be the same run.`,
  )
}

/* ───────────────────────────────────────────── 7. nothing becomes an element ── */

// Looked for as things being DONE rather than as words being written, so a
// comment explaining that the page does not do this is not itself a failure.
const BUILDS_MARKUP = [
  /\.innerHTML\s*=/,
  /\.outerHTML\s*=/,
  /insertAdjacentHTML/,
  /document\.write\s*\(/,
]

for (const shape of BUILDS_MARKUP) {
  if (shape.test(replay)) {
    complaints.push(
      `${REPLAY} builds part of the page as markup (${shape.source}). Every value on this ` +
        `page comes out of a record, and a record is not something to hand to a markup parser.`,
    )
  }
}

/* ───────────────────────── the record's own names have to fit ── */

// Every row of the diary is one line: what happened on the left, the detail
// beside it. The diary stores each kind of step under a short dotted name, and
// the page shows a plain phrase in its place, so the column has to fit the
// phrase rather than the name.
//
// The column is a fixed width, because the rows have to line up with each other,
// and a fixed width is a guess about the longest thing that will ever go in it.
// So the guess is checked here rather than trusted, against the phrases the page
// really renders, read out of the page's own table. If a later run records a step
// whose phrase is too long, this fails and says by how much, instead of the
// website quietly breaking "filled it in wrongly" across two lines, where it
// reads as two separate things happening.

const columnWidth = /--kind-col:\s*(\d+)ch/.exec(style)
const wordsBlock = /var PLAIN_WORDS = \{([\s\S]*?)\n  \}/.exec(replay)

if (columnWidth === null) {
  complaints.push(
    `${STYLE} no longer sets --kind-col in characters, so there is no way to check that what ` +
      `the rows say fits the column that holds it.`,
  )
} else if (wordsBlock === null) {
  complaints.push(
    `${REPLAY} no longer holds a PLAIN_WORDS table, so there is no way to know what the rows ` +
      `actually say, and no way to check that it fits.`,
  )
} else {
  const inWords = new Map(
    [...wordsBlock[1].matchAll(/'([^']+)':\s*'([^']*)'/g)].map((one) => [one[1], one[2]]),
  )

  const fits = Number(columnWidth[1])
  const shown = run.entries.map((entry) => inWords.get(entry.kind) ?? entry.kind)
  const longest = shown.reduce((one, other) => (other.length > one.length ? other : one), '')

  if (longest.length > fits) {
    complaints.push(
      `${PAGE} would show "${longest}" in the column that says what happened, which is ` +
        `${longest.length} characters, and ${STYLE} gives that column ${fits}. It would wrap ` +
        `onto a second line and read as two things happening. Widen --kind-col to at least ` +
        `${longest.length}ch.`,
    )
  }

  // A step the table has no phrase for falls back to its dotted name, which is
  // the diary talking to itself in the middle of a page written for everybody.
  const unnamed = [...new Set(run.entries.map((one) => one.kind))].filter(
    (kind) => !inWords.has(kind),
  )

  if (unnamed.length > 0) {
    complaints.push(
      `${REPLAY} has no plain words for ${unnamed.join(', ')}, so ${unnamed.length === 1 ? 'that step' : 'those steps'} ` +
        `would appear on the page under the name the diary uses for ${unnamed.length === 1 ? 'it' : 'them'} ` +
        `internally. Add ${unnamed.length === 1 ? 'a phrase' : 'phrases'} to PLAIN_WORDS.`,
    )
  }
}

/* ────────────────────── the page keeps no list of its own ── */

// The contract is not the same every time. Most of its sections are in every
// one Charter writes, and a few are there because of something the owners
// actually decided. The page marks that second group, so a reader can see
// which parts of the document exist because of their own answers.
//
// Which sections those are is decided by the code that assembles the contract,
// and the answer travels with the data. The page once carried its own copy of
// the headings instead. That copy was right for this run and would have been
// wrong for the next one: a run where the owners DO have a way out gets a
// different section, and the page would have marked nothing while still saying
// two of them were theirs.
//
// So the page is not allowed to name a section heading at all. If it needs to
// know something about a section, the data has to say it.

const headings = run.agreement?.articles?.map((one) => one.heading) ?? []

for (const heading of headings) {
  if (replay.includes(`'${heading}'`) || replay.includes(`"${heading}"`)) {
    complaints.push(
      `${REPLAY} has the section heading "${heading}" written into it. Which sections are ` +
        `in a contract, and why, is decided when the contract is written, and a copy of ` +
        `that decision kept in the page is a copy that will be wrong for the next run. ` +
        `Read it from the data instead.`,
    )
  }
}

// And the fact the page needs has to actually be there.
const unmarked = (run.agreement?.articles ?? []).filter(
  (one) => typeof one.becauseOfAnAnswer !== 'boolean',
)

if (unmarked.length > 0) {
  complaints.push(
    `${DATA} has ${unmarked.length} contract section(s) that do not say whether they are ` +
      `there because of an answer, so the page cannot tell a reader which parts of the ` +
      `document exist because of what they said. Run npm run site:data.`,
  )
}

/* ─────────────────────────────────────────────────────────────────── report ── */

console.log('')
console.log(`${BOLD}Charter, what the website is allowed to say${OFF}`)
console.log(`${DIM}${'─'.repeat(70)}${OFF}`)

if (complaints.length > 0) {
  for (const complaint of complaints) console.log(`${RED}  x${OFF}  ${complaint}`)
  console.log('')
  console.log(`  ${complaints.length} problem(s). The page is not built.`)
  console.log(`${DIM}${'─'.repeat(70)}${OFF}`)
  console.log('')
  process.exit(1)
}

console.log(
  `${GREEN}  ok${OFF}    ${new Set(tokens).size} tokens, all of them resolved; nothing typed in ` +
    `by hand; nothing loaded from anybody else`,
)
console.log(`${DIM}${'─'.repeat(70)}${OFF}`)
console.log('')
