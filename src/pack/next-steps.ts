/**
 * The page that says what Charter did not do.
 *
 * WHY A WHOLE DOCUMENT FOR THIS
 *
 * Charter prepares everything around the government filing. It does not make the
 * filing. That sentence is easy to write in marketing and easy to forget when a
 * person is holding a thick, official-looking packet with their company's name on
 * the cover and every page in order.
 *
 * A packet that looks finished, in the hands of somebody who does not know it is
 * not finished, is the most expensive failure this project could produce. Their
 * company would not exist. They would find out when a bank, a customer or a court
 * asked them to prove it did.
 *
 * So the packet carries its own correction, in the same file, sealed with
 * everything else, and it is the last thing the owners read before they sign.
 *
 * WHY IT IS A SEPARATE DOCUMENT RATHER THAN A SECTION
 *
 * Because it is genuinely a separate document, and because that is what makes the
 * joining step in this project real work rather than a step performed on one file
 * for the look of it. Two documents exist; a document service joins them; the
 * joined file is what gets sealed. If the join failed, the packet would visibly be
 * missing its last pages rather than quietly missing a service call.
 *
 * WHAT IT WILL NOT SAY
 *
 * It names the office and the form. It does not state a fee, a processing time, or
 * a requirement, and it never will. Those change, a stale number in a sealed
 * document is worse than no number, and telling somebody what their filing costs
 * shades into advice about how to make it. It points at the office's own published
 * page and tells the owners to read it there.
 *
 * For any state other than Texas it says plainly that Charter does not hold the
 * office details, rather than guessing at them. A guessed office address in a
 * legal packet is a person driving to the wrong building.
 */

import { PDFDocument, StandardFonts } from 'pdf-lib'

import { PackBuilder, type Pens } from './document.js'

/** What one state's filing office is called, and where its own page is. */
interface FilingOffice {
  readonly office: string
  /** The form's own published name and number, in the office's words. */
  readonly form: string
  /** The office's own page. Never a page of ours summarising theirs. */
  readonly readItHere: string
}

/**
 * The states whose filing office Charter actually knows.
 *
 * One, today, and said out loud rather than implied by a list that quietly runs
 * out. Charter's agreement writing reasons about Texas law specifically — which
 * article is needed, what the statute does when the agreement is silent — so Texas
 * is the state it can honestly say anything about.
 */
export const FILING_OFFICES: Readonly<Record<string, FilingOffice>> = {
  TX: {
    office: 'the Texas Secretary of State',
    form: 'Certificate of Formation, Limited Liability Company (Form 205)',
    readItHere: 'sos.texas.gov',
  },
}

/** The office for a state, or nothing when Charter does not hold it. */
export function officeFor(state: string): FilingOffice | undefined {
  return FILING_OFFICES[state.trim().toUpperCase()]
}

export interface NextStepsContents {
  readonly companyName: string
  readonly state: string
  readonly owners: readonly string[]
  /** Whether a web address was actually registered in this run. */
  readonly addressRegistered: string | undefined
  /**
   * The moment stamped inside the file.
   *
   * Passed in rather than read from the clock, for the same reason the rest of the
   * packet does it: a file that changes every time it is built is a file nobody
   * can compare against anybody else's copy.
   */
  readonly stampedAt: Date
}

/**
 * Write the page, and hand back the bytes, unsealed.
 *
 * Unsealed on purpose. It is joined to the rest of the packet first, and the
 * joined file is what gets sealed, so the seal covers everything the owners read.
 */
