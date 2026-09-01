/**
 * Building the Formation Pack itself: a real PDF, made here, sealed here.
 *
 * WHY THIS IS CHARTER'S OWN CODE AND NOT A VENDOR'S
 *
 * The pack is the thing the owners walk away with and the thing they sign. Every
 * claim this project makes about it — that it was sealed, that only filling in and
 * signing remain possible, that its fingerprint is of exactly the bytes that were
 * sealed — is a claim about this file.
 *
 * Handing that to an outside document service would put the most important object
 * in the project behind an account, an allowance, and somebody else's uptime. It
 * would also mean the seal happened somewhere we cannot see. So the pack is
 * assembled with the same library that seals it, in this process, and a stranger
 * with no accounts at all gets exactly the same pack a demonstration produces.
 *
 * THE ORDER IS THE WHOLE POINT
 *
 * Write every page, then seal, then fingerprint the sealed bytes. Nothing that
 * rewrites the file runs afterwards, and the rule that enforces that lives in
 * `assemble.ts` beside the list of what would be refused.
 *
 * A fingerprint of a file that can still be rewritten proves only what the file
 * used to be.
 *
 * WHAT THE PACK CONTAINS, AND WHY THE THIRD ONE IS UNUSUAL
 *
 *   1. A cover page naming the business, the owners, and what this is not.
 *   2. The ownership agreement, every number already worked out.
 *   3. **What Charter was asked to do and would not.** A list of refusals. Most
 *      software ships a list of what it can do; this ships the other one, because
 *      the limits are the part that has to be checkable.
 *   4. What each owner's identity document produced, and which values a person
 *      checked.
 *   5. Where to sign, and the sentence that says a machine did not.
 *
 * WHAT IS DELIBERATELY NOT IN IT
 *
 * No date of birth, no document number, no identity value of any kind. The pack
 * says which fields were read and which were checked by a person. It does not
 * reprint them. A packet that gathers every owner's identity details onto one page
 * is a document nobody should be asked to carry around.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import type { AgreementData } from '../agreement/prepare.js'
import { refusedAfterSealing } from './assemble.js'

/** Every page is US Letter, because these are United States formation documents. */
const PAGE = { width: 612, height: 792 } as const

const MARGIN = 64

/**
 * How far up the page the footer sits, and how small it is.
 *
 * Below the margin, in the band the body text never reaches, so adding it cannot
 * push anything onto another page or overlap a signature line.
 */
const FOOT = 34
const SMALL = 8
const LINE = 15

const INK = rgb(0.1, 0.1, 0.12)
const QUIET = rgb(0.42, 0.42, 0.46)
const RULE = rgb(0.85, 0.85, 0.88)

/** What one owner's identity check produced, as the pack reports it. */
export interface IdentitySummary {
  readonly owner: string
  /** How many values were read off the document. */
  readonly fieldsRead: string
  /** Which values a person looked at. Names only — never the values themselves. */
  readonly checkedByAPerson: readonly string[]
  /** Required values the document never produced. */
  readonly missing: readonly string[]
}

export interface PackContents {
  readonly caseId: string
  readonly agreement: AgreementData
  /** Everything Charter decided while preparing the agreement, in plain words. */
  readonly explanation: readonly string[]
  readonly identity: readonly IdentitySummary[]
  /** Anything actually refused while this pack was being assembled. */
  readonly refusedInThisRun: readonly { readonly operation: string; readonly why: string }[]
  /** The date on the cover, already written the way a person reads it. */
  readonly preparedOn: string
  /**
   * The moment stamped inside the file itself.
   *
   * Passed in rather than read from the clock, and that is the whole reason the
   * pack is reproducible. A PDF carries its own creation and modification dates,
   * and a library left to fill them in reads the clock — so two people building
   * the same pack from the same record would get two different files and have
   * nothing they could compare.
   *
   * The SEAL is a different matter and is not reproducible: the signing library
   * stamps the file's own identifier from the clock. That was measured rather than
   * assumed. So the claim made here is exactly this and no more: **the pack is the
   * same bytes every time; the sealed pack is not.**
   */
  readonly stampedAt: Date
}

/** A page being written, and where the next line goes. */
interface Sheet {
  readonly page: PDFPage
  y: number
}

interface Pens {
  readonly body: PDFFont
  readonly bold: PDFFont
}

