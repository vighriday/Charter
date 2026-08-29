/**
 * Deciding which values read off an identity document have to be looked at by a
 * person.
 *
 * WHAT THIS FILE IS
 *
 * Charter asks each owner for an identity document and an outside service reads
 * the fields off it. Some of what comes back will be wrong. This file decides
 * which values a person must check before anything is built on them.
 *
 * THE ONE THING TO KNOW ABOUT THIS FILE
 *
 * **No model takes any part in this decision.** Not a suggestion, not a first
 * pass, not a tiebreak. The rule is a fixed comparison written below, and the only
 * inputs are what the reading service returned and what the owners already told us.
 *
 * That is not caution for its own sake. It removes a failure mode completely and
 * costs nothing: a rule made of comparisons cannot be talked into a different
 * answer, cannot drift between runs, and produces the same result on a judge's
 * machine as on ours. It also keeps a real person's identity details away from
 * anything that learns from what it is shown.
 *
 * THE ORDER OF THE TESTS IS THE DESIGN
 *
 * The reading service returns two different signals per field.
 *
 * A **match label** says whether the value it returned can actually be found in
 * the source document. That is evidence, and anybody can open the document and
 * check it.
 *
 * A **confidence score** says how sure the reader felt. The service states in its
 * own guide that this number "is relative and uncalibrated; it isn't a probability
 * or percentage."
 *
 * So the label is tested first and the score is tested last. Their own written
 * recommendation puts them in that order too. Routing on the number would have
 * been the obvious thing to build, and for a project whose whole argument is
 * *check it yourself*, routing on the one signal nobody can check would have been
 * the wrong choice made loudly.
 *
 * WHY THE RULE MAY ONLY ERR IN ONE DIRECTION
 *
 * Every rule here sends work TO a person. Nothing here takes work away from one.
 * If a test is uncertain, the answer is always "a person looks", because a person
 * looking at something that turns out fine costs a minute, and a wrong value
 * passing unseen ends up in a legal document.
 */

import {
  type ExtractedField,
  type MatchLabel,
  type ReadDocument,
  LABELS_NEEDING_A_PERSON,
  LABEL_MEANING,
  REQUIRED_FIELDS,
} from './fields.js'

/**
 * The confidence score below which a field goes to a person, when a score exists.
 *
 * This is the LAST test, not the first, and the number is close to meaningless on
 * its own. The service says its score is uncalibrated, and tells callers to
 * calibrate a threshold against their own sample rather than pick one. Until that
 * sample exists, the honest setting is a high one, because sending too much to a
 * person is the safe direction and sending too little is not.
 */
export const DEFAULT_SCORE_FLOOR = 0.85

/** Why one value has to be looked at. Each reason is a different problem. */
export type ReviewReason =
  | { readonly kind: 'not-grounded'; readonly label: MatchLabel; readonly meaning: string }
  | { readonly kind: 'required-field-missing'; readonly field: string }
  | { readonly kind: 'no-score-available' }
  | { readonly kind: 'below-the-floor'; readonly score: number; readonly floor: number }
  | { readonly kind: 'not-a-date'; readonly value: string }
  | { readonly kind: 'expired'; readonly on: string; readonly checkedOn: string }
  | { readonly kind: 'name-does-not-match'; readonly onDocument: string; readonly given: string }

/** One field, and whether it needs a person. */
export interface FieldReview {
  readonly field: string
  readonly value: string
  readonly label: MatchLabel
  /** Empty when the value passed every test. */
  readonly reasons: readonly ReviewReason[]
  readonly needsAPerson: boolean
}

/** The whole document, reviewed. */
export interface DocumentReview {
  readonly owner: string
  readonly fields: readonly FieldReview[]
  /** Fields a person must check. */
  readonly toReview: readonly string[]
  /** Required fields the document did not produce at all. */
  readonly missing: readonly string[]
  readonly needsAPerson: boolean
}

/** Turn one reason into the sentence a reviewer reads. */
export function explain(reason: ReviewReason): string {
  switch (reason.kind) {
    case 'not-grounded':
      return `The value ${reason.meaning}.`
    case 'required-field-missing':
      return `The document did not produce a ${reason.field.replace(/_/g, ' ')} at all.`
    case 'no-score-available':
      return 'No confidence score came back for this value. That means no score was available, not that the score was low — so this is here to be looked at rather than because anything is known to be wrong.'
    case 'below-the-floor':
      return `The reader's own confidence was ${reason.score}, below the floor of ${reason.floor}. This is the last test applied, and the weakest, because the service says the score is uncalibrated.`
    case 'not-a-date':
      return `"${reason.value}" is not a date that can be read.`
    case 'expired':
      return `The document expired on ${reason.on}, which is before ${reason.checkedOn}.`
    case 'name-does-not-match':
      return `The document says "${reason.onDocument}" and the owner was written down as "${reason.given}".`
  }
}

