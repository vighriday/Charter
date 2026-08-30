/**
 * Turn what we know about a business into the finished set of values the document
 * template needs, with nothing left for the template to work out.
 *
 * WHAT THIS FILE IS
 *
 * Charter collects facts about a business in ordinary language: who the owners
 * are, what each put in, what share each holds. The ownership agreement is built
 * from a template by an outside service, and that service can only join text
 * together. It cannot add up, cannot renumber, cannot write a number as a word,
 * cannot format money, and reads dates differently depending on where the reader
 * is — failing silently when it gets one it cannot read.
 *
 * So everything is finished here. What leaves this file is a plain list of names
 * and already-formatted values. The template does no thinking at all, which is
 * exactly how much thinking a template should do.
 *
 * WHY IT REFUSES INSTEAD OF FILLING GAPS
 *
 * When something needed is missing or does not add up, this stops and says what is
 * missing. It never invents a share, never spreads a rounding difference, and never
 * assumes an owner meant a round number.
 *
 * The reason is the document. Every other program in this project can afford a
 * sensible default, because a sensible default that turns out wrong can be changed.
 * This one produces a document that people sign, and a term that a program chose on
 * their behalf is a term nobody agreed to. Refusing is slower and it is the only
 * honest option.
 *
 * WHAT THIS FILE DOES NOT DO
 *
 * It does not decide anything about the business. Every choice it acts on was made
 * by the owners and recorded before this ran. It does not ask a model anything, and
 * no model can reach it: the words in the agreement come from a template a person
 * wrote and can read, and the numbers come from arithmetic anybody can check.
 */

import type { CaseFacts, Owner } from '../stages/facts.js'
import {
  type AgreementShape,
  type NumberedArticle,
  BrokenAgreement,
  numberArticles,
  reference,
} from './articles.js'
import { type BlockDecision, assertExactlyOnePerBranch, decideBranches } from './branches.js'
import {
  type BasisPoints,
  UnusableNumber,
  asMoney,
  asOrdinal,
  asPercent,
  asWrittenDate,
  inWordsAndFigures,
  mustTotalWhole,
  share,
  shareOfContributions,
  moreThan,
  atLeast,
  carries,
  type VoteRule,
  WHOLE,
} from './numbers.js'

/** Thrown when the facts are not yet enough to write an agreement. */
export class NotEnoughToDraft extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotEnoughToDraft'
  }
}

/** One owner, with every value already in the form the document prints. */
export interface OwnerRow {
  /** Their position in the document, from one. */
  readonly position: number
  /** `First`, `Second`, and so on — used for signature blocks. */
  readonly ordinal: string
  readonly fullName: string
  /** What they put in, in their own words. */
  readonly contribution: string
  /** What it is worth, already formatted: `$25,000.00`. */
  readonly contributionValue: string
  /** Their agreed share, already formatted: `60%`. */
  readonly agreedShare: string
  /** The share they would hold if shares followed contributions exactly: `55.55%`. */
  readonly shareOfContributions: string
  /** Whether those two are the same figure. */
  readonly agreedMatchesContribution: boolean
}

/** Everything the template is given. Nothing else is sent, and nothing is computed there. */
export interface AgreementData {
  readonly companyName: string
  readonly state: string
  /** `3 September 2026`, already written out so no reader can mistake the order. */
  readonly agreementDate: string
  readonly ownerCount: string
  /** `two (2)`, the form legal drafting uses so a typing slip in one half is caught by the other. */
  readonly ownerCountInWords: string
  readonly owners: readonly OwnerRow[]
  /** Every contribution added up, already formatted. */
  readonly totalContributions: string
  /** The articles that are in this agreement, numbered. */
  readonly articles: readonly NumberedArticle[]
  /** Every cross-reference, already resolved: `{ 'exit-process': 'Article 11' }`. */
  readonly references: Readonly<Record<string, string>>
  /** Which template blocks are hidden, and which branch decided each one. */
  readonly blocks: readonly BlockDecision[]
  /**
   * What carries an ordinary decision, as the document writes it: "more than 50%".
   *
   * Words rather than a number, because the smallest holding that carries a simple
   * majority is 50.01% and no agreement in the world says 50.01%.
   */
  readonly ordinaryVote: string
  /** The same threshold in basis points, so the shares can be checked against it. */
  readonly ordinaryVotePoints: string
  /** What carries a decision that changes the deal itself, as the document writes it. */
  readonly majorVote: string
  /** The same threshold in basis points. */
  readonly majorVotePoints: string
  /** Whether a tie is arithmetically possible with these shares. */
  readonly deadlockPossible: boolean
}

/** The result: what to send, and the plain-words explanation that travels with it. */
export interface PreparedAgreement {
  readonly shape: AgreementShape
  readonly data: AgreementData
  /** One line per decision made here, for the record and for the pack. */
  readonly explanation: readonly string[]
}

