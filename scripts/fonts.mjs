/**
 * Fetch the four type files the website uses, once, into `site/fonts/`.
 *
 *     node scripts/fonts.mjs
 *
 * WHY THE FILES LIVE IN THIS REPOSITORY INSTEAD OF BEING LINKED
 *
 * A page that links to somebody else's font server has three problems, and all
 * three matter for this particular page.
 *
 *   It tells that server who is reading. Every visitor's address is handed to a
 *   company nobody asked about. This site is one long argument about not doing
 *   things on a person's behalf without asking, so linking out would undercut the
 *   thing it says.
 *
 *   It stops working when opened off a disk with no network. A judge with a bad
 *   connection, or somebody opening the file from a folder, would get a page in a
 *   fallback face and a different rhythm from the one that was designed.
 *
 *   It is one more thing that can be down on the day.
 *
 * So the files are fetched once, here, and committed. After that the site needs
 * nothing from anybody.
 *
 * WHAT IS FETCHED, AND WHY EXACTLY THIS MUCH
 *
 * Two families in four files. Newsreader in roman and italic, IBM Plex Mono at 400
 * and 500. Nothing else, on purpose: the website never sets a serif above weight
 * 400, so the heavier file is not here to be reached for. The weight ceiling is
 * enforced by what is on the server rather than by anybody remembering.
 *
 * Only the latin part of each face is taken. The site is in English and the record
 * it prints is in English. The latin part also covers the curly apostrophe and the
 * em dash, which appear in the record's own words and in the agreement, so quoting
 * those correctly does not need a second file.
 *
 * Both families are under the SIL Open Font License, which allows this and asks
 * that the licence travel with the files. `site/fonts/LICENSE.md` says where each
 * one came from and under what terms.
 *
 * This is the only script in the project that reaches the network, it needs no
 * credentials, and it costs nothing.
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs'

const OUT = 'site/fonts'

const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const OFF = '\x1b[0m'

/**
 * A browser user agent, because the font service decides which file format to
 * offer from it. Asking as Node gets a truetype file, which is roughly twice the
 * size for the same letters.
 */
const AS_A_BROWSER =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const WANTED = [
  {
    file: 'newsreader-roman.woff2',
    family: 'Newsreader',
    italic: false,
    query: 'family=Newsreader:ital,opsz,wght@0,6..72,400',
    what: 'the serif, upright. Every heading and every sentence on the site.',
  },
  {
    file: 'newsreader-italic.woff2',
    family: 'Newsreader',
    italic: true,
    query: 'family=Newsreader:ital,opsz,wght@1,6..72,400',
    what: 'the serif, slanted. Only the refusals and the things the check cannot prove.',
  },
  {
    file: 'plexmono-400.woff2',
    family: 'IBM Plex Mono',
    italic: false,
    weight: '400',
    query: 'family=IBM+Plex+Mono:wght@400',
    what: 'the monospace. Every entry of the record.',
  },
  {
    file: 'plexmono-500.woff2',
    family: 'IBM Plex Mono',
    italic: false,
    weight: '500',
    query: 'family=IBM+Plex+Mono:wght@500',
    what: 'the monospace, one step heavier. The kind column and the small labels.',
  },
]

/**
 * The latin block, which is the one this site needs.
 *
 * Recognised by its unicode range starting at U+0000, which is how the font
 * service marks the block holding ordinary English. Matching on the range rather
 * than on the comment above it means a change to their comments cannot quietly
 * pick the wrong file.
 */
const LATIN = 'U+0000-00FF'

async function styleSheetFor(one) {
  const url = `https://fonts.googleapis.com/css2?${one.query}&display=swap`
  const answer = await fetch(url, { headers: { 'User-Agent': AS_A_BROWSER } })
  if (!answer.ok) throw new Error(`${url} answered ${answer.status}`)
  return answer.text()
}

/** Pull the one latin woff2 address out of a stylesheet full of blocks. */
function latinAddressIn(css, one) {
  const blocks = css.split('@font-face').slice(1)

  for (const block of blocks) {
    if (!block.includes(LATIN)) continue
    if (one.italic !== block.includes('font-style: italic')) continue
    if (one.weight !== undefined && !block.includes(`font-weight: ${one.weight}`)) continue

    const found = /url\((https:\/\/[^)]+\.woff2)\)/.exec(block)
    if (found !== null) return found[1]
  }

  throw new Error(
    `no latin block for ${one.family}${one.italic ? ' italic' : ''}` +
      `${one.weight === undefined ? '' : ` at ${one.weight}`} in the stylesheet that came back`,
  )
}

console.log('')
console.log(`${BOLD}Charter, the four type files the website uses${OFF}`)
console.log(`${DIM}${'─'.repeat(68)}${OFF}`)

mkdirSync(OUT, { recursive: true })

let fetched = 0
let already = 0

for (const one of WANTED) {
  const path = `${OUT}/${one.file}`

  if (existsSync(path) && !process.argv.includes('--again')) {
    console.log(`${DIM}  have${OFF}     ${one.file}`)
    already += 1
    continue
  }

  const css = await styleSheetFor(one)
  const address = latinAddressIn(css, one)
  const answer = await fetch(address, { headers: { 'User-Agent': AS_A_BROWSER } })
  if (!answer.ok) {
    console.error(`${RED}  ${address} answered ${answer.status}${OFF}`)
    process.exit(1)
  }

  const bytes = new Uint8Array(await answer.arrayBuffer())
  writeFileSync(path, bytes)
  console.log(
    `${GREEN}  got${OFF}      ${one.file.padEnd(24)} ${String(Math.round(bytes.length / 1024)).padStart(3)} kB`,
  )
  console.log(`${DIM}           ${one.what}${OFF}`)
  fetched += 1
}

console.log('')
console.log(`  ${fetched} fetched, ${already} already here. Nothing else is needed from anybody.`)
console.log(`${DIM}${'─'.repeat(68)}${OFF}`)
console.log('')
