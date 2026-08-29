/**
 * The places where the agreement says one thing or the other, never both, never
 * neither.
 *
 * THE PROBLEM THIS SOLVES
 *
 * The outside service that builds the document has no "otherwise". It has exactly
 * one tool for choosing: an attribute on a block that says "hide this when the
 * following is true."
 *
 * So an either/or term has to be written as two separate blocks with two separate
 * hide-conditions. And that is where it goes wrong. If somebody writes the second
 * condition as a fresh sentence rather than as the exact opposite of the first,
 * there are combinations of facts where BOTH blocks hide. The document then prints
 * nothing at all where a term of the deal should be.
 *
 * Nothing warns you. The document builds, it looks finished, and a paragraph the
 * owners agreed to is simply absent. Their own shipped example has a version of
 * this fault in it.
 *
 * HOW THIS FILE MAKES THAT IMPOSSIBLE
 *
 * A branch here is **one question with a yes-or-no answer**, and the two
 * hide-conditions are both worked out from that single answer. One is the answer.
 * The other is the answer with "not" in front of it. They are not two rules that
 * have to be kept in step by whoever edits the template — they are one rule used
 * twice, and it is arithmetically impossible for them to agree or to both be true.
 *
 * The template never contains a condition of its own. It contains two block names,
 * and this code says which one is hidden.
 *
 * WHY THE HEADING LIVES INSIDE THE BLOCK
 *
 * A heading placed just outside the block it belongs to survives when the block is
 * hidden, leaving "ARTICLE 5 — ALLOCATION OF PROFITS AND LOSSES" sitting directly
 * above "ARTICLE 6". The service's own shipped sample does exactly this, so it is
 * the first mistake anybody copying that sample will make.
 *
 * Every block named here includes its own heading, and a check refuses a document
 * where one article heading is followed immediately by another with nothing
 * between them.
 */

import type { AgreementShape } from './articles.js'

/** A block in the template, named so the template and this code can agree on it. */
export type BlockName = string

/**
 * One either/or term of the agreement.
 *
 * `whenYes` and `whenNo` are the two blocks in the template. Exactly one of them
 * survives, decided by `answer`. There is no third possibility, and there is no
 * way to express one.
 */
export interface Branch {
  /** A short name for the question, used in the record and in error messages. */
  readonly name: string
  /** The question in plain words, as it would be put to an owner. */
  readonly question: string
  /** The block printed when the answer is yes. */
  readonly whenYes: BlockName
  /** The block printed when the answer is no. */
  readonly whenNo: BlockName
  /** What the two blocks say, in plain words, so the choice is legible without the template. */
  readonly meaning: { readonly yes: string; readonly no: string }
  /** The one place the question is actually answered. */
  readonly answer: (shape: AgreementShape) => boolean
}

export const BRANCHES: readonly Branch[] = [
  {
    name: 'allocation-follows-contributions',
    question: 'Does each owner’s share of profit match their share of what they put in?',
    whenYes: 'allocation-matches-contributions',
    whenNo: 'allocation-differs-from-contributions',
    meaning: {
      yes: 'Profit and loss are divided in the same proportions as the capital each owner contributed, and the agreement records that this is deliberate.',
      no: 'The owners agreed a division of profit that is different from their contributions, and the agreement states that split in its own words rather than leaving the statute to supply one.',
    },
    answer: (shape) => shape.sharesFollowContributions,
  },
  {
    name: 'who-manages',
    question: 'Do the owners run the company themselves, or appoint a manager?',
    whenYes: 'managed-by-members',
    whenNo: 'managed-by-manager',
    meaning: {
      yes: 'The owners manage the company themselves, and decisions are made by the owners voting.',
      no: 'The owners appoint a manager to run the company, and reserve certain decisions to themselves.',
    },
    answer: (shape) => shape.managedBy === 'the owners themselves',
  },
  {
    name: 'is-there-a-way-out',
    question: 'Did the owners write a process for one of them to leave and be paid out?',
    whenYes: 'exit-process-exists',
    whenNo: 'no-exit-exists',
    meaning: {
      yes: 'The agreement creates a written process for an owner to leave, including how their share is valued and paid.',
      no: 'There is no way out. Texas states that a member may not withdraw or be expelled, and this agreement adds nothing, so the agreement says so plainly instead of leaving it to be discovered later.',
    },
    answer: (shape) => shape.hasExitProcess,
  },
]

/** Whether one named block is hidden, and why. */
export interface BlockDecision {
  readonly block: BlockName
  readonly hidden: boolean
  /** Which branch decided this, so the record can say why a paragraph is absent. */
  readonly branch: string
  /** What this block says, in plain words. */
  readonly meaning: string
}

export class BrokenBranch extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BrokenBranch'
  }
}

/**
 * Decide every branch, and hand back the hidden-or-not answer for every block.
 *
 * Both sides of each branch come from one call to `answer`. That is the guarantee:
 * there is one boolean, one block gets it, the other gets its opposite. No
 * combination of facts can hide both or show both, because there is no second
 * condition that could disagree with the first.
 */
export function decideBranches(shape: AgreementShape): readonly BlockDecision[] {
  const decisions: BlockDecision[] = []
  const seen = new Set<BlockName>()

  for (const branch of BRANCHES) {
    // One question. Asked once. Used twice, the second time inverted.
    const yes = branch.answer(shape)

    for (const [block, hidden, meaning] of [
      [branch.whenYes, !yes, branch.meaning.yes],
      [branch.whenNo, yes, branch.meaning.no],
    ] as const) {
      if (seen.has(block)) {
        throw new BrokenBranch(
          `The block "${block}" is used by more than one branch. Two branches ` +
            `deciding the same block can contradict each other, which is the exact ` +
            `fault this file exists to prevent.`,
        )
      }
      seen.add(block)
      decisions.push({ block, hidden, branch: branch.name, meaning })
    }
  }

  return decisions
}

/**
 * The blocks that will actually appear, in template order.
 *
 * Handed to the record so a person reading it afterwards can see which version of
 * each either/or term the document ended up with, without opening the document.
 */
export function survivingBlocks(decisions: readonly BlockDecision[]): readonly BlockName[] {
  return decisions.filter((one) => !one.hidden).map((one) => one.block)
}

/**
 * Check that every branch produced exactly one surviving block.
 *
 * By construction this cannot fail. It is checked anyway, and the reason is worth
 * stating: the construction is a claim about code somebody may later edit, and this
 * is the assertion that turns that claim into something the build enforces. If a
 * future change ever makes the two sides independent, this fails immediately
 * instead of silently dropping a term out of a signed document.
 */
export function assertExactlyOnePerBranch(decisions: readonly BlockDecision[]): void {
  for (const branch of BRANCHES) {
    const mine = decisions.filter((one) => one.branch === branch.name)
    const surviving = mine.filter((one) => !one.hidden)

    if (surviving.length !== 1) {
      throw new BrokenBranch(
        `The branch "${branch.name}" left ${surviving.length} blocks visible, and ` +
          `exactly one is required. ${
            surviving.length === 0
              ? 'Nothing would print where a term of the agreement should be, and the ' +
                'document would look complete.'
              : 'Two contradictory paragraphs would both print.'
          }`,
      )
    }
  }
}