/** Whole cents from text, refusing anything that is not whole cents. */
function centsFrom(written: string, whose: string): bigint {
  if (!/^\d+$/.test(written.trim())) {
    throw new UnusableNumber(
      `${whose} is written as "${written}", and a contribution value must be whole ` +
        `cents written as digits — 2500000 for twenty-five thousand dollars. Money ` +
        `is never held as a fraction anywhere in this project, because 0.1 plus 0.2 ` +
        `is not 0.3 in binary and an ownership document must not be built on that.`,
    )
  }
  return BigInt(written.trim())
}

/**
 * Read the shares the owners agreed, refusing anything that does not add up.
 *
 * An owner with no stated share is not given one. Splitting the remainder equally
 * would be a guess presented as a fact, in the article people open the document to
 * read.
 */
function agreedShares(owners: readonly Owner[]): readonly BasisPoints[] {
  const missing = owners.filter((owner) => owner.sharePercent === undefined)
  if (missing.length > 0) {
    throw new NotEnoughToDraft(
      `No share has been recorded for ${missing.map((one) => one.name).join(' and ')}. ` +
        `Charter will not divide the remainder for them: the split is the single ` +
        `thing the owners have to decide themselves, and a number chosen by a ` +
        `program is a term nobody agreed to.`,
    )
  }

  const shares = owners.map((owner) => share(owner.sharePercent as string))
  mustTotalWhole(shares, owners.map((owner) => owner.name))
  return shares
}

/**
 * Prepare everything the document needs, or say exactly what is missing.
 *
 * `today` is passed in rather than read from the clock, so the same facts always
 * produce the same document. A run that can be repeated is the whole basis for
 * anybody being able to check this project's work, and a value that changes by
 * itself quietly breaks that.
 */
