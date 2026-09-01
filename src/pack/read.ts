/**
 * Reading the words back out of a sealed packet.
 *
 * WHY THIS EXISTS
 *
 * The website shows a reader the finished document. Not a description of it, not a
 * mock up of it, and not a picture of one: the words that are actually in the file
 * the run sealed.
 *
 * A browser will sometimes render a PDF in place and sometimes will not. It
 * depends on the browser, on its settings, and on whether somebody has turned the
 * built-in viewer off. A page whose main artifact is a blank rectangle on a
 * judge's machine has shown them nothing at all, and shipped a promise it did not
 * keep.
 *
 * So the words are read out of the sealed bytes here, at build time, and the site
 * sets them in its own type. The file itself is still beside the page and still
 * downloadable, and its fingerprint is printed next to it, so nothing about this
 * asks anybody to take our word for what is inside.
 *
 * HOW IT READS THEM
 *
 * A PDF holds each page's drawing instructions in a compressed block. The
 * instructions that put text on the page are `Tj`, and the string they take is
 * written either as ordinary characters in brackets or as hexadecimal in angle
 * brackets. Both forms are read, rather than only the one the library we use
 * happens to write today, because a reader that quietly stopped seeing anything
 * after a library update would produce an empty page rather than an error.
 *
 * Twenty lines rather than a dependency. A PDF parser here would be a second large
 * thing to trust, in the one place this project is arguing that nothing should be
 * taken on trust.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not lay anything out. It gives back the strings in the order they were
 * drawn, one list per page, and where they sit on the page is not its business.
 */

import { inflateSync } from 'node:zlib'

/** Where one compressed block starts and ends. */
interface Block {
  readonly from: number
  readonly to: number
}

function blocksIn(raw: Buffer): Block[] {
  const blocks: Block[] = []
  let at = 0

  for (;;) {
    const start = raw.indexOf('stream', at)
    if (start === -1) break
    const end = raw.indexOf('endstream', start)
    if (end === -1) break

    // Past "stream" and its line break, which is one character or two.
    let from = start + 'stream'.length
    if (raw[from] === 0x0d) from += 1
    if (raw[from] === 0x0a) from += 1

    blocks.push({ from, to: end })
    at = end + 'endstream'.length
  }

  return blocks
}

/**
 * The sixteen characters a PDF writes differently from Latin-1.
 *
 * A PDF's standard text encoding is WinAnsi, which agrees with Latin-1 everywhere
 * except one block of thirty-two positions. In that block WinAnsi keeps the
 * punctuation a document actually uses, and Latin-1 keeps control characters
 * nobody can see. So reading the bytes as Latin-1 turns every curly apostrophe and
 * every dash in the agreement into an invisible control character, and the
 * document appears on the website with a box in the middle of "owner's".
 *
 * Only the positions this project's own documents use are here. Anything else in
 * that block would be a character the pack writer has never written, and inventing
 * a mapping for it would be guessing.
 */
const WINANSI: Readonly<Record<number, string>> = {
  0x82: '\u201a',
  0x84: '\u201e',
  0x85: '\u2026',
  0x91: '\u2018',
  0x92: '\u2019',
  0x93: '\u201c',
  0x94: '\u201d',
  0x95: '\u2022',
  0x96: '\u2013',
  0x97: '\u2014',
}

/** Latin-1 text, with the WinAnsi block put back the way the document meant it. */
function fromWinAnsi(text: string): string {
  return text.replace(/[\u0080-\u009f]/g, (one) => WINANSI[one.charCodeAt(0)] ?? one)
}

/** Every string one block draws, in the order it draws them. */
function drawnIn(text: string): string[] {
  const said: { readonly at: number; readonly text: string }[] = []

  for (const match of text.matchAll(/<([0-9A-Fa-f\s]+)>\s*Tj/g)) {
    said.push({
      at: match.index ?? 0,
      text: fromWinAnsi(
        Buffer.from((match[1] ?? '').replace(/\s+/g, ''), 'hex').toString('latin1'),
      ),
    })
  }
  for (const match of text.matchAll(/\((?:\\.|[^\\)])*\)\s*Tj/g)) {
    const whole = match[0]
    said.push({
      at: match.index ?? 0,
      text: fromWinAnsi(whole.slice(1, whole.lastIndexOf(')')).replace(/\\([()\\])/g, '$1')),
    })
  }

  return joinMarkers(
    said
      .sort((one, other) => one.at - other.at)
      .map((one) => one.text)
      .filter((one) => one.trim() !== ''),
  )
}

/**
 * A bullet belongs to the line it marks, not to a line of its own.
 *
 * A PDF places a list marker and the words beside it as two separate drawing
 * instructions, because they sit at two different places on the page. Read back
 * in the order they were drawn, that comes out as a line holding nothing but a
 * bullet, followed by the line it was pointing at. On the page that reads as an
 * empty item followed by an unmarked one, thirty-one times in this packet.
 *
 * So a drawn string that is only a marker is put back in front of the string
 * that followed it. A marker with nothing after it is dropped, because a bullet
 * pointing at nothing is not something the document said.
 */
function joinMarkers(lines: readonly string[]): string[] {
  const joined: string[] = []
  let marker = ''

  for (const line of lines) {
    if (/^[•·–—-]$/.test(line.trim())) {
      marker = line.trim()
      continue
    }
    joined.push(marker === '' ? line : `${marker} ${line}`)
    marker = ''
  }

  return joined
}

/**
 * The words in a sealed packet, one list per page.
 *
 * Blocks that are not compressed, or hold no text at all, are left out rather than
 * appearing as empty pages. A packet with no readable text gives back an empty
 * list, and the caller decides what to say about that.
 */
export function pagesOf(pdf: Uint8Array): readonly (readonly string[])[] {
  const raw = Buffer.from(pdf)
  const pages: string[][] = []

  for (const block of blocksIn(raw)) {
    let text: string
    try {
      text = inflateSync(raw.subarray(block.from, block.to)).toString('latin1')
    } catch {
      // Not a compressed block. An embedded font, or the seal itself.
      continue
    }

    const lines = drawnIn(text)
    if (lines.length > 0) pages.push(lines)
  }

  return pages
}
