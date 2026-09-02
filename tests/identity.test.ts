/**
 * Proving that the decision to send an identity value to a person is made by code
 * and only by code, and that it is made on evidence rather than on a feeling.
 *
 * WHAT IS BEING DECIDED HERE
 *
 * Charter asks each owner for an identity document. An outside service reads the
 * fields off it. Some of what comes back will be wrong, and something has to
 * decide which values a person must check before anything is built on them.
 *
 * THE TWO SIGNALS, AND WHY THE ORDER MATTERS
 *
 * The reading service returns two different things per field, and they are not the
 * same kind of thing.
 *
 * A **match label** says whether the value can actually be found in the source
 * document. That is evidence. Anybody can open the document and check it.
 *
 * A **confidence score** says how sure the reader felt. The service states in its
 * own guide that this number "is relative and uncalibrated; it isn't a probability
 * or percentage", and that an absent score means no score was available rather
 * than a low one.
 *
 * Routing on the number is the obvious thing to build. For a project whose whole
 * argument is *check it yourself*, routing on the one signal nobody can check
 * would be the wrong choice made loudly. So the label is tested first and the
 * score is tested last, and the tests below fix that order in place.
 */

import { describe, expect, it } from 'vitest'
import {
  LABELS_NEEDING_A_PERSON,
  LABEL_MEANING,
  REQUIRED_FIELDS,
  type ExtractedField,
  type MatchLabel,
  type ReadDocument,
} from '../src/identity/fields.js'
import {
  DEFAULT_SCORE_FLOOR,
  explain,
  namesAgree,
  reviewDocument,
  reviewField,
  type ReviewSettings,
} from '../src/identity/review.js'

const settings = (over: Partial<ReviewSettings> = {}): ReviewSettings => ({
  givenName: 'Ana Rivera',
  today: '2026-08-29',
  ...over,
})

const field = (over: Partial<ExtractedField> = {}): ExtractedField => ({
  name: 'document_number',
  value: 'X1234567',
  label: 'id_match',
  confidence: 0.97,
  ...over,
})

const reasonsFor = (one: ExtractedField, over: Partial<ReviewSettings> = {}): readonly string[] =>
  reviewField(one, settings(over)).reasons.map((reason) => reason.kind)

// ─────────────────────────────────────────────────────────────────────────────
// The first test: can the value be found in the document at all?
// ─────────────────────────────────────────────────────────────────────────────

