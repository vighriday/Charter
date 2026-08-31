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
  /**
   * What their contribution is WORTH, in whole cents, written as text.
   *
   * Separate from the words above on purpose. "The delivery van and the ovens" is
   * what a person says; the agreement also needs a figure, because Texas allocates
   * profit and loss by the value of each owner's contribution as stated in the
   * company's records unless the agreement says otherwise. Without a figure there
   * is no record for the statute to read, and the agreement cannot say whether the
   * agreed shares match the contributions or deliberately differ from them.
   *
   * Absent when nobody has valued it yet. The drafting code says so plainly rather
   * than assuming a value.
   */
  readonly contributionCents?: string
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
/**
 * The two either/or terms of the ownership agreement that no default can supply.
 *
 * Everything else in an agreement has a sensible standard form. These two do not,
 * because each one is a choice about how these particular people want to live with
 * each other, and getting either one wrong by default is worse than not drafting.
 *
 * They are separate from the rest of the facts because they are the only questions
 * whose answer a person must give directly. Charter asks. It does not guess.
 */
export interface AgreementChoices {
  /**
   * Who runs the company day to day.
   *
   * Absent until somebody says. There is no safe default: assuming the owners run
   * it themselves gives every owner authority to bind the company, and assuming a
   * manager takes that authority away from all of them.
   */
  readonly managedBy?: 'the owners themselves' | 'an appointed manager'
  /**
   * Whether the owners wrote a way for one of them to leave and be paid out.
   *
   * Absent until somebody says, and this is the most consequential blank in the
   * whole document. Texas states that a member of a limited liability company may
   * not withdraw or be expelled. If the agreement creates no exit, there is no
   * exit — not a hard one, none — and that is a term of the deal whether or not
   * anybody meant to agree to it.
   *
   * So Charter never fills this in. It asks, and it says what each answer means.
   */
  readonly hasExitProcess?: boolean
}

/** A question that was put to a person, and what they said back. */
export interface AnsweredQuestion {
  readonly question: string
  readonly answer: string
}

/**
 * What came of reading one owner's identity document.
 *
 * The list of fields waiting for a person is kept, not just a count. A count tells
 * somebody there is work; the list tells them what the work is, and a person who
 * has to open a second screen to find out is a person who checks less carefully.
 */
/**
 * One address record, as it was sent to the registrar or read back from it.
 *
 * Both halves are kept. Without both, "the registrar has what we sent" is a claim
 * rather than a comparison.
 */
export interface WrittenRecord {
  readonly host: string
  readonly kind: string
  readonly answer: string
  readonly ttl: string
}

/** The picture drawn for the new business's website, and the words that drew it. */
export interface DrawnStorefront {
  readonly url: string
  readonly shape: string
  /** The owners' own words, kept whole so the picture can be checked against them. */
  readonly fromWords: string
  readonly drawnBy: string
}

export interface IdentityCheck {
  readonly owner: string
  /** How many values were read off the document. */
  readonly fieldsRead: string
  /** The fields a person must look at, by name. */
  readonly toReview: readonly string[]
  /**
   * The fields a person has actually looked at and answered on, by name.
   *
   * Kept separately from `toReview` rather than worked out by subtracting one list
   * from the other. A value a person looked at and said was WRONG leaves neither
   * list, and the finished pack has to be able to say "a person checked this"
   * about a value that is still waiting.
   */
  readonly checkedByAPerson: readonly string[]
  /** Required fields the document did not produce at all. */
  readonly missing: readonly string[]
  /** How hard the reading service was asked to work, recorded with the result. */
  readonly depth: string
}

/**
 * The finished pack, as the record holds it.
 *
 * The fingerprint is of the bytes at the moment of sealing. Nothing that rewrites
 * the file runs afterwards, which is what makes the fingerprint mean something: a
 * fingerprint of a file that can still be rewritten proves only what the file used
 * to be.
 */
export interface SealedPackRecord {
  readonly fingerprint: string
  readonly sizeBytes: string
  /** What Charter was asked to do after sealing and would not, with the reason. */
  readonly refusedAfterSealing: readonly string[]
}

/**
 * A person's approval to carry the finished pack to the owners to sign.
 *
 * This is not a signature and never becomes one. It is one person saying "yes,
 * send this out." The owners then sign it themselves, in their own browsers, and
 * nothing in Charter does that for them.
 */
export interface ApprovalToSend {
  /** Who approved, in their own words. */
  readonly approvedBy: string
  /** The fingerprint of the pack they were looking at when they approved. */
  readonly packFingerprint: string
  readonly approvedAt: string
}

/** The website, once it is up. */
export interface PublishedSite {
  readonly address: string
  readonly liveAt: string
}

/** What came out of preparing the ownership agreement. */
export interface DraftedAgreement {
  /** How many articles the finished document has. */
  readonly articleCount: string
  /** The blocks that survived, so the version of each either/or term is on the record. */
  readonly blocks: readonly string[]
  /** One line per decision the drafting made, in plain words. */
  readonly explanation: readonly string[]
  /** The day the document is dated, as year-month-day. */
  readonly dated: string
}

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
  /** The two either/or terms of the agreement that a person has to answer. */
  readonly agreementChoices?: AgreementChoices
  /** The agreement, once it has been prepared. */
  readonly agreement?: DraftedAgreement
  /** What came of reading each owner's identity document. */
  readonly identityChecks: readonly IdentityCheck[]
  /** The address records written for the registered address, exactly as sent. */
  readonly addressRecords: readonly WrittenRecord[]
  /** What the registrar handed back when those records were read back from it. */
  readonly addressRecordsHeld: readonly WrittenRecord[]
  /** The picture drawn for the new business's website, if one was drawn. */
  readonly storefront?: DrawnStorefront
  /** The finished pack, once it has been sealed. */
  readonly pack?: SealedPackRecord
  /**
   * A person's approval to carry the pack to the owners to sign.
   *
   * Written only by the code a person's browser reaches, which nothing the model
   * can trigger is able to call. That is checked by following every import in the
   * project, not by anybody remembering.
   */
  readonly approvalToSend?: ApprovalToSend
  /** The published website, once it is up. */
  readonly site?: PublishedSite
  /**
   * Every question a person has actually answered, kept with its answer.
   *
   * Open questions alone are not enough. Two terms of the ownership agreement may
   * only be written down if a person was asked about them and replied, and that
   * rule cannot be checked against a list of questions still outstanding.
   */
  readonly answers: readonly AnsweredQuestion[]
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
  return {
    caseId,
    owners: [],
    openQuestions: [],
    answers: [],
    identityChecks: [],
    addressRecords: [],
    addressRecordsHeld: [],
  }
}