export function prepareAgreement(facts: CaseFacts, today: string): PreparedAgreement {
  const explanation: string[] = []

  const companyName = facts.proposedName
  if (companyName === undefined || companyName.trim() === '') {
    throw new NotEnoughToDraft('The business has no agreed name yet, so nothing can be drafted.')
  }
  const state = facts.state
  if (state === undefined || state.trim() === '') {
    throw new NotEnoughToDraft(
      'The state the business is formed in is not known, and it decides which ' +
        "state's law reads this document.",
    )
  }
  if (facts.owners.length < 2) {
    throw new NotEnoughToDraft(
      `An ownership agreement divides something between people, and ` +
        `${facts.owners.length} owner${facts.owners.length === 1 ? ' is' : 's are'} ` +
        `recorded.`,
    )
  }

  // ---- shares, and whether they follow what people put in --------------------

  const shares = agreedShares(facts.owners)
  explanation.push(
    `Shares total exactly 100%: ${facts.owners
      .map((owner, index) => `${owner.name} ${asPercent(shares[index] as BasisPoints)}`)
      .join(', ')}.`,
  )

  const valued = facts.owners.filter((owner) => owner.contributionCents !== undefined)
  if (valued.length !== facts.owners.length) {
    const unvalued = facts.owners.filter((owner) => owner.contributionCents === undefined)
    throw new NotEnoughToDraft(
      `What ${unvalued.map((one) => one.name).join(' and ')} contributed has not been ` +
        `given a value. Texas divides profit and loss by the value of each owner's ` +
        `contribution as stated in the company's records unless the agreement says ` +
        `otherwise, so without a figure there is no record for the statute to read, ` +
        `and the agreement cannot state whether the agreed shares match the ` +
        `contributions or deliberately differ from them.`,
    )
  }

  const contributions = facts.owners.map((owner) =>
    centsFrom(owner.contributionCents as string, `${owner.name}'s contribution`),
  )
  const totalContributions = contributions.reduce((running, one) => running + one, 0n)

  const contributionShares = contributions.map((one) =>
    totalContributions > 0n
      ? shareOfContributions(one, totalContributions)
      : { points: 0n as BasisPoints, exact: false },
  )

  // WHY THIS ALLOWS A SINGLE BASIS POINT OF DIFFERENCE.
  //
  // A share of the contributions is worked out by whole-number division, which
  // truncates. Three partners who each put in exactly the same amount have a true
  // share of 33.333…%, which truncates to 33.33% each — and three of those total
  // 99.99%, not 100%. The only split that totals exactly 100% is 33.33 / 33.33 /
  // 33.34, so the third owner is always one basis point above the truncated
  // figure.
  //
  // Demanding exact equality therefore told three equal partners that they had
  // deliberately departed from their contributions, and put that in their
  // agreement. That is not a rounding curiosity: it is the document stating a
  // choice nobody made, in the article about how profit is divided.
  //
  // One basis point is the most that truncation can lose for any one owner, so a
  // difference of one is arithmetic and a difference of two is a decision. A
  // genuine departure is nowhere near this line — fifty-fifty on an eighty-twenty
  // contribution differs by three thousand basis points.
  const sharesFollowContributions = shares.every((agreed, index) => {
    const fromContribution = contributionShares[index]
    if (fromContribution === undefined) return false

    const difference =
      agreed > fromContribution.points
        ? agreed - fromContribution.points
        : fromContribution.points - agreed

    // When the division came out exactly, there is nothing to forgive.
    return fromContribution.exact ? difference === 0n : difference <= 1n
  })

  explanation.push(
    sharesFollowContributions
      ? 'Each owner’s share of profit matches their share of what they put in, so the agreement records that this is deliberate.'
      : 'The agreed shares differ from the contributions, so the agreement states the agreed split in its own words. Silence would hand the question to the statute, and the statute divides by contribution value.',
  )

  // ---- the shape, the articles, the branches ---------------------------------

  const choices = facts.agreementChoices
  const managedBy = choices?.managedBy
  if (managedBy === undefined) {
    throw new NotEnoughToDraft(
      'Nobody has said who runs the company day to day. There is no safe default: ' +
        'assuming the owners run it themselves gives every owner authority to bind ' +
        'the company, and assuming an appointed manager takes that authority away ' +
        'from all of them. Both are terms of the deal, so a person answers.',
    )
  }

  const hasExitProcess = choices?.hasExitProcess
  if (hasExitProcess === undefined) {
    throw new NotEnoughToDraft(
      'Nobody has said whether there is a written way for an owner to leave and be ' +
        'paid out. This is the most consequential blank in the document. Texas ' +
        'states that a member may not withdraw or be expelled, so an agreement that ' +
        'creates no exit leaves no exit at all — and that is a term whether or not ' +
        'anybody meant to agree to it. Charter will not choose it for them.',
    )
  }

  const shape: AgreementShape = {
    shares,
    managedBy,
    sharesFollowContributions,
    hasExitProcess,
  }

  const articles = numberArticles(shape)
  const decisions = decideBranches(shape)
  assertExactlyOnePerBranch(decisions)

  // Every reference resolved once, here, so the template holds no article numbers.
  const references: Record<string, string> = {}
  for (const article of articles) {
    references[article.id] = reference(articles, article.id)
  }

  explanation.push(
    `${articles.length} articles, numbered from one after leaving out the ones that ` +
      `do not apply. Every cross-reference was resolved against that numbering, and ` +
      `a reference to an article that is not in the document stops the build.`,
  )

  explanation.push(
    managedBy === 'the owners themselves'
      ? 'The owners run the company themselves, so decisions are made by the owners voting.'
      : 'The owners appoint a manager to run the company, and reserve certain decisions to themselves.',
  )

  if (!shape.hasExitProcess) {
    explanation.push(
      'No process for an owner to leave was agreed, so the agreement says plainly ' +
        'that there is no way out. Texas states that a member may not withdraw or be ' +
        'expelled, and an agreement that adds nothing leaves that as the term.',
    )
  }

  // ---- votes ----------------------------------------------------------------

  // An ordinary decision carries on MORE than half. Not on half.
  //
  // Until 30 August 2026 this was exactly one half, tested as "holds at least this
  // much". In the most common two-owner business — fifty percent each — either
  // owner alone met it, while the same document included a deadlock article on the
  // ground that these shares allow an exact tie. The document said two things that
  // cannot both be true, and both of them read perfectly.
  const ordinary = moreThan(1, 2)

  // A decision that changes the deal itself carries at two-thirds OR MORE, which is
  // the ordinary form for a threshold an agreement singles out: landing exactly on
  // the fraction is meant to carry.
  const major = atLeast(2, 3)
  const deadlockPossible = articles.some((article) => article.id === 'deadlock')

  if (deadlockPossible) {
    explanation.push(
      'These shares allow an exact tie, so a deadlock article is included. It is left ' +
        'out when the arithmetic makes a tie impossible.',
    )
  }

  // The contradiction check. A document that includes a deadlock article is saying
  // a tie can happen; a document whose ordinary threshold can be met by exactly
  // half is saying it cannot. Both statements can sit in one document and read
  // perfectly, which is why this is arithmetic and not proofreading.
  assertVotesAndDeadlockAgree(shares, ordinary, deadlockPossible)

  // ---- the finished values ---------------------------------------------------

  const owners: readonly OwnerRow[] = facts.owners.map((owner, index) => {
    const agreed = shares[index] as BasisPoints
    const fromContribution = contributionShares[index]?.points ?? 0n
    return {
      position: index + 1,
      ordinal: asOrdinal(index + 1),
      fullName: owner.name,
      contribution: owner.contribution,
      contributionValue: asMoney(contributions[index] as bigint),
      agreedShare: asPercent(agreed),
      shareOfContributions: asPercent(fromContribution),
      agreedMatchesContribution: agreed === fromContribution,
    }
  })

  const data: AgreementData = {
    companyName: companyName.trim(),
    state: state.trim(),
    agreementDate: asWrittenDate(today),
    ownerCount: String(facts.owners.length),
    ownerCountInWords: inWordsAndFigures(facts.owners.length),
    owners,
    totalContributions: asMoney(totalContributions),
    articles,
    references,
    blocks: decisions,
    ordinaryVote: ordinary.wording,
    ordinaryVotePoints: String(ordinary.carriesAt),
    majorVote: major.wording,
    majorVotePoints: String(major.carriesAt),
    deadlockPossible,
  }

  return { shape, data, explanation }
}

