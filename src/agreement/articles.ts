/**
 * Which articles the agreement contains, what number each one gets, and how one
 * article refers to another.
 *
 * WHAT AN ARTICLE IS
 *
 * An ownership agreement is divided into numbered sections called articles.
 * "Article 5 — Allocation of Profits and Losses" is one. Articles refer to each
 * other constantly: a clause about leaving the company will say "subject to the
 * process in Article 11."
 *
 * WHY THE NUMBERING IS DONE HERE AND NOT BY THE DOCUMENT SERVICE
 *
 * The outside service that builds the document can hide a section. It cannot
 * renumber what is left. Hide Article 7 and the next one is still called Article 8.
 * The document then has no Article 7, and every cross-reference pointing past the
 * gap points at the wrong section.
 *
 * That is not a cosmetic fault. A clause that says "as provided in Article 11" when
 * Article 11 is now the governing-law clause has changed what the sentence means,
 * and it still reads perfectly. So every number and every reference is worked out
 * here and handed to the template already finished.
 *
 * WHY ARTICLES ARE IDENTIFIED BY NAME AND NEVER BY NUMBER
 *
 * Nothing in this file, and nothing that uses it, ever writes "Article 11" as a
 * fixed thing. Articles are identified by a short name that never changes, like
 * `exit-process`. The number is worked out at the end, from what was actually
 * included. This is the whole defence: a reference cannot drift out of step with a
 * number that does not exist until the last moment.
 *
 * WHY A REFERENCE TO AN EXCLUDED ARTICLE IS AN ERROR
 *
 * If a clause refers to an article that was left out, this code refuses to build
 * the document. It does not print a blank, and it does not quietly drop the
 * sentence. A document containing "subject to the process in Article " is obviously
 * broken and somebody fixes it. A document where that sentence silently vanished
 * looks complete and is missing a condition somebody agreed to.
 *
 * WHY BRANCHES COME IN PAIRS
 *
 * The service has no "otherwise". It only has "hide this". So two alternative
 * paragraphs are two separate blocks with two separate conditions, and if both
 * conditions are wrong in the same direction, BOTH paragraphs disappear and the
 * document prints nothing where a term should be. Nothing warns you.
 *
 * A branch here is therefore one question with exactly two answers, and the two
 * hide-conditions are built from that one question so they cannot disagree. A test
 * asserts exactly one side of every branch renders, for every combination of facts.
 */

import type { BasisPoints } from './numbers.js'

/** A short, permanent name for one article. Never a number, never displayed. */
export type ArticleId =
  | 'formation'
  | 'purpose'
  | 'members'
  | 'contributions'
  | 'allocation'
  | 'distributions'
  | 'management'
  | 'voting'
  | 'transfers'
  | 'no-exit'
  | 'exit-process'
  | 'deadlock'
  | 'dissolution'
  | 'records'
  | 'amendment'
  | 'governing-law'

/** What the drafting code is told about the business, in the form it needs. */
export interface AgreementShape {
  /** Every owner's share, in whole basis points. */
  readonly shares: readonly BasisPoints[]
  /** Whether the owners run the company themselves, or appoint a manager. */
  readonly managedBy: 'the owners themselves' | 'an appointed manager'
  /**
   * Whether each owner's agreed share matches their share of what they put in.
   *
   * This drives a real branch, and the reason is a statute rather than a
   * preference. Texas allocates profit and loss by the value of each owner's
   * contribution as stated in the company's records, unless the agreement says
   * otherwise. So when the agreed shares match the contributions, the agreement
   * records that they match. When they do not, the agreement has to say so
   * deliberately and in its own words, because silence hands the question back to
   * the statute and the statute will not produce what the owners agreed.
   */
  readonly sharesFollowContributions: boolean
  /**
   * Whether the owners chose a written process for one of them to leave.
   *
   * Texas says plainly that a member of a limited liability company may not
   * withdraw or be expelled. If the agreement creates no way out, there is no way
   * out, and that is a term of the deal whether anybody meant it or not. So the
   * agreement always says which of the two it is, and never leaves it unsaid.
   */
  readonly hasExitProcess: boolean
}

