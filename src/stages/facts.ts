/**
 * What Charter knows about one case, so far.
 *
 * WHAT A CASE IS
 *
 * One business being prepared. A person describes what they want to build,
 * Charter works through eight stages, and at the end there is a pack of documents
 * for the owners to sign themselves.
 *
 * WHY THIS IS ONE PLAIN VALUE AND NOT AN OBJECT WITH BEHAVIOUR
 *
 * These facts are never the original. The original is the record — the
 * append-only list of everything that happened, where each entry carries the
 * fingerprint of the one before it. This is that list read forward and folded into
 * a summary, rebuilt from scratch whenever it is needed.
 *
 * That is what makes a run resumable. A browser tab closing, a machine restarting,
 * a crash halfway through stage three: none of them lose anything, because nothing
 * was being held anywhere. The record is on disk and the summary is a few
 * milliseconds of work away.
 *
 * It also means these facts cannot drift from the record. There is no second place
 * where the truth is kept, so there is no possibility of the two disagreeing.
 *
 * WHY EVERY NUMBER IS TEXT
 *
 * Everything here that could be written as a number is written as text instead —
 * amounts of money, counts, ownership shares. This is the same rule the record
 * uses, and it exists because of a real bug found while building it: a check meant
 * for the text "1" quietly accepted the number 1. The two produce different
 * fingerprints, so a record holding one and a summary holding the other cannot be
 * checked against each other. One rule everywhere is cheaper than remembering
 * which side of a boundary you are on.
 *
 * Money is written in whole cents, as text, for the same reason arithmetic on
 * money is never done in fractions: 0.1 plus 0.2 is not 0.3 in binary, and a
 * document that allocates ownership must not be built on that.
 */

/** One of the people who will own the business. */
export interface Owner {
  readonly name: string
  /** What they are putting in, in the person's own words. */
  readonly contribution: string
  /** Their share as a percentage, written as text: `'60'`, not 60. */
  readonly sharePercent?: string
}

/**
 * Permission to spend, given by a person, up to a stated amount.
 *
 * WHY THIS EXISTS AT ALL
 *
 * Registering a web address costs real money and cannot be undone. The obvious
 * objection to Charter's whole argument is: *your agent cannot sign, but it can
 * spend?* This is the answer, and it is a real distinction rather than a dodge.
 *
 * A person may genuinely authorise someone to spend on their behalf up to a
 * limit — that is ordinary agency, recognised in commercial law for centuries. No
 * person can authorise anyone to *agree* on their behalf to be legally bound,
 * because agreement is an act of will and a machine has none.
 *
 * So money is delegable within stated limits. Consent to be bound is not
 * delegable at any limit. Two tiers of irreversibility, and they differ in kind.
 */
export interface SpendAuthorisation {
  /** The most that may be spent under this permission, in whole cents, as text. */
  readonly limitCents: string
  /** What it covers, in the words shown to the person who granted it. */
  readonly forWhat: string
  /** When it was granted, as `2026-08-28T10:00:00.000Z`. */
  readonly grantedAt: string
  /** Already spent under this permission, in whole cents, as text. */
  readonly spentCents: string
}

/** One live search performed while checking whether a name is already taken. */
export interface SearchPerformed {
  readonly query: string
  /** How many results came back, as text. */
  readonly resultCount: string
  /** Which service answered. Recorded, but never shown to the model. */
  readonly answeredBy: string
}

/** A business found that might be the same name as the one being proposed. */
export interface PossibleCollision {
  readonly foundName: string
  readonly where: string
  /** How close, decided in plain code. `'exact'`, `'same-after-tidying'`, `'close'`. */
  readonly closeness: 'exact' | 'same-after-tidying' | 'close' | 'different'
  /** The tidied forms actually compared, so the decision can be checked by hand. */
  readonly comparedAs: { readonly proposed: string; readonly found: string }
}

export interface NameResearch {
  readonly searches: readonly SearchPerformed[]
  readonly collisions: readonly PossibleCollision[]
  /**
   * Decided in plain code from the collisions above, never by the model.
   *
   * Absent until a comparison has actually been made. "Searches have been run but
   * nothing has been compared yet" and "compared, and a person needs to look" are
   * different states, and a first version of this folded them together — which
   * made a run stop and wait for a person before there was anything to look at.
   */
  readonly verdict?: 'clear' | 'collides' | 'needs-a-person'
}

export interface AddressWork {
  readonly candidate: string
  readonly available?: boolean
  /** In whole cents, as text. Absent until a price has been quoted. */
  readonly priceCents?: string
  readonly registered?: boolean
}

/**
 * Everything known about a case, folded from its record.
 *
 * Almost every field is optional, because a case begins knowing nothing and each
 * stage adds what it learns. Whether enough is known to move on is decided by each
 * stage's own rule in `stages.ts`, in code, and never by the model.
 */
export interface CaseFacts {
  readonly caseId: string
  /** What the person typed, in their own words, unedited. */
  readonly description?: string
  /** Two letters, as the state writes them: `'TX'`. */
  readonly state?: string
  readonly proposedName?: string
  readonly owners: readonly Owner[]
  /**
   * A request to spend that the agent made and nobody has granted yet.
   *
   * Tracked separately from the permission itself, because the two are the whole
   * distinction: the agent can produce this, and only a person can produce the
   * other. While this is set and no permission exists, the case is waiting on a
   * person, and asking the model again would spend a request to learn nothing.
   */
  readonly spendRequested?: { readonly limitCents: string; readonly forWhat: string }
  readonly spendAuthorisation?: SpendAuthorisation
  readonly nameResearch?: NameResearch
  readonly address?: AddressWork
  /**
   * Questions the agent asked that have not been answered yet.
   *
   * Stage one cannot finish while any of these are open, which is what stops it
   * from deciding it has heard enough while a question is still on the screen.
   */
  readonly openQuestions: readonly string[]
}

/** A case that has just begun: an identifier and nothing else. */
export function emptyCase(caseId: string): CaseFacts {
  return { caseId, owners: [], openQuestions: [] }
}