describe('routing on whether the value is in the document', () => {
  it('sends a value that could not be found at all to a person', () => {
    expect(reasonsFor(field({ label: 'not_found' }))).toContain('not-grounded')
  })

  it('sends an approximate match to a person', () => {
    expect(reasonsFor(field({ label: 'fuzzy_match' }))).toContain('not-grounded')
  })

  it('sends a partly resolved match to a person', () => {
    expect(reasonsFor(field({ label: 'id_match_partial' }))).toContain('not-grounded')
  })

  it('lets an exact match through, and one assembled from several places', () => {
    // These two are the only labels that mean the value is genuinely located in
    // the document. A passport that prints a name across two lines produces the
    // second one, and it is not a problem.
    expect(reasonsFor(field({ label: 'id_match' }))).toEqual([])
    expect(reasonsFor(field({ label: 'id_match_multiblock' }))).toEqual([])
  })

  it('routes on the label even when the reader was extremely confident', () => {
    // This is the whole point of the ordering. A value the reader felt sure about
    // and cannot point to in the document is exactly the case that must not pass,
    // and a rule that tested the number first would let it through.
    const sure = field({ label: 'not_found', confidence: 0.99 })
    expect(reviewField(sure, settings()).needsAPerson).toBe(true)
    expect(reasonsFor(sure)).toContain('not-grounded')
  })

  it('keeps the service’s own words for each label, so two records can be compared', () => {
    for (const label of Object.keys(LABEL_MEANING) as MatchLabel[]) {
      expect(LABEL_MEANING[label].length).toBeGreaterThan(10)
    }
    expect(LABELS_NEEDING_A_PERSON).toEqual(['not_found', 'fuzzy_match', 'id_match_partial'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The last test: the score, and only if there is one
// ─────────────────────────────────────────────────────────────────────────────

describe('the confidence score, tested last and trusted least', () => {
  it('sends a value below the floor to a person', () => {
    expect(reasonsFor(field({ confidence: 0.4 }))).toContain('below-the-floor')
  })

  it('does not treat a missing score as a low one', () => {
    // The service says plainly that an absent score means no score was available.
    // A value with no score still goes to a person, and the reason it gives is a
    // different reason with a different sentence behind it.
    const noScore = field()
    delete (noScore as { confidence?: number }).confidence

    const reasons = reasonsFor(noScore)
    expect(reasons).toContain('no-score-available')
    expect(reasons).not.toContain('below-the-floor')
  })

  it('says out loud that a missing score is not evidence of anything wrong', () => {
    const said = explain({ kind: 'no-score-available' })
    expect(said).toMatch(/not that the score was low/)
  })

  it('says, when it does use the number, that this is the weakest test', () => {
    const said = explain({ kind: 'below-the-floor', score: 0.62, floor: 0.85 })
    expect(said).toMatch(/uncalibrated/)
  })

  it('starts from a high floor, because too much review is the safe direction', () => {
    expect(DEFAULT_SCORE_FLOOR).toBeGreaterThanOrEqual(0.85)
  })

  it('uses a calibrated floor when one has been worked out', () => {
    expect(reasonsFor(field({ confidence: 0.7 }), { scoreFloor: 0.6 })).not.toContain(
      'below-the-floor',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Checks that need no service at all
// ─────────────────────────────────────────────────────────────────────────────

describe('format and consistency, checked without asking anybody', () => {
  it('refuses a date of birth that is not a date', () => {
    expect(reasonsFor(field({ name: 'date_of_birth', value: '30 Feb 1988' }))).toContain(
      'not-a-date',
    )
  })

  it('knows which years February has twenty-nine days', () => {
    // 2000 is a leap year and 1900 was not. The short version of the rule gets
    // one of those wrong, and will get 2100 wrong too.
    expect(reasonsFor(field({ name: 'date_of_birth', value: '2000-02-29' }))).toEqual([])
    expect(reasonsFor(field({ name: 'date_of_birth', value: '1900-02-29' }))).toContain(
      'not-a-date',
    )
    expect(reasonsFor(field({ name: 'date_of_birth', value: '2026-02-29' }))).toContain(
      'not-a-date',
    )
  })

  it('sends an expired document to a person, and says when it expired', () => {
    const reasons = reviewField(
      field({ name: 'expiry_date', value: '2020-01-01' }),
      settings(),
    ).reasons
    expect(reasons.map((one) => one.kind)).toContain('expired')
    expect(explain(reasons.find((one) => one.kind === 'expired') as never)).toMatch(/2020-01-01/)
  })

  it('lets a document that is still valid through', () => {
    expect(reasonsFor(field({ name: 'expiry_date', value: '2030-01-01' }))).toEqual([])
  })

  it('accepts a fuller name on the document than the one the owners gave', () => {
    // A passport carries middle names and a conversation does not. Sending this
    // to a person every time would make the review queue useless.
    expect(namesAgree('ANA MARIA RIVERA', 'Ana Rivera')).toBe(true)
    expect(namesAgree('Ana Rivera', 'Ana Rivera')).toBe(true)
  })

  it('folds accents and punctuation before comparing', () => {
    expect(namesAgree('ANA RIVERA-GÓMEZ', 'Ana Gomez Rivera')).toBe(true)
    expect(namesAgree("Ana O'Rivera", 'Ana ORivera')).toBe(false)
  })

  it('never lets a different person through', () => {
    expect(namesAgree('Ben Rivera', 'Ana Rivera')).toBe(false)
    expect(namesAgree('Ana Rivera', 'Ana Maria Rivera')).toBe(false)
    expect(namesAgree('', 'Ana Rivera')).toBe(false)
  })

  it('sends a name that does not match to a person, showing both spellings', () => {
    const reasons = reviewField(
      field({ name: 'full_name', value: 'Ben Rivera' }),
      settings(),
    ).reasons
    const mismatch = reasons.find((one) => one.kind === 'name-does-not-match')
    expect(mismatch).toBeDefined()
    expect(explain(mismatch as never)).toMatch(/Ben Rivera.*Ana Rivera/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Every reason, kept, because they are different problems
// ─────────────────────────────────────────────────────────────────────────────

describe('telling a reviewer what is actually wrong', () => {
  it('collects every reason rather than stopping at the first', () => {
    // A person told only "low confidence" checks the wrong thing when the real
    // problem is that the value is not in the document at all.
    const bad = field({
      name: 'expiry_date',
      value: '2019-13-45',
      label: 'fuzzy_match',
      confidence: 0.2,
    })
    const reasons = reasonsFor(bad)

    expect(reasons).toContain('not-grounded')
    expect(reasons).toContain('not-a-date')
    expect(reasons).toContain('below-the-floor')
  })

  it('writes every kind of reason as a sentence a person can act on', () => {
    const all = [
      { kind: 'not-grounded', label: 'not_found', meaning: LABEL_MEANING.not_found },
      { kind: 'required-field-missing', field: 'date_of_birth' },
      { kind: 'no-score-available' },
      { kind: 'below-the-floor', score: 0.6, floor: 0.85 },
      { kind: 'not-a-date', value: 'nonsense', why: '"nonsense" is not written like a date' },
      {
        kind: 'date-could-be-two-days',
        value: '03/09/2026',
        why: '"03/09/2026" is written all in numbers, so it could be two different days.',
      },
      { kind: 'expired', on: '2020-01-01', checkedOn: '2026-08-29' },
      { kind: 'name-does-not-match', onDocument: 'Ben', given: 'Ana' },
    ] as const

    for (const reason of all) {
      const said = explain(reason)
      expect(said.length).toBeGreaterThan(20)
      expect(said).not.toContain('undefined')
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// A whole document
// ─────────────────────────────────────────────────────────────────────────────

const document = (fields: readonly ExtractedField[]): ReadDocument => ({
  owner: 'Ana Rivera',
  kind: 'passport',
  depth: 'understand',
  fields,
})

const clean: readonly ExtractedField[] = [
  { name: 'full_name', value: 'ANA MARIA RIVERA', label: 'id_match', confidence: 0.98 },
  { name: 'date_of_birth', value: '1988-04-12', label: 'id_match', confidence: 0.97 },
  { name: 'document_number', value: 'X1234567', label: 'id_match', confidence: 0.99 },
  { name: 'expiry_date', value: '2031-04-11', label: 'id_match', confidence: 0.96 },
]

describe('reviewing a whole document', () => {
  it('passes a document where every value is grounded and every check holds', () => {
    const review = reviewDocument(document(clean), settings())
    expect(review.needsAPerson).toBe(false)
    expect(review.toReview).toEqual([])
    expect(review.missing).toEqual([])
  })

  it('does not let a required field be silently absent', () => {
    // "The reader returned nothing for the date of birth" and "the reader returned
    // a date of birth we are happy with" must never look the same from outside.
    const partial = clean.filter((one) => one.name !== 'date_of_birth')
    const review = reviewDocument(document(partial), settings())

    expect(review.missing).toEqual(['date_of_birth'])
    expect(review.toReview).toContain('date_of_birth')
    expect(review.needsAPerson).toBe(true)
  })

  it('names every field waiting on a person, not just how many', () => {
    const messy = [
      ...clean.filter((one) => one.name !== 'document_number'),
      { name: 'document_number', value: 'X1234567', label: 'fuzzy_match' as MatchLabel, confidence: 0.4 },
    ]
    const review = reviewDocument(document(messy), settings())
    expect(review.toReview).toEqual(['document_number'])
  })

  it('keeps the list of required fields somewhere a person can read it', () => {
    expect(REQUIRED_FIELDS).toContain('full_name')
    expect(REQUIRED_FIELDS).toContain('date_of_birth')
    expect(REQUIRED_FIELDS).toContain('document_number')
    expect(REQUIRED_FIELDS).toContain('expiry_date')
  })

  it('gives the same answer every time, because today is passed in', () => {
    // A document that expires tomorrow must not pass on one run and fail on the
    // next because a clock moved. A run anybody can repeat is the whole basis for
    // anybody being able to check this project's work.
    const first = reviewDocument(document(clean), settings({ today: '2031-04-10' }))
    const second = reviewDocument(document(clean), settings({ today: '2031-04-12' }))

    expect(first.needsAPerson).toBe(false)
    expect(second.needsAPerson).toBe(true)
    expect(second.toReview).toEqual(['expiry_date'])
  })
})