export interface ArticleDefinition {
  readonly id: ArticleId
  /** The heading a reader sees, without its number. */
  readonly heading: string
  /**
   * Whether this article is in this particular agreement.
   *
   * Most articles are always in. The ones that are not are the ones that record a
   * choice the owners actually made.
   */
  readonly include: (shape: AgreementShape) => boolean
  /**
   * Other articles this one names in its text.
   *
   * Written down so that leaving an article out cannot silently break a sentence
   * somewhere else. If an article is included and something it points at is not,
   * the build stops.
   */
  readonly refersTo?: readonly ArticleId[]
  /** Why this article exists, in plain words. Printed in the pack, not the agreement. */
  readonly why: string
  /**
   * Whether this is one of the articles a person opens the document to read.
   *
   * Most of a company agreement is machinery. Two articles are not: the one saying
   * who owns what, and the one saying who runs it. Anywhere the document is shown
   * a few articles at a time, these are the ones worth showing first.
   *
   * Kept here, with the articles, because it is a judgement about this document. A
   * screen that decided it for itself would be a second opinion about a document it
   * did not write, and would go quietly wrong the moment the articles changed.
   */
  readonly readFirst?: boolean
}

const always = (): boolean => true

/**
 * Every article, in the order they appear. This order is the only place the
 * sequence is written down.
 */
export const ARTICLES: readonly ArticleDefinition[] = [
  {
    id: 'formation',
    heading: 'Formation, Name and Principal Office',
    include: always,
    why: 'Says which company this agreement is about, so it cannot be attached to the wrong one.',
  },
  {
    id: 'purpose',
    heading: 'Purpose',
    include: always,
    why: 'Says what the business does. A purpose stated narrowly can limit what the company may later do, so it is stated broadly unless the owners ask otherwise.',
  },
  {
    id: 'members',
    heading: 'Members and Ownership Interests',
    include: always,
    readFirst: true,
    refersTo: ['contributions'],
    why: 'The list of owners and what share each one holds. This is the article people open the document to read.',
  },
  {
    id: 'contributions',
    heading: 'Capital Contributions',
    include: always,
    why: 'What each owner put in. Texas allocates profit by contribution value as stated in the company records, so this article is the record the statute asks for.',
  },
  {
    id: 'allocation',
    heading: 'Allocation of Profits and Losses',
    include: always,
    refersTo: ['members', 'contributions'],
    why: 'How profit and loss are divided. Either it follows the contributions, or the owners agreed something different and the agreement has to say so in its own words.',
  },
  {
    id: 'distributions',
    heading: 'Distributions',
    include: always,
    refersTo: ['allocation'],
    why: 'When money actually leaves the company and reaches the owners. Being allocated a profit and being paid it are different events, and confusing them is a common and expensive surprise.',
  },
  {
    id: 'management',
    heading: 'Management',
    include: always,
    readFirst: true,
    refersTo: ['voting'],
    why: 'Who runs the company day to day: the owners themselves, or somebody they appoint.',
  },
  {
    id: 'voting',
    heading: 'Voting and Decisions',
    include: always,
    refersTo: ['members'],
    why: 'What fraction of ownership has to agree before a decision carries, and which decisions need more than a simple majority.',
  },
  {
    id: 'transfers',
    heading: 'Transfer of Membership Interests',
    include: always,
    refersTo: ['members'],
    why: 'Whether an owner may hand their share to somebody else, and what that person gets. In Texas a transferee normally receives the money rights without becoming a member who can vote.',
  },
  {
    id: 'no-exit',
    heading: 'No Withdrawal or Expulsion',
    include: (shape) => !shape.hasExitProcess,
    why: 'Texas states that a member may not withdraw or be expelled. When the owners have chosen no way out, the agreement says so plainly rather than leaving people to discover it.',
  },
  {
    id: 'exit-process',
    heading: 'Withdrawal, Purchase and Valuation',
    include: (shape) => shape.hasExitProcess,
    refersTo: ['members', 'transfers'],
    why: 'The written way for an owner to leave and be paid out. It exists only because the owners created it; the statute provides no exit on its own.',
  },
  {
    id: 'deadlock',
    heading: 'Deadlock',
    include: (shape) => canDeadlock(shape.shares),
    refersTo: ['voting'],
    why: 'What happens when the owners cannot outvote each other. Included only when the shares make a tie genuinely possible, because a deadlock clause in a company that cannot deadlock is noise.',
  },
  {
    id: 'dissolution',
    heading: 'Dissolution and Winding Up',
    include: always,
    refersTo: ['distributions'],
    why: 'How the company ends and in what order its money is paid out.',
  },
  {
    id: 'records',
    heading: 'Books, Records and Information',
    include: always,
    why: 'What the company must keep and what an owner is entitled to see. An owner cut off from the records cannot tell whether anything else in this document is being honoured.',
  },
  {
    id: 'amendment',
    heading: 'Amendment',
    include: always,
    refersTo: ['voting'],
    why: 'What it takes to change this agreement later. Without it, the question of who may rewrite the deal is itself unsettled.',
  },
  {
    id: 'governing-law',
    heading: 'Governing Law and Execution',
    include: always,
    why: "Which state's law reads this document, and the record that each person signed it.",
  },
]