/**
 * Break text into lines that fit the page.
 *
 * Written out rather than relying on the library, which has no wrapping. A word
 * longer than the whole line is left to overflow rather than being cut: a
 * truncated word in a legal document is worse than an ugly one, because it changes
 * what the document says.
 */
export function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = []
  let current = ''

  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current === '' ? word : `${current} ${word}`
    if (font.widthOfTextAtSize(candidate, size) <= width) {
      current = candidate
      continue
    }
    if (current !== '') lines.push(current)
    current = word
  }

  if (current !== '') lines.push(current)
  return lines.length === 0 ? [''] : lines
}

export class PackBuilder {
  private readonly sheets: Sheet[] = []

  constructor(
    private readonly document: PDFDocument,
    private readonly pens: Pens,
  ) {
    this.newPage()
  }

  private get sheet(): Sheet {
    return this.sheets[this.sheets.length - 1] as Sheet
  }

  private newPage(): void {
    const page = this.document.addPage([PAGE.width, PAGE.height])
    this.sheets.push({ page, y: PAGE.height - MARGIN })
  }

  /** Make room, starting a new page when this one is full. */
  private room(height: number): void {
    if (this.sheet.y - height < MARGIN) this.newPage()
  }

  gap(height = LINE): void {
    this.sheet.y -= height
  }

  heading(text: string): void {
    this.room(LINE * 3)
    this.gap(LINE)
    const sheet = this.sheet
    sheet.page.drawText(text, {
      x: MARGIN,
      y: sheet.y,
      size: 13,
      font: this.pens.bold,
      color: INK,
    })
    sheet.y -= 8
    sheet.page.drawLine({
      start: { x: MARGIN, y: sheet.y },
      end: { x: PAGE.width - MARGIN, y: sheet.y },
      thickness: 0.75,
      color: RULE,
    })
    sheet.y -= LINE
  }

  /** One block of ordinary text, wrapped. */
  paragraph(text: string, options: { readonly size?: number; readonly quiet?: boolean } = {}): void {
    const size = options.size ?? 10
    const font = this.pens.body
    const lines = wrap(text, font, size, PAGE.width - MARGIN * 2)

    for (const line of lines) {
      this.room(LINE)
      const sheet = this.sheet
      sheet.page.drawText(line, {
        x: MARGIN,
        y: sheet.y,
        size,
        font,
        color: options.quiet === true ? QUIET : INK,
      })
      sheet.y -= LINE
    }
  }

  /** A labelled value, with the label in bold on the left. */
  row(label: string, value: string): void {
    this.room(LINE)
    const sheet = this.sheet
    sheet.page.drawText(label, {
      x: MARGIN,
      y: sheet.y,
      size: 10,
      font: this.pens.bold,
      color: INK,
    })
    const left = MARGIN + 150
    for (const [at, line] of wrap(value, this.pens.body, 10, PAGE.width - MARGIN - left).entries()) {
      if (at > 0) this.room(LINE)
      const on = this.sheet
      on.page.drawText(line, { x: left, y: on.y, size: 10, font: this.pens.body, color: INK })
      on.y -= LINE
    }
  }

  bullet(text: string): void {
    const size = 10
    const left = MARGIN + 14
    const lines = wrap(text, this.pens.body, size, PAGE.width - MARGIN - left)

    for (const [at, line] of lines.entries()) {
      this.room(LINE)
      const sheet = this.sheet
      if (at === 0) {
        sheet.page.drawText('•', { x: MARGIN, y: sheet.y, size, font: this.pens.body, color: QUIET })
      }
      sheet.page.drawText(line, { x: left, y: sheet.y, size, font: this.pens.body, color: INK })
      sheet.y -= LINE
    }
  }

  get pageCount(): number {
    return this.sheets.length
  }

