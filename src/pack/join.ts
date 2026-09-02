/**
 * Joining documents into one, here, with no account and no network.
 *
 * WHY THIS EXISTS ALONGSIDE THE REAL SERVICE
 *
 * Charter uses an outside document service to join the pack together, because
 * joining is reversible work and that is what an outside service is for. But a
 * fresh clone of this project has no keys, and it has to produce a real pack
 * anyway — otherwise nobody can evaluate the thing without signing up to four
 * companies first.
 *
 * So this is a genuine join, done here. It is not a placeholder and it does not
 * hand back a pretend file: it opens each document, copies every page across in
 * order, and writes a real PDF. A run with no keys produces a pack somebody can
 * open, read and sign.
 *
 * WHAT IT DELIBERATELY CANNOT DO
 *
 * It cannot read the text back out of a finished document, and it does not pretend
 * to. Reading back exists so that a **different program than the one that wrote
 * the pack** can say what the pack says, and a reader living in the same project
 * as the writer would not be that. So `readBack` here answers "this did not
 * happen", which is the truth, and the record says the pack's text was not
 * checked rather than claiming it was checked and fine.
 *
 * That is the whole difference between the two, and it is the reason the outside
 * service is worth having rather than a convenience.
 *
 * ABOUT THE DATES
 *
 * A PDF carries its own creation and modification dates, and a library left to
 * fill them in reads the clock. Two people joining the same documents would then
 * get two different files and have nothing they could compare. So the dates are
 * copied from the first document rather than taken from the clock, and the join is
 * the same bytes every time.
 */

import { PDFDocument } from 'pdf-lib'

import type { DocumentPart, DocumentService, JoinedDocument, ReadBack, Shrunk } from '../tools/services.js'

/** What the record calls this, so every entry spells it the same way. */
export const JOINED_HERE =
  "Charter's own code, with no account and no network. A real join, not a stand-in"

/**
 * A document service that joins for real and is honest about the rest.
 *
 * Chosen when there is no key for the outside service, or when a run is replaying
 * answers recorded in advance.
 */
export function joinHere(options: { readonly whyNotTheService: string }): DocumentService {
  return {
    async join(parts: readonly DocumentPart[]): Promise<JoinedDocument> {
      if (parts.length === 0) throw new Error('There is nothing to join.')

      if (parts.length === 1) {
        return {
          bytes: (parts[0] as DocumentPart).bytes,
          partNames: [(parts[0] as DocumentPart).name],
          joinedBy: 'nobody. There was one document, so there was nothing to join',
        }
      }

      // updateMetadata: false is the whole of the paragraph below working.
      //
      // pdf-lib otherwise writes the CURRENT time into the file as its
      // modification date, which quietly undoes the dates set just after this.
      // Joining the same parts twice produced two files one byte apart, and a
      // packet whose fingerprint changes every time it is built cannot be
      // compared to anything, which is most of what this project is for.
      //
      // The test that caught it had been passing by luck: two joins in the same
      // second produce the same second.
      const joined = await PDFDocument.create({ updateMetadata: false })

      // Taken from the first document rather than from the clock. See the note at
      // the top: a joined file that changes every time cannot be compared.
      // updateMetadata: false here too, and this is the one that actually bit.
      //
      // Loading a document ALSO restamps its modification date to now, by
      // default. So the date read out of the first part on the next line was not
      // the date that part was made: it was the moment we opened it. Copying that
      // into the joined file made the join depend on the clock after all, and the
      // fix one line up looked like it had worked because each part on its own
      // had become steady.
      const first = await PDFDocument.load(toBytes((parts[0] as DocumentPart).bytes), {
        updateMetadata: false,
      })
      joined.setCreationDate(first.getCreationDate() ?? new Date(0))
      joined.setModificationDate(first.getModificationDate() ?? new Date(0))
      joined.setProducer('Charter')
      joined.setCreator('Charter')
      const title = first.getTitle()
      if (title !== undefined && title !== '') joined.setTitle(title)

      for (const part of parts) {
        const source = await PDFDocument.load(toBytes(part.bytes), { updateMetadata: false })
        const pages = await joined.copyPages(source, source.getPageIndices())
        for (const page of pages) joined.addPage(page)
      }

      return {
        bytes: await joined.save(),
        partNames: parts.map((one) => one.name),
        joinedBy: JOINED_HERE,
      }
    },

    async readBack(): Promise<ReadBack> {
      // Never true here, on purpose. See the note at the top of this file.
      return {
        happened: false,
        text: '',
        readBy:
          `nobody. The pack's text was not read back, so nothing here says it was ` +
          `checked. ${options.whyNotTheService}`,
      }
    },

    async shrink(bytes: Uint8Array): Promise<Shrunk> {
      return {
        bytes,
        wasShrunk: false,
        shrunkBy: `nobody. ${options.whyNotTheService}`,
      }
    },
  }
}

/**
 * A copy of the bytes that the PDF library will accept.
 *
 * It wants an ArrayBuffer it owns. Handing it a view into a larger buffer, which
 * is what a slice of a Node buffer is, makes it read past the end of the document
 * and fail with a message about a broken file that is not broken.
 */
function toBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes)
}