/**
 * Can these shares produce a tie?
 *
 * True when some group of owners can hold exactly half. The plain case is two
 * owners at fifty percent each, which is the most common shape a two-person
 * business takes and the one most likely to end badly.
 *
 * Worked out over every combination, which is affordable because agreements have a
 * handful of owners and not a hundred. Done exactly, in whole numbers, because a
 * near-tie and a tie are different situations and a decimal number cannot always
 * tell them apart.
 */
export function canDeadlock(shares: readonly BasisPoints[]): boolean {
  if (shares.length < 2) return false

  let reachable = new Set<bigint>([0n])
  for (const one of shares) {
    const next = new Set<bigint>(reachable)
    for (const running of reachable) next.add(running + one)
    reachable = next
  }

  return reachable.has(5_000n)
}

/** One article, once its number is known. */
export interface NumberedArticle {
  readonly id: ArticleId
  readonly number: number
  readonly heading: string
  /** The heading as it is printed, number and all. */
  readonly fullHeading: string
  readonly why: string
  /**
   * Whether this article is in the document because of something the owners said.
   *
   * Most articles are in every agreement. A few are not: one pair of them is a
   * choice between two, decided by whether the owners have an agreed way for
   * somebody to leave, and one appears only when the shares make a tie possible.
   *
   * Carried here so that anything showing a reader which articles are theirs works
   * it out from the rule that decided it. A list of headings written down a second
   * time somewhere else is a list that can name the wrong articles, and be believed.
   */
  readonly becauseOfAnAnswer: boolean
  /** Whether this is one of the articles a person opens the document to read. */
  readonly readFirst: boolean
}

/** Thrown when the articles cannot be assembled into a document that reads correctly. */
export class BrokenAgreement extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BrokenAgreement'
  }
}

/**
 * Work out which articles are in, number them from one, and check every reference.
 *
 * The check is the point. Numbering is easy; noticing that Article 6 still refers
 * to a clause that was left out is the part a person doing this by hand gets wrong,
 * and the part that produces a document that reads perfectly and means something
 * nobody agreed to.
 */
export function numberArticles(shape: AgreementShape): readonly NumberedArticle[] {
  const included = ARTICLES.filter((article) => article.include(shape))

  if (included.length === 0) {
    throw new BrokenAgreement('No articles were included, so there is no agreement to write.')
  }

  const present = new Set<ArticleId>(included.map((article) => article.id))

  for (const article of included) {
    for (const target of article.refersTo ?? []) {
      if (!present.has(target)) {
        throw new BrokenAgreement(
          `The article "${article.heading}" refers to "${target}", which is not in ` +
            `this agreement. Either include it, or change the text so it does not ` +
            `point at something that is not there. Charter will not print a document ` +
            `with a reference to a missing article, because that document reads as ` +
            `though it is complete.`,
        )
      }
    }
  }

  return included.map((article, index) => {
    const number = index + 1
    return {
      id: article.id,
      number,
      heading: article.heading,
      fullHeading: `ARTICLE ${number} — ${article.heading.toUpperCase()}`,
      why: article.why,
      // Whether this article is in every agreement, or in this one because of
      // something the owners actually said. Worked out from the rule that decides
      // it rather than from a list written somewhere else, so nothing that shows a
      // reader which articles are theirs can ever name the wrong ones.
      becauseOfAnAnswer: article.include !== always,
      readFirst: article.readFirst === true,
    }
  })
}

/**
 * How one article names another in its own text: `Article 11`.
 *
 * Refuses if the article is not in the document. See the note at the top of this
 * file: a broken sentence is fixable, a silently vanished one is not.
 */
export function reference(numbered: readonly NumberedArticle[], id: ArticleId): string {
  const found = numbered.find((article) => article.id === id)
  if (found === undefined) {
    throw new BrokenAgreement(
      `Something refers to the article "${id}", which is not in this agreement. ` +
        `A reference to a missing article is a sentence that has quietly changed ` +
        `meaning, so the document is not built at all.`,
    )
  }
  return `Article ${found.number}`
}