/** Whether text is a real year-month-day date. Written out, so no locale is involved. */
function readableDate(value: string): { readonly ok: boolean } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return { ok: false }

  const [year, month, day] = value.split('-').map(Number) as [number, number, number]
  if (month < 1 || month > 12 || day < 1) return { ok: false }

  // Days in each month, with February corrected for leap years the full way: a
  // year divisible by four is a leap year, except centuries, except every fourth
  // century. The short version of this rule was wrong in 1900 and will be wrong
  // again in 2100.
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return { ok: day <= (lengths[month - 1] as number) }
}

/**
 * Loosen two names enough to compare them fairly, and no further.
 *
 * A document that says "ANA MARIA RIVERA" and an owner written down as "Ana Rivera"
 * are the same person, and sending that to a person every single time would make
 * the review queue useless. A document that says "Ana Rivera" against an owner
 * called "Ben Rivera" is not, and must never pass.
 *
 * So: fold accents, drop punctuation, lowercase, and compare the sets of name
 * parts. Every part the owner gave must appear on the document. Extra parts on the
 * document are allowed, because middle names appear on passports and not in
 * conversation. Extra parts the owner gave are NOT allowed, because a name the
 * document does not carry is a difference somebody should see.
 */
export function namesAgree(onDocument: string, given: string): boolean {
  const parts = (value: string): readonly string[] =>
    value
      .normalize('NFD')
      // Written as escapes rather than as the characters themselves. These are
      // combining accent marks, which are invisible in an editor, and a range
      // typed literally is a range nobody can review.
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((one) => one.length > 0)

  const onDoc = new Set(parts(onDocument))
  const wanted = parts(given)

  return wanted.length > 0 && wanted.every((one) => onDoc.has(one))
}

/** What the review needs to know beyond the document itself. */
export interface ReviewSettings {
  /** The name the owners gave for this person, back in stage one. */
  readonly givenName: string
  /** Today, as year-month-day. Passed in so a run can be repeated exactly. */
  readonly today: string
  /** The score floor, when one has been calibrated. */
  readonly scoreFloor?: number
}

/**
 * Review one field. Every test that fires adds a reason; none of them cancel each
 * other out.
 *
 * Collecting every reason rather than stopping at the first is deliberate. A
 * person told only "low confidence" checks the wrong thing when the real problem
 * is that the value is not in the document at all. Handing somebody "0.62" and
 * handing them "this could not be found anywhere in the document" are not the
 * same act.
 */
export function reviewField(field: ExtractedField, settings: ReviewSettings): FieldReview {
  const reasons: ReviewReason[] = []

  // ---- first test: can this value be found in the document? -----------------
  if (LABELS_NEEDING_A_PERSON.includes(field.label)) {
    reasons.push({
      kind: 'not-grounded',
      label: field.label,
      meaning: LABEL_MEANING[field.label],
    })
  }

  // ---- format and consistency, which need no service at all ------------------
  if (field.name === 'date_of_birth' || field.name === 'expiry_date') {
    if (!readableDate(field.value).ok) {
      reasons.push({ kind: 'not-a-date', value: field.value })
    } else if (field.name === 'expiry_date' && field.value < settings.today) {
      // Both are year-month-day, so comparing them as text compares them as dates.
      reasons.push({ kind: 'expired', on: field.value, checkedOn: settings.today })
    }
  }

  if (field.name === 'full_name' && !namesAgree(field.value, settings.givenName)) {
    reasons.push({
      kind: 'name-does-not-match',
      onDocument: field.value,
      given: settings.givenName,
    })
  }

  // ---- last test: the score, and only if there is one ------------------------
  const floor = settings.scoreFloor ?? DEFAULT_SCORE_FLOOR
  if (field.confidence === undefined) {
    // Absent means unavailable, not low. Said in the service's own guide. So this
    // reason exists separately from "below the floor" and reads differently.
    reasons.push({ kind: 'no-score-available' })
  } else if (field.confidence < floor) {
    reasons.push({ kind: 'below-the-floor', score: field.confidence, floor })
  }

  return {
    field: field.name,
    value: field.value,
    label: field.label,
    reasons,
    needsAPerson: reasons.length > 0,
  }
}

/**
 * Review a whole document.
 *
 * A required field the service never produced is not silently absent. It is added
 * to the review as a missing field, because "the reader returned nothing for the
 * date of birth" and "the reader returned a date of birth we are happy with" must
 * never look the same from the outside.
 */
export function reviewDocument(document: ReadDocument, settings: ReviewSettings): DocumentReview {
  const fields = document.fields.map((field) => reviewField(field, settings))
  const produced = new Set(document.fields.map((field) => field.name))
  const missing = REQUIRED_FIELDS.filter((name) => !produced.has(name))

  const withMissing: FieldReview[] = [
    ...fields,
    ...missing.map((name) => ({
      field: name,
      value: '',
      label: 'not_found' as MatchLabel,
      reasons: [{ kind: 'required-field-missing' as const, field: name }],
      needsAPerson: true,
    })),
  ]

  const toReview = withMissing.filter((one) => one.needsAPerson).map((one) => one.field)

  return {
    owner: document.owner,
    fields: withMissing,
    toReview,
    missing,
    needsAPerson: toReview.length > 0,
  }
}
