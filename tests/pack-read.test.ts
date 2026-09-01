/**
 * Proving that the words shown on the website are the words in the sealed file.
 *
 * WHY THIS MATTERS
 *
 * The website shows a visitor the finished document. Not a description of it and
 * not a picture of one: the words that are actually in the file the run sealed,
 * read back out of those bytes at build time and set in the page's own type.
 *
 * That only means something if the reading is faithful. A reader that quietly
 * drops a line, or garbles a word, turns the strongest claim on the page into the
 * weakest, because the page would then be showing its own copy of the document
 * while saying it is showing the document.
 *
 * Two things have already gone wrong here, and both are covered below.
 *
 * The first was punctuation. A PDF writes its text in an encoding called WinAnsi,
 * which agrees with the older Latin-1 everywhere except thirty-two positions. In
 * that block WinAnsi keeps the punctuation a document actually uses and Latin-1
 * keeps control characters nobody can see. Reading the bytes as Latin-1 turned
 * every curly apostrophe into an invisible character, and the sentence promising
 * that nothing was signed on anybody's behalf appeared on the website as
 * "anybody[]s behalf".
 *
 * The second was bullets. A PDF places a list marker and the words beside it as
 * two separate drawing instructions, because they sit at two different places on
 * the page. Read back in the order they were drawn, that comes out as a line
 * holding nothing but a bullet followed by the line it was pointing at. The
 * website showed thirty-one empty list items.
 */

import { describe, expect, it } from 'vitest'
import { deflateSync } from 'node:zlib'

import { pagesOf } from '../src/pack/read.js'

/**
 * A PDF holding one page whose drawing instructions are exactly the ones given.
 *
 * Small on purpose. It is not a real PDF and does not need to be: `pagesOf` looks
 * for compressed blocks between the words `stream` and `endstream`, and reads the
 * text-drawing instructions inside them. Building the smallest thing that shape
 * keeps each test about one behaviour instead of about a file format.
 */
function pdfDrawing(instructions: string): Uint8Array {
  const body = deflateSync(Buffer.from(instructions, 'latin1'))
  return Buffer.concat([
    Buffer.from('%PDF-1.7\nstream\n', 'latin1'),
    body,
    Buffer.from('\nendstream\n%%EOF', 'latin1'),
  ])
}

/** The same text as a PDF hexadecimal string, which is the other form a PDF uses. */
function asHex(text: string): string {
  return `<${Buffer.from(text, 'latin1').toString('hex')}> Tj`
}

describe('reading the words back out of a sealed packet', () => {
  it('reads text written as ordinary characters in brackets', () => {
    const pages = pagesOf(pdfDrawing('(Formation Pack) Tj (Rivera Sisters Baking Co) Tj'))

    expect(pages).toEqual([['Formation Pack', 'Rivera Sisters Baking Co']])
  })

  it('reads text written as hexadecimal, which is the other form a PDF uses', () => {
    // Both forms are read rather than only the one the library we use happens to
    // write today. A reader that quietly stopped seeing anything after a library
    // update would produce an empty page rather than an error.
    const pages = pagesOf(pdfDrawing(`${asHex('Formation Pack')} ${asHex('Owners')}`))

    expect(pages).toEqual([['Formation Pack', 'Owners']])
  })

  it('keeps the order the strings were drawn in, whichever form they were written', () => {
    const pages = pagesOf(pdfDrawing(`(first) Tj ${asHex('second')} (third) Tj`))

    expect(pages).toEqual([['first', 'second', 'third']])
  })

  it("puts back the curly apostrophe, instead of an invisible character", () => {
    // The exact sentence that broke. WinAnsi position 0x92 is a right single
    // quotation mark. Latin-1 says the same byte is a control character, and a
    // control character in the middle of a word is a word nobody can read.
    const drawn = pdfDrawing(`(No part of it was signed on anybody\x92s behalf.) Tj`)

    expect(pagesOf(drawn)).toEqual([['No part of it was signed on anybody’s behalf.']])
  })

  it('puts back every character in that block the documents actually use', () => {
    const drawn = pdfDrawing(
      `(\x91one\x92 \x93two\x94 three\x85 four\x96five\x97six \x95 seven\x82 eight\x84) Tj`,
    )

    expect(pagesOf(drawn)).toEqual([
      ['‘one’ “two” three… four–five—six • seven‚ eight„'],
    ])
  })

  it('gives a bullet to the line it marks, rather than a line of its own', () => {
    const drawn = pdfDrawing('(\x95) Tj (ARTICLE 1 \x97 FORMATION) Tj')

    expect(pagesOf(drawn)).toEqual([['• ARTICLE 1 — FORMATION']])
  })

  it('drops a marker with nothing after it, because it marks nothing', () => {
    const drawn = pdfDrawing('(Total contributed) Tj (\x95) Tj')

    expect(pagesOf(drawn)).toEqual([['Total contributed']])
  })

  it('leaves a line that merely starts with a bullet alone', () => {
    // The rule is about a drawing instruction that holds nothing but a marker.
    // A line whose own words begin with one is already a line.
    const drawn = pdfDrawing('(\x95 already one line) Tj (next) Tj')

    expect(pagesOf(drawn)).toEqual([['• already one line', 'next']])
  })

  it('gives back one list per page, and no empty pages', () => {
    const two = Buffer.concat([
      Buffer.from(pdfDrawing('(page one) Tj')),
      Buffer.from(pdfDrawing('(page two) Tj')),
    ])

    expect(pagesOf(two)).toEqual([['page one'], ['page two']])
  })

  it('skips a block it cannot decompress instead of failing', () => {
    // An embedded font, or the seal itself. Neither is text and neither is an
    // error: a packet is expected to contain blocks this is not able to read.
    const mixed = Buffer.concat([
      Buffer.from('stream\nnot compressed at all\nendstream\n', 'latin1'),
      Buffer.from(pdfDrawing('(the real words) Tj')),
    ])

    expect(pagesOf(mixed)).toEqual([['the real words']])
  })

  it('gives back nothing at all for a file holding no readable text', () => {
    expect(pagesOf(Buffer.from('%PDF-1.7\n%%EOF', 'latin1'))).toEqual([])
  })

  it('unescapes the characters a PDF has to write with a backslash', () => {
    const drawn = pdfDrawing('(a \\(bracket\\) and a \\\\ backslash) Tj')

    expect(pagesOf(drawn)).toEqual([['a (bracket) and a \\ backslash']])
  })
})
