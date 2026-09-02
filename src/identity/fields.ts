/**
 * What comes back when an identity document is read, in the shape Charter uses.
 *
 * WHAT THIS IS FOR
 *
 * Charter asks each owner for an identity document — a passport, a driving
 * licence. An outside service reads it and returns the fields: the name on it, the
 * date of birth, the document number, the expiry date.
 *
 * A reading service can be wrong. So the only useful question about each value it
 * returns is not "how sure does it feel" but **"can this value actually be found
 * in the document, and where?"** This file is the shape of that answer.
 *
 * THE TWO SIGNALS, AND WHY ONLY ONE OF THEM CAN BE CHECKED
 *
 * The service returns two different things per field, and they are not the same
 * kind of thing at all.
 *
 * A **match label** says whether the value it gave back can be located in the
 * source document, and how well: found exactly, assembled from several places,
 * only partly resolved, approximately matched, or not found at all. This is
 * evidence. Anybody can open the document and check it.
 *
 * A **confidence score** is a number saying how sure the reader felt. The service
 * states in its own guide that this number "is relative and uncalibrated; it isn't
 * a probability or percentage." A threshold on it compares against a scale with no
 * fixed meaning.
 *
 * Charter routes on the label. The score is the last test, not the first. For a
 * project whose whole argument is *check it yourself*, routing on the one signal
 * that cannot be checked would be the wrong choice made loudly.
 *
 * ONE MORE THING THE SERVICE SAYS PLAINLY
 *
 * **An absent score means no score was available. It does not mean a low one.** So
 * a missing score is never read as a bad score. It is read as a missing score, and
 * a missing score is a reason to have a person look — which is a different
 * sentence with a different reason behind it.
 */

/**
 * Whether a returned value can be found in the document it was read from.
 *
 * These are the service's own five labels. They are kept in their own words rather
 * than renamed, so that anybody comparing our record against the service's reply
 * is looking at the same word twice.
 */
export type MatchLabel =
  | 'id_match'
  | 'id_match_multiblock'
  | 'id_match_partial'
  | 'fuzzy_match'
  | 'not_found'

/**
 * Every label, as a list.
 *
 * The same five as the type above, in a form code can actually check against. A
 * label that arrives from the service and is not one of these becomes `not_found`,
 * which sends the value to a person — the only safe direction, because a label
 * nobody recognised is not evidence that a value is fine.
 */
export const MATCH_LABELS: readonly MatchLabel[] = [
  'id_match',
  'id_match_multiblock',
  'id_match_partial',
  'fuzzy_match',
  'not_found',
]

/** What each label means, in plain words, for the person doing the review. */
export const LABEL_MEANING: Readonly<Record<MatchLabel, string>> = {
  id_match: 'found exactly, in one place in the document',
  id_match_multiblock: 'found, assembled from several parts of the document',
  id_match_partial: 'only some of the cited parts of the document could be resolved',
  fuzzy_match: 'matched only approximately',
  not_found: 'could not be found in the document at all',
}

/**
 * The labels that mean a person has to look, whatever the score says.
 *
 * This list is the service's own recommendation, and the ordering of their
 * sentence is worth keeping: label first, score last.
 */
export const LABELS_NEEDING_A_PERSON: readonly MatchLabel[] = [
  'not_found',
  'fuzzy_match',
  'id_match_partial',
]

/** Where on the page a value was read from, so a person can be shown the spot. */
export interface OnThePage {
  /** Which page, counting from one. */
  readonly page: number
  /** The box, in pixels measured from the top-left of the rendered page image. */
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/** One value read off a document. */
export interface ExtractedField {
  /** Which field this is: `full_name`, `date_of_birth`, `document_number`, `expiry_date`. */
  readonly name: string
  /** What the service read, exactly as it returned it. */
  readonly value: string
  /** Whether that value can be found in the document, and how well. */
  readonly label: MatchLabel
  /**
   * How sure the reader felt, from 0 to 1, when a score was available at all.
   *
   * Absent means unavailable, not low. Nothing in this project may read an absent
   * score as a bad one.
   */
  readonly confidence?: number
  /** Where on the page it came from, when the service could say. */
  readonly where?: OnThePage
}

/** Everything one document produced. */
export interface ReadDocument {
  /** Whose document this is, spelled as the owner was written down. */
  readonly owner: string
  /** What kind of document it is, in the owner's words. */
  readonly kind: string
  readonly fields: readonly ExtractedField[]
  /** How hard the service was asked to work, recorded so a run cannot be quietly cheaper. */
  readonly depth: string
  /**
   * Whether this was a specimen document rather than a real person's.
   *
   * Charter is a demonstration that strangers can run on the open internet, and
   * asking a stranger to upload a real passport so that a demonstration can read
   * it would be a worse thing than anything this project prevents. So a run uses a
   * document Charter wrote for a made up person, clearly marked on its face.
   *
   * The reading is completely real: a real document goes to a real service, which
   * really reads it and really reports how sure it is. What must never be real is
   * the impression that somebody's identity was involved. So this travels with the
   * result, into the record and onto the screen, and a run that read a made up
   * document can never be mistaken for a run that read somebody's passport.
   *
   * Missing means nobody said, which is treated the same as a specimen. The
   * cautious direction is the one that claims less.
   */
  readonly specimen?: boolean
}

/**
 * The fields an identity document must produce before Charter will treat it as
 * read at all.
 *
 * A document missing one of these has not been read successfully, however
 * confident the service was about the parts it did find.
 */
export const REQUIRED_FIELDS: readonly string[] = [
  'full_name',
  'date_of_birth',
  'document_number',
  'expiry_date',
]