  /**
   * Write the foot of every page, once the number of pages is finally known.
   *
   * WHY THIS EXISTS
   *
   * Everything else in this project is about being able to tell whether something
   * is whole. The record catches an entry altered in the middle. The attestation
   * catches entries taken off the end. The seal catches a byte changed after
   * sealing.
   *
   * And then the document itself — the part a person prints, holds and signs — had
   * nothing on it at all. Remove the middle sheet from a printed copy and nothing
   * in what is left says a thing is missing. "Page 2 of 3" is the oldest
   * tamper-evidence there is and it is the only one that survives a printer.
   *
   * WHY IT RUNS AT THE END
   *
   * The total cannot be known until the last page exists. Written as each page is
   * started, every page would have to guess, and a document that says "Page 1 of 1"
   * on the first of three is worse than one that says nothing.
   *
   * The company's name goes beside it for the same reason: a loose sheet found on
   * its own should say which document it fell out of.
   */
  footEveryPage(companyName: string): void {
    const total = this.sheets.length

    this.sheets.forEach((sheet, at) => {
      const left = `${companyName} — Formation Pack`
      const right = `Page ${at + 1} of ${total}`

      sheet.page.drawText(left, {
        x: MARGIN,
        y: FOOT,
        size: SMALL,
        font: this.pens.body,
        color: QUIET,
      })
      sheet.page.drawText(right, {
        x: PAGE.width - MARGIN - this.pens.body.widthOfTextAtSize(right, SMALL),
        y: FOOT,
        size: SMALL,
        font: this.pens.body,
        color: QUIET,
      })
    })
  }
}

/**
 * Write the whole pack and hand back the bytes, unsealed.
 *
 * Unsealed on purpose. Sealing is a separate step that happens afterwards, so the
 * order — write, then seal, then fingerprint the sealed bytes — is visible in the
 * caller rather than hidden in here.
 */
