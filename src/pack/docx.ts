/**
 * The ownership agreement as a Word file the owners can edit.
 *
 * WHY THIS EXISTS BESIDE THE SEALED PACK
 *
 * The sealed pack is the thing the owners sign, and it is sealed precisely so that
 * nobody can change it afterwards. That is right for a document about to be
 * signed, and useless for the thing people actually need to do first: take it to
 * somebody they trust, argue about a clause, and change it.
 *
 * So the same agreement is written twice, from one set of values. A sealed PDF
 * nobody can alter, and a Word file anybody can. They cannot disagree, because
 * neither is typed — both are built from the numbers `prepare.ts` worked out.
 *
 * WHY IT IS BUILT HERE RATHER THAN BY A DOCUMENT SERVICE
 *
 * A Word file is a zip archive holding a few XML files. That is a published format
 * and about a hundred lines of code, and building it here means the agreement does
 * not sit behind an account, an allowance, or somebody else's uptime — which is
 * the same reasoning as the pack itself.
 *
 * WHAT IS DELIBERATELY NOT IN IT
 *
 * No identity values. Not a date of birth, not a document number. The same rule as
 * the pack, for the same reason: a document gathering every owner's identity
 * details is a document nobody should be asked to carry around.
 *
 * And no signature block that anything could fill in automatically. There are
 * lines for people to sign, and nothing in this project can put anything on them.
 */

import { deflateRawSync } from 'node:zlib'
import type { AgreementData } from '../agreement/prepare.js'

/** One file inside the archive. */
export interface ArchiveEntry {
  readonly path: string
  readonly text: string
}

/**
 * Fingerprint used by the zip format to notice a damaged file.
 *
 * Written out rather than pulled in, because it is a table and a loop and adding a
 * dependency for it would be worse than reading it. This is the ordinary CRC-32,
 * the same one every zip tool checks.
 */
function crc32(bytes: Uint8Array): number {
  let table = crcTable
  if (table === undefined) {
    table = new Int32Array(256)
    for (let at = 0; at < 256; at += 1) {
      let value = at
      for (let round = 0; round < 8; round += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
      }
      table[at] = value
    }
    crcTable = table
  }

  let running = -1
  for (const byte of bytes) {
    running = (running >>> 8) ^ (table[(running ^ byte) & 0xff] as number)
  }
  return (running ^ -1) >>> 0
}

let crcTable: Int32Array | undefined

/** Write a little-endian number of a given width. */
function little(value: number, bytes: number): Uint8Array {
  const out = new Uint8Array(bytes)
  let left = value >>> 0
  for (let at = 0; at < bytes; at += 1) {
    out[at] = left & 0xff
    left = Math.floor(left / 256)
  }
  return out
}