export async function buildNextStepsDocument(contents: NextStepsContents): Promise<Uint8Array> {
  // See the note in src/pack/join.ts. Without this, pdf-lib puts the current time
  // over the dates set below, and the same contents build to different bytes.
  const document = await PDFDocument.create({ updateMetadata: false })
  const pens: Pens = {
    body: await document.embedFont(StandardFonts.Helvetica),
    bold: await document.embedFont(StandardFonts.HelveticaBold),
  }

  document.setCreationDate(contents.stampedAt)
  document.setModificationDate(contents.stampedAt)
  document.setProducer('Charter')
  document.setCreator('Charter')
  document.setTitle(`What you must still do yourself — ${contents.companyName}`)

  const page = new PackBuilder(document, pens)
  const office = officeFor(contents.state)

  page.heading('What you must still do yourself')

  page.paragraph(
    `Signing this packet does not create ${contents.companyName}. Nothing in this ` +
      `packet has been sent to any government office, and Charter did not send it. ` +
      `Your company does not exist until the office below has accepted a filing ` +
      `that you make.`,
  )
  page.gap(8)
  page.paragraph(
    'Read this page before you sign anything. It is the shortest page in the packet ' +
      'and it is the one that decides whether the rest of it is worth anything.',
    { quiet: true },
  )

  // ---- the filing ------------------------------------------------------------
  page.heading('The filing')

  if (office === undefined) {
    page.paragraph(
      `Charter does not hold the filing office details for ${contents.state}. It ` +
        `will not guess at them, because a guessed office in a legal packet sends ` +
        `somebody to the wrong building with the wrong form.`,
    )
    page.gap(8)
    page.paragraph(
      `Find the office that registers companies in ${contents.state} — it is usually ` +
        `the Secretary of State — and read its own published requirements before you ` +
        `file anything.`,
      { quiet: true },
    )
  } else {
    page.row('Office', office.office)
    page.row('Form', office.form)
    page.row('Read it here', office.readItHere)
    page.gap(8)
    page.paragraph(
      `You file this yourself, with ${office.office}. Charter has not filed it, ` +
        `cannot file it, and will not file it.`,
    )
    page.gap(8)
    page.paragraph(
      'Charter deliberately does not print the fee, the processing time, or the list ' +
        'of what the form requires. Those change. A number that was right on the day ' +
        'this packet was sealed and wrong on the day you read it is worse than no ' +
        'number at all, so read them on the office’s own page above.',
      { quiet: true },
    )
  }

  // ---- what this packet is ---------------------------------------------------
  page.heading('What this packet is, and what it is not')

  page.bullet(
    'It is the agreement between the owners about how they own the business ' +
      'together. That agreement is between you, not between you and the state, and ' +
      'it takes effect when you sign it.',
  )
  page.bullet(
    'It is not a filing, not a registration, and not legal advice. Charter is ' +
      'software. It prepared documents; it did not advise anybody.',
  )
  page.bullet(
    'Nothing in it has been signed. Charter sealed the file, which fixes what it ' +
      'contains, and vouched for its own record of how it was made. A seal is not a ' +
      'signature. Only the people named on the cover sign this, and only by their ' +
      'own hand.',
  )

  if (contents.addressRegistered !== undefined) {
    page.bullet(
      `A web address, ${contents.addressRegistered}, was registered for you during ` +
        `this run. That is a real registration with a real registrar and it renews ` +
        `on their schedule, not ours. It has nothing to do with whether the company ` +
        `exists.`,
    )
  }

  // ---- the order ---------------------------------------------------------------
  page.heading('The order to do things in')

  page.bullet(`Read the whole packet. Every owner reads it, not one owner for everybody.`)
  page.bullet(
    `Sign it. All ${contents.owners.length === 1 ? 'of you' : `${contents.owners.length} of you`}: ` +
      `${contents.owners.join(', ')}. A packet signed by some of the owners is not the deal ` +
      `the packet describes.`,
  )
  page.bullet(
    office === undefined
      ? 'File your state’s formation document with its own office, yourself.'
      : `File the ${office.form} with ${office.office}, yourself.`,
  )
  page.bullet(
    'Keep the signed packet. The agreement is the company’s own record of who ' +
      'contributed what, and the law reads that record when the owners disagree.',
  )

  page.gap()
  page.paragraph(
    'If anything in this packet is wrong, do not sign it. A sealed packet can be ' +
      'thrown away and prepared again at no cost. A signed one is an agreement.',
    { quiet: true },
  )

  page.footEveryPage(contents.companyName)

  return document.save()
}