export async function buildPackDocument(contents: PackContents): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  const pens: Pens = {
    body: await document.embedFont(StandardFonts.Helvetica),
    bold: await document.embedFont(StandardFonts.HelveticaBold),
  }

  // Stamped from what was passed in, never from the clock. See `stampedAt` above:
  // a library left to fill these in reads the clock, and two people building the
  // same pack would get two different files.
  document.setCreationDate(contents.stampedAt)
  document.setModificationDate(contents.stampedAt)
  document.setProducer('Charter')
  document.setCreator('Charter')
  document.setTitle(`Formation Pack — ${contents.agreement.companyName}`)
  document.setSubject(
    'Prepared for the owners to read and sign themselves. Nothing in it has been ' +
      'signed, and the software that made it cannot sign it.',
  )

  const pack = new PackBuilder(document, pens)
  const data = contents.agreement

  // ---- 1. the cover ---------------------------------------------------------
  pack.heading('Formation Pack')
  pack.row('Business', data.companyName)
  pack.row('Formed in', data.state)
  pack.row('Prepared on', contents.preparedOn)
  pack.row('Owners', data.owners.map((one) => one.fullName).join(', '))
  pack.row('Case', contents.caseId)
  pack.gap()

  pack.paragraph(
    'This packet was prepared by Charter. It is ready for the owners named above ' +
      'to read and sign themselves.',
  )
  pack.gap(8)
  pack.paragraph(
    'What this is not: it is not legal advice, it is not a filing with any ' +
      'government office, and nothing in it has been signed. No part of it was ' +
      'signed on anybody’s behalf, and nothing in this software is able to do that.',
    { quiet: true },
  )

  // ---- 2. the agreement -----------------------------------------------------
  pack.heading('The ownership agreement')
  pack.paragraph(
    `Made on ${data.agreementDate} between the ${data.ownerCountInWords} owners ` +
      `named below, for ${data.companyName}, a limited liability company formed in ` +
      `${data.state}.`,
  )
  pack.gap(8)

  for (const owner of data.owners) {
    pack.row(
      `${owner.ordinal} owner`,
      `${owner.fullName} — contributed ${owner.contribution}. Credited in this ` +
        `agreement at ${owner.contributionValue}. Holds ${owner.agreedShare}.`,
    )
    if (!owner.agreedMatchesContribution) {
      pack.paragraph(
        `The share agreed for ${owner.fullName} is ${owner.agreedShare}, and the ` +
          `share their contribution alone would give is ${owner.shareOfContributions}. ` +
          `Texas allocates profit and loss by the value of each owner’s contribution ` +
          `unless the agreement says otherwise, so this agreement says otherwise, on ` +
          `purpose and in writing.`,
        { quiet: true },
      )
    }
  }

  pack.gap(8)
  pack.row('Total credited', data.totalContributions)

  // Said once, plainly, because the two numbers on the lines above look like a
  // contradiction until somebody explains that they answer different questions.
  // One owner describes an oven as worth about $12,000 and the agreement credits it
  // at $20,000; a reader who is not told why reasonably concludes there is a
  // mistake. There is not. The credited figure is the one the owners agreed, and it
  // is the one the law then uses.
  pack.paragraph(
    'What something is worth on the open market and what the owners agree to credit ' +
      'it at are different numbers, and both belong here. Texas divides profit by ' +
      'the credited value as written in the company’s records, and this agreement is ' +
      'that record. Every credited figure above was stated by the owners themselves ' +
      'and answered in their own words; Charter refuses to write one down that ' +
      'nobody has said.',
    { quiet: true },
  )
  pack.row('An ordinary decision', `carries on ${data.ordinaryVote} of ownership`)
  pack.row('A decision that changes the deal', `carries on ${data.majorVote}`)

  pack.gap()
  pack.paragraph('The articles in this agreement, in order:')
  for (const article of data.articles) {
    pack.bullet(`${article.fullHeading} — ${article.why}`)
  }

  if (data.deadlockPossible) {
    pack.gap(8)
    pack.paragraph(
      'These shares allow an exact tie, so this agreement includes a deadlock ' +
        'article. It is left out when the arithmetic makes a tie impossible.',
      { quiet: true },
    )
  }

  // ---- 3. what Charter would not do -----------------------------------------
  pack.heading('What Charter was asked to do, and would not')
  pack.paragraph(
    'Once this pack is sealed, anything that would rewrite the file is refused. ' +
      'That is not a setting. Below is the complete list of what would be refused ' +
      'and why, taken from the same rule the software actually enforces.',
  )
  pack.gap(8)

  for (const one of refusedAfterSealing()) {
    pack.bullet(`${one.operation} — ${one.why}`)
  }

  pack.gap(8)
  if (contents.refusedInThisRun.length === 0) {
    pack.paragraph(
      'Nothing on that list was asked for while this pack was being assembled. The ' +
        'list is printed anyway, because a limit nobody can check is not a limit.',
      { quiet: true },
    )
  } else {
    pack.paragraph('Asked for while this pack was being assembled, and refused:')
    for (const one of contents.refusedInThisRun) {
      pack.bullet(`${one.operation} — ${one.why}`)
    }
  }

  pack.gap(8)
  pack.paragraph('Decisions Charter made while preparing this agreement, in its own words:')
  for (const line of contents.explanation) pack.bullet(line)

  // ---- 4. the identity documents --------------------------------------------
  pack.heading('The owners’ identity documents')
  pack.paragraph(
    'Each owner’s document was read by a document service. It reads; it decides ' +
      'nothing. Whether a value needed a person to look at it was worked out ' +
      'afterwards in plain code, and no model took any part in that decision.',
  )
  pack.gap(8)
  pack.paragraph(
    'The values read off those documents are deliberately NOT reprinted here. This ' +
      'page says which values were read and which a person checked. A packet that ' +
      'gathered every owner’s date of birth and document number onto one page is a ' +
      'document nobody should be asked to carry around.',
    { quiet: true },
  )
  pack.gap(8)

  for (const one of contents.identity) {
    pack.row(one.owner, `${one.fieldsRead} values read from their document`)
    if (one.checkedByAPerson.length > 0) {
      pack.bullet(
        `A person checked these against the document itself: ` +
          `${one.checkedByAPerson.join(', ').replace(/_/g, ' ')}.`,
      )
    } else {
      pack.bullet('Nothing on this document needed a person to look at it.')
    }
    if (one.missing.length > 0) {
      pack.bullet(
        `The document did not produce: ${one.missing.join(', ').replace(/_/g, ' ')}. ` +
          `Nobody can confirm a value that is not there, so this needs a clearer document.`,
      )
    }
  }

  // ---- 5. where a person signs ----------------------------------------------
  pack.heading('Signing')
  pack.paragraph(
    'Nothing in this packet has been signed. The owners named on the cover sign it ' +
      'themselves.',
  )
  pack.gap(8)
  pack.paragraph(
    'Charter sealed this document and vouched for its own record of how it was ' +
      'made. It did not sign anything, and it is not able to. The law lets software ' +
      'form a contract, with the result attributed to the person to be bound — but a ' +
      'signature is a process executed or adopted BY A PERSON, with the intent to ' +
      'sign. Forming may be delegated. The signature is the act of a person, and a ' +
      'machine has no intent to lend it.',
    { quiet: true },
  )
  pack.gap()

  for (const owner of data.owners) {
    pack.gap(LINE * 2)
    pack.row(owner.fullName, '________________________________     Date: ______________')
  }

  // Last, because the total cannot be known until the last page exists. A document
  // that says "Page 1 of 1" on the first of three is worse than one that says
  // nothing at all.
  pack.footEveryPage(data.companyName)

  return document.save()
}