const join = (parts: readonly Uint8Array[]): Uint8Array => {
  const total = parts.reduce((sum, one) => sum + one.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/**
 * Pack files into a zip archive.
 *
 * Every timestamp inside is fixed rather than read from the clock. A Word file
 * built twice from the same agreement is then the same bytes both times, which is
 * what lets two people compare one — the same reason the pack carries a stamped
 * date passed in rather than read.
 */
export function zip(entries: readonly ArchiveEntry[]): Uint8Array {
  const encoder = new TextEncoder()
  const locals: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const name = encoder.encode(entry.path)
    const raw = encoder.encode(entry.text)
    const squeezed = deflateRawSync(raw)
    const sum = crc32(raw)

    const header = join([
      little(0x04034b50, 4), // this is a file
      little(20, 2), // the version needed to read it
      little(0, 2), // no flags
      little(8, 2), // squeezed
      little(0, 2), // fixed time
      little(0x21, 2), // fixed date: 1 January 1980, the earliest this format has
      little(sum, 4),
      little(squeezed.length, 4),
      little(raw.length, 4),
      little(name.length, 2),
      little(0, 2), // nothing extra
      name,
      squeezed,
    ])

    central.push(
      join([
        little(0x02014b50, 4), // an entry in the list at the end
        little(20, 2),
        little(20, 2),
        little(0, 2),
        little(8, 2),
        little(0, 2),
        little(0x21, 2),
        little(sum, 4),
        little(squeezed.length, 4),
        little(raw.length, 4),
        little(name.length, 2),
        little(0, 2),
        little(0, 2), // no comment
        little(0, 2), // the first disk, of one
        little(0, 2),
        little(0, 4),
        little(offset, 4),
        name,
      ]),
    )

    locals.push(header)
    offset += header.length
  }

  const list = join(central)
  const end = join([
    little(0x06054b50, 4), // the end of the list
    little(0, 2),
    little(0, 2),
    little(entries.length, 2),
    little(entries.length, 2),
    little(list.length, 4),
    little(offset, 4),
    little(0, 2), // no comment
  ])

  return join([...locals, list, end])
}

/** Turn text into something safe to put inside XML. */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** One line of the document, in the shape Word reads. */
function paragraph(
  text: string,
  options: { readonly style?: 'Title' | 'Heading1' | 'Heading2' | 'Quiet' } = {},
): string {
  const style = options.style
  const properties =
    style === undefined
      ? ''
      : `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>`
  return `<w:p>${properties}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`

const RELATIONSHIPS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

const DOCUMENT_RELATIONSHIPS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quiet"><w:name w:val="Quiet"/><w:rPr><w:i/><w:color w:val="666666"/></w:rPr></w:style>
</w:styles>`

/**
 * Write the agreement as a Word file.
 *
 * Every value comes from `prepare.ts`, which worked out the shares, the article
 * numbers and every cross-reference in whole numbers. Nothing here decides
 * anything — it lays out what was already decided, which is the same division the
 * sealed pack follows.
 */
export function buildAgreementDocx(data: AgreementData): Uint8Array {
  const body: string[] = []

  body.push(paragraph(`Company agreement of ${data.companyName}`, { style: 'Title' }))
  body.push(
    paragraph(
      `Made on ${data.agreementDate} between the ${data.ownerCountInWords} owners ` +
        `named below, for ${data.companyName}, a limited liability company formed in ` +
        `${data.state}.`,
    ),
  )
  body.push(
    paragraph(
      'This is a working copy. Nothing in it has been signed, and the software that ' +
        'prepared it cannot sign it. Change what you need to change, then have every ' +
        'owner sign the sealed copy.',
      { style: 'Quiet' },
    ),
  )

  // ---- the owners -----------------------------------------------------------
  body.push(paragraph('The owners, and what each one holds', { style: 'Heading1' }))

  for (const owner of data.owners) {
    body.push(paragraph(`${owner.ordinal} owner: ${owner.fullName}`, { style: 'Heading2' }))
    body.push(
      paragraph(
        `${owner.fullName} contributed ${owner.contribution}, valued at ` +
          `${owner.contributionValue}, and holds ${owner.agreedShare} of the company.`,
      ),
    )
    if (!owner.agreedMatchesContribution) {
      body.push(
        paragraph(
          `The share agreed for ${owner.fullName} is ${owner.agreedShare}. The share ` +
            `their contribution alone would give is ${owner.shareOfContributions}. ` +
            `Texas allocates profit and loss by the value of each owner's contribution ` +
            `as stated in the company's records unless the agreement says otherwise. ` +
            `This agreement says otherwise, on purpose and in writing.`,
          { style: 'Quiet' },
        ),
      )
    }
  }

  body.push(paragraph(`Total contributed: ${data.totalContributions}.`))

  // ---- decisions ------------------------------------------------------------
  body.push(paragraph('How decisions are made', { style: 'Heading1' }))
  body.push(
    paragraph(
      `An ordinary decision carries on ${data.ordinaryVote} of ownership. A decision ` +
        `that changes this agreement itself carries on ${data.majorVote}.`,
    ),
  )
  body.push(
    paragraph(
      'A majority means more than half. An owner holding exactly half does not carry ' +
        'an ordinary decision alone.',
      { style: 'Quiet' },
    ),
  )

  if (data.deadlockPossible) {
    body.push(
      paragraph(
        'These shares allow an exact tie, so this agreement includes a deadlock ' +
          'article. It is left out when the arithmetic makes a tie impossible.',
        { style: 'Quiet' },
      ),
    )
  }

  // ---- the articles ---------------------------------------------------------
  body.push(paragraph('The articles', { style: 'Heading1' }))

  for (const article of data.articles) {
    body.push(paragraph(article.fullHeading, { style: 'Heading2' }))
    body.push(paragraph(article.why))
  }

  // ---- signing --------------------------------------------------------------
  body.push(paragraph('Signing', { style: 'Heading1' }))
  body.push(
    paragraph(
      'Nothing in this document has been signed. Each owner named above signs it ' +
        'themselves.',
    ),
  )
  body.push(
    paragraph(
      'The software that prepared this sealed the finished packet and vouched for its ' +
        'own record of how it was made. It did not sign anything, and it is not able ' +
        'to. The law lets software form a contract, with the result attributed to the ' +
        'person to be bound — but a signature is a process executed or adopted by a ' +
        'person, with the intent to sign. Forming may be delegated. The signature is ' +
        'the act of a person, and a machine has no intent to lend it.',
      { style: 'Quiet' },
    ),
  )

  for (const owner of data.owners) {
    body.push(paragraph(''))
    body.push(paragraph(`${owner.fullName}   ______________________________   Date: ____________`))
  }

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
${body.join('\n')}
<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
</w:body>
</w:document>`

  return zip([
    { path: '[Content_Types].xml', text: CONTENT_TYPES },
    { path: '_rels/.rels', text: RELATIONSHIPS },
    { path: 'word/_rels/document.xml.rels', text: DOCUMENT_RELATIONSHIPS },
    { path: 'word/styles.xml', text: STYLES },
    { path: 'word/document.xml', text: document },
  ])
}