/**
 * Check the finished document for the one fault that cannot be seen in the data:
 * an article heading with nothing underneath it.
 *
 * The service's own shipped sample places a heading just outside the block that
 * hides its clause. Hide the clause and the heading survives, so the document
 * shows one heading directly above the next with no text between them. It reads as
 * though a section was deleted, which is exactly what happened.
 *
 * `headingLines` is every article heading in the order it appears in the finished
 * text. Two in a row means a section printed nothing.
 */
export function assertNoOrphanHeadings(headingLines: readonly string[], bodyBetween: readonly string[]): void {
  for (let index = 0; index < headingLines.length; index += 1) {
    const body = bodyBetween[index] ?? ''
    if (body.trim() === '') {
      throw new BrokenAgreement(
        `The heading "${headingLines[index]}" is followed immediately by the next ` +
          `heading, with nothing between them. Its clause was hidden and its heading ` +
          `was not, which is the fault in the document service's own sample. Move the ` +
          `heading inside the block that hides the clause.`,
      )
    }
  }
}

/**
 * Refuse a document whose voting rule and whose deadlock article disagree.
 *
 * WHAT GOES WRONG WITHOUT THIS
 *
 * A deadlock article is included when the shares allow some group of owners to hold
 * exactly half. That is a statement: *a tie can happen here, and here is what to do
 * about it.*
 *
 * If the ordinary threshold can be met by exactly half, a tie cannot happen — the
 * first side to vote carries it. The article then describes a situation the rest of
 * the document has made impossible, and a reader following the deadlock procedure
 * is following a procedure for something that never occurs.
 *
 * The reverse is worse. If no group can reach the threshold at all, every ordinary
 * decision is permanently blocked and no deadlock article was included to say so.
 *
 * Both documents read perfectly. Only the arithmetic shows it, which is why this is
 * a check and not proofreading.
 */
export function assertVotesAndDeadlockAgree(
  shares: readonly BasisPoints[],
  ordinary: VoteRule,
  deadlockIncluded: boolean,
): void {
  // Every total any group of owners could hold. A handful of owners, so working
  // through every combination is affordable, and done in whole numbers because a
  // near-tie and a tie are different situations.
  let reachable = new Set<BasisPoints>([0n])
  for (const share of shares) {
    const next = new Set<BasisPoints>(reachable)
    for (const running of reachable) next.add(running + share)
    reachable = next
  }

  const halfExactly = WHOLE / 2n
  const halfIsReachable = reachable.has(halfExactly)
  const halfWouldCarry = carries(ordinary, halfExactly)

  if (halfIsReachable && halfWouldCarry) {
    throw new BrokenAgreement(
      `These shares let a group hold exactly half, and the ordinary threshold of ` +
        `"${ordinary.wording}" is met by exactly half. So the document would include ` +
        `a deadlock article saying a tie can happen, while also letting either side ` +
        `carry every ordinary decision alone. Both sentences read perfectly and they ` +
        `cannot both be true.`,
    )
  }

  if (deadlockIncluded !== halfIsReachable) {
    throw new BrokenAgreement(
      `The deadlock article is ${deadlockIncluded ? 'included' : 'left out'} and these ` +
        `shares ${halfIsReachable ? 'do' : 'do not'} allow a group to hold exactly ` +
        `half. Those disagree.`,
    )
  }

  // Somebody has to be able to decide something. A set of shares where no group
  // can reach the threshold is a company that cannot act at all, and no article
  // in the document would say so.
  const anyoneCanCarry = [...reachable].some((held) => carries(ordinary, held))
  if (!anyoneCanCarry) {
    throw new BrokenAgreement(
      `No group of owners can reach the ordinary threshold of "${ordinary.wording}" ` +
        `with these shares, so every ordinary decision would be permanently blocked ` +
        `and nothing in the document says so.`,
    )
  }
}

/** The share one owner needs to hold to carry a vote on their own, for the record. */
export { WHOLE }
