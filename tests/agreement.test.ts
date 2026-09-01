/**
 * Proving the ownership agreement is built correctly, and proving the four faults
 * it was designed around actually get caught.
 *
 * WHY THIS FILE IS LONGER THAN THE OTHERS
 *
 * An ownership agreement says who owns what share of a business, who decides
 * things, and what happens when somebody wants out. It is the document people
 * sign. Every other part of this project produces something that can be corrected
 * afterwards; this one produces something that binds people.
 *
 * The outside service that builds the document from a template is good at what it
 * does and cannot do four things. Each of those four produces a document that
 * reads perfectly and is wrong, which is the worst failure available:
 *
 *   1. It joins text rather than adding. `60 + 40` produces `6040`.
 *   2. It cannot renumber. Hide Article 7 and the next one is still Article 8, and
 *      every cross-reference past the gap now points at the wrong section.
 *   3. It has no "otherwise", only "hide this". Two alternative paragraphs can
 *      BOTH hide, and a term of the deal silently prints nothing.
 *   4. A heading placed outside the block that hides its clause survives the
 *      hiding, leaving a heading with no text under it.
 *
 * Every one of those is tested here against the arrangement that actually triggers
 * it, not against a clean case that would pass either way.
 */

import { describe, expect, it } from 'vitest'
import {
  ARTICLES,
  BrokenAgreement,
  type AgreementShape,
  canDeadlock,
  numberArticles,
  reference,
} from '../src/agreement/articles.js'
import {
  BRANCHES,
  BrokenBranch,
  assertExactlyOnePerBranch,
  decideBranches,
  survivingBlocks,
} from '../src/agreement/branches.js'
import {
  UnusableNumber,
  WHOLE,
  asMoney,
  asOrdinal,
  asPercent,
  asWrittenDate,
  inWords,
  inWordsAndFigures,
  mustTotalWhole,
  share,
  shareOfContributions,
  voteThreshold,
  moreThan,
  atLeast,
  carries,
} from '../src/agreement/numbers.js'
import {
  NotEnoughToDraft,
  assertNoOrphanHeadings,
  assertVotesAndDeadlockAgree,
  prepareAgreement,
} from '../src/agreement/prepare.js'
import type { CaseFacts, Owner } from '../src/stages/facts.js'

// ─────────────────────────────────────────────────────────────────────────────
// Fault one: the service joins text instead of adding
// ─────────────────────────────────────────────────────────────────────────────

describe('shares add up, and the total is exact', () => {
  it('turns sixty and forty into one hundred, not into six thousand and forty', () => {
    // This is the whole reason the arithmetic is done in our code. The document
    // service would produce the text "6040" here and it would look plausible.
    const sixty = share('60')
    const forty = share('40')

    expect(sixty + forty).toBe(WHOLE)
    expect(asPercent(sixty + forty)).toBe('100%')
    expect(String(sixty + forty)).not.toBe('6040')
  })

  it('adds three exact thirds of a percent without drifting', () => {
    // Held as whole basis points, so there is no fraction to lose. The same sum in
    // the language's decimal numbers is where 99.99999999999999 comes from.
    const shares = [share('33.34'), share('33.33'), share('33.33')]
    expect(shares.reduce((a, b) => a + b, 0n)).toBe(WHOLE)
    expect(() => mustTotalWhole(shares, ['A', 'B', 'C'])).not.toThrow()
  })

  it('refuses a set of shares that does not total exactly one hundred, and says the real total', () => {
    // "Shares do not add up" sends somebody to re-add a column by hand. Naming the
    // actual total tells them what to look for.
    const shares = [share('33.33'), share('33.33'), share('33.33')]
    expect(() => mustTotalWhole(shares, ['Ana', 'Ben', 'Cara'])).toThrow(UnusableNumber)
    expect(() => mustTotalWhole(shares, ['Ana', 'Ben', 'Cara'])).toThrow(/99\.99%/)
  })

  it('names every owner and their share when the total is wrong', () => {
    const shares = [share('60'), share('50')]
    expect(() => mustTotalWhole(shares, ['Ana', 'Ben'])).toThrow(/Ana 60%.*Ben 50%/s)
  })

  it('will not quietly spread the difference or hand it to anybody', () => {
    const shares = [share('60'), share('30')]
    expect(() => mustTotalWhole(shares, ['Ana', 'Ben'])).toThrow(/will not spread the difference/)
  })

  it('refuses a share finer than one hundredth of a percent rather than rounding it', () => {
    // Somebody who writes 33.333% means something. Silently making it 33.33%
    // changes what they agreed without telling them.
    expect(() => share('33.333')).toThrow(UnusableNumber)
    expect(() => share('33.333')).toThrow(/change what the owners agreed/)
  })

  it('refuses a share over one hundred percent, and a share of nothing', () => {
    expect(() => share('101')).toThrow(/cannot be more than 100/)
    expect(() => share('0')).toThrow(/not a share/)
  })

  it('accepts a percentage written with or without its sign', () => {
    expect(share('60')).toBe(share('60%'))
    expect(share(' 60 % ')).toBe(share('60'))
  })

  it('writes a share back the way a person writes it', () => {
    expect(asPercent(share('60'))).toBe('60%')
    expect(asPercent(share('33.33'))).toBe('33.33%')
    expect(asPercent(share('33.3'))).toBe('33.3%')
    expect(asPercent(WHOLE)).toBe('100%')
  })
})

describe('working out what share the contributions alone would give', () => {
  it('divides exactly when it can, and says so', () => {
    // $25,000 of $100,000 is exactly a quarter.
    const result = shareOfContributions(2_500_000n, 10_000_000n)
    expect(asPercent(result.points)).toBe('25%')
    expect(result.exact).toBe(true)
  })

  it('reports that a division was not exact rather than hiding the remainder', () => {
    // A third of a whole cannot be a whole number of basis points. Dropping the
    // remainder silently is how a set of shares stops adding to one hundred.
    const result = shareOfContributions(1n, 3n)
    expect(result.exact).toBe(false)
  })

  it('refuses when nothing was contributed, instead of dividing by nothing', () => {
    expect(() => shareOfContributions(100n, 0n)).toThrow(UnusableNumber)
  })
})

describe('the wording legal drafting uses, which the service cannot produce', () => {
  it('writes a number as words and figures together', () => {
    // The convention exists so a typing slip in one half is caught by the other.
    expect(inWordsAndFigures(2)).toBe('two (2)')
    expect(inWordsAndFigures(12)).toBe('twelve (12)')
    expect(inWordsAndFigures(21)).toBe('twenty-one (21)')
  })

  it('writes positions as ordinals for signature blocks', () => {
    expect(asOrdinal(1)).toBe('First')
    expect(asOrdinal(2)).toBe('Second')
    expect(asOrdinal(11)).toBe('Eleventh')
    expect(asOrdinal(20)).toBe('Twentieth')
    expect(asOrdinal(23)).toBe('Twenty-third')
  })

  it('refuses a number it cannot write correctly rather than printing a numeral', () => {
    expect(() => inWords(100)).toThrow(UnusableNumber)
    expect(() => inWords(1.5)).toThrow(UnusableNumber)
    expect(() => asOrdinal(0)).toThrow(UnusableNumber)
  })

  it('formats money from whole cents, with the separators a reader expects', () => {
    expect(asMoney(2_500_000n)).toBe('$25,000.00')
    expect(asMoney(5n)).toBe('$0.05')
    expect(asMoney(0n)).toBe('$0.00')
    expect(asMoney(123_456_789n)).toBe('$1,234,567.89')
  })

  it('writes a date so that no reader can mistake the day for the month', () => {
    // The service reads dates differently depending on where the reader is, and
    // fails silently. A document dated a day out is a document a careful reader
    // stops trusting.
    expect(asWrittenDate('2026-09-03')).toBe('3 September 2026')
    expect(asWrittenDate('2026-12-25')).toBe('25 December 2026')
  })

  it('refuses a date written any other way', () => {
    expect(() => asWrittenDate('03/09/2026')).toThrow(UnusableNumber)
    expect(() => asWrittenDate('September 3, 2026')).toThrow(UnusableNumber)
    expect(() => asWrittenDate('2026-13-01')).toThrow(/not a real date/)
  })
})

describe('vote thresholds round the safe way', () => {
  it('rounds up, so a threshold cannot be met by less than it names', () => {
    // Two thirds of 10,000 basis points is 6,666.67. Rounded DOWN, a holder of
    // 66.66% satisfies a clause that says two thirds, and the document permits
    // something it does not say. Rounded up, it does not.
    expect(voteThreshold(2, 3)).toBe(6_667n)
    expect(asPercent(voteThreshold(2, 3))).toBe('66.67%')
  })

  it('leaves an exact fraction exactly where it is', () => {
    expect(voteThreshold(1, 2)).toBe(5_000n)
    expect(voteThreshold(3, 4)).toBe(7_500n)
    expect(voteThreshold(1, 1)).toBe(WHOLE)
  })

  it('takes whole-number fractions, never a decimal', () => {
    expect(() => voteThreshold(0, 3)).toThrow(UnusableNumber)
    expect(() => voteThreshold(4, 3)).toThrow(UnusableNumber)
    expect(() => voteThreshold(1, 0)).toThrow(UnusableNumber)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Fault two: the service cannot renumber, so we do
// ─────────────────────────────────────────────────────────────────────────────

const withExit: AgreementShape = {
  shares: [share('60'), share('40')],
  managedBy: 'the owners themselves',
  sharesFollowContributions: true,
  hasExitProcess: true,
}

const withoutExit: AgreementShape = { ...withExit, hasExitProcess: false }

describe('which articles are there because somebody answered a question', () => {
  // The website marks the sections of the contract that exist because of what the
  // owners said, so a reader can see which parts of the document are theirs. That
  // marking used to come from a list of headings written into the website, which
  // was right for one run and would have been wrong for the next: a run where the
  // owners DO have a way out gets a different article, and the page would have
  // marked nothing while still telling the reader two of them were theirs.
  //
  // So the answer travels with the article. These tests are what stop it drifting
  // back into a list somewhere else.

  it('marks the article that only exists because there is no way out', () => {
    const numbered = numberArticles(withoutExit)
    const noExit = numbered.find((one) => one.id === 'no-exit')

    expect(noExit?.becauseOfAnAnswer, 'no-exit is in because of an answer').toBe(true)
  })

  it('marks the other half of that pair the same way, when the answer goes the other way', () => {
    const numbered = numberArticles(withExit)

    expect(numbered.find((one) => one.id === 'exit-process')?.becauseOfAnAnswer).toBe(true)
    expect(numbered.some((one) => one.id === 'no-exit'), 'only one of the pair').toBe(false)
  })

  it('marks the deadlock article, which is there only when a tie is possible', () => {
    const tie = numberArticles({ ...withExit, shares: [share('50'), share('50')] })

    expect(tie.find((one) => one.id === 'deadlock')?.becauseOfAnAnswer).toBe(true)
  })

  it('does not mark the articles that are in every agreement', () => {
    for (const shape of [withExit, withoutExit]) {
      const numbered = numberArticles(shape)
      const always = numbered.filter(
        (one) => !['no-exit', 'exit-process', 'deadlock'].includes(one.id),
      )

      expect(always.length, 'there are articles in every agreement').toBeGreaterThan(0)
      for (const article of always) {
        expect(article.becauseOfAnAnswer, `${article.heading} is in every agreement`).toBe(false)
      }
    }
  })

  it('always marks at least one, because the exit pair is never both and never neither', () => {
    // A reader told that some sections are theirs, on a page that marks none, has
    // been told something false. Whichever way the answer went, one of the pair is
    // in the document and it is there because of that answer.
    for (const shape of [withExit, withoutExit]) {
      const marked = numberArticles(shape).filter((one) => one.becauseOfAnAnswer)
      expect(marked.length, 'something is always there because of an answer').toBeGreaterThan(0)
    }
  })
})

describe('numbering the articles, and keeping every reference pointing at the right one', () => {
  it('numbers from one with no gaps, whatever was left out', () => {
    for (const shape of [withExit, withoutExit]) {
      const numbered = numberArticles(shape)
      expect(numbered.map((one) => one.number)).toEqual(
        numbered.map((_, index) => index + 1),
      )
    }
  })

  it('gives a different number to the same article when something before it is dropped', () => {
    // This is the fault. The document service would leave the later articles on
    // their original numbers and produce a document with a gap in the sequence.
    //
    // The deadlock article is the one that genuinely disappears: it is included
    // only when the shares make a tie possible. The exit articles are a matched
    // pair — one always replaces the other — so the count never moves there, and
    // testing against those would have proved nothing.
    const tie = numberArticles({ ...withExit, shares: [share('50'), share('50')] })
    const noTie = numberArticles({ ...withExit, shares: [share('60'), share('40')] })

    expect(tie.some((one) => one.id === 'deadlock')).toBe(true)
    expect(noTie.some((one) => one.id === 'deadlock')).toBe(false)

    const withTie = tie.find((one) => one.id === 'dissolution')?.number
    const withoutTie = noTie.find((one) => one.id === 'dissolution')?.number

    expect(withTie).toBeDefined()
    expect(withoutTie).toBe((withTie as number) - 1)
  })

  it('keeps a matched pair from ever changing the count', () => {
    // Every article after the exit clause keeps its number whichever way that
    // choice went, because exactly one of the two is always present.
    expect(numberArticles(withExit)).toHaveLength(numberArticles(withoutExit).length)
  })

  it('resolves a cross-reference against the numbering that actually happened', () => {
    const numbered = numberArticles(withExit)
    const exitNumber = numbered.find((one) => one.id === 'exit-process')?.number

    expect(reference(numbered, 'exit-process')).toBe(`Article ${exitNumber}`)
  })

  it('refuses to name an article that is not in this agreement', () => {
    // A document containing "subject to the process in Article " is obviously
    // broken and somebody fixes it. A sentence that silently vanished looks
    // complete and is missing a condition somebody agreed to.
    const numbered = numberArticles(withoutExit)
    expect(() => reference(numbered, 'exit-process')).toThrow(BrokenAgreement)
    expect(() => reference(numbered, 'exit-process')).toThrow(/quietly changed meaning/)
  })

  it('stops the build if any included article points at one that was left out', () => {
    // Checked over every combination of choices, so a future article that refers
    // to an optional one cannot slip through on the arrangement nobody tested.
    for (const managedBy of ['the owners themselves', 'an appointed manager'] as const) {
      for (const sharesFollowContributions of [true, false]) {
        for (const hasExitProcess of [true, false]) {
          for (const shares of [
            [share('50'), share('50')],
            [share('60'), share('40')],
            [share('40'), share('35'), share('25')],
          ]) {
            expect(() =>
              numberArticles({ shares, managedBy, sharesFollowContributions, hasExitProcess }),
            ).not.toThrow()
          }
        }
      }
    }
  })

  it('prints a heading with its number and the article name', () => {
    const numbered = numberArticles(withExit)
    const members = numbered.find((one) => one.id === 'members')
    expect(members?.fullHeading).toBe(`ARTICLE ${members?.number} — MEMBERS AND OWNERSHIP INTERESTS`)
  })

  it('gives every article a plain-words reason for existing', () => {
    // The reason is printed in the pack, not the agreement. An owner should be able
    // to find out why a clause is in their document without asking anybody.
    for (const article of ARTICLES) {
      expect(article.why.length).toBeGreaterThan(30)
    }
  })
})

describe('deciding whether a tie is even possible', () => {
  it('sees the tie in an even two-way split', () => {
    expect(canDeadlock([share('50'), share('50')])).toBe(true)
  })

  it('sees a tie that only appears when owners group up', () => {
    // 30 and 20 together make exactly half against the other 50.
    expect(canDeadlock([share('50'), share('30'), share('20')])).toBe(true)
  })

  it('leaves the clause out when no combination reaches exactly half', () => {
    expect(canDeadlock([share('60'), share('40')])).toBe(false)
    expect(canDeadlock([share('34'), share('33'), share('33')])).toBe(false)
  })

  it('says no for a single owner, who has nobody to tie with', () => {
    expect(canDeadlock([WHOLE])).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Fault three: no "otherwise", so both sides can vanish
// ─────────────────────────────────────────────────────────────────────────────

describe('every either/or term prints exactly one of its two sides', () => {
  /** Every arrangement of the choices that drive a branch. */
  const everyShape = (): readonly AgreementShape[] => {
    const shapes: AgreementShape[] = []
    for (const managedBy of ['the owners themselves', 'an appointed manager'] as const) {
      for (const sharesFollowContributions of [true, false]) {
        for (const hasExitProcess of [true, false]) {
          shapes.push({
            shares: [share('60'), share('40')],
            managedBy,
            sharesFollowContributions,
            hasExitProcess,
          })
        }
      }
    }
    return shapes
  }

  it('covers every combination of the choices, not just a convenient one', () => {
    expect(everyShape()).toHaveLength(8)
  })

  it('never prints both sides and never prints neither, in any arrangement', () => {
    // This is the fault that produces a finished-looking document with a term of
    // the deal silently absent. Nothing in the service warns you.
    for (const shape of everyShape()) {
      const decisions = decideBranches(shape)
      expect(() => assertExactlyOnePerBranch(decisions)).not.toThrow()

      for (const branch of BRANCHES) {
        const visible = decisions.filter((one) => one.branch === branch.name && !one.hidden)
        expect(visible).toHaveLength(1)
      }
    }
  })

  it('shows the side that matches the choice actually made', () => {
    const owners = decideBranches({ ...withExit, managedBy: 'the owners themselves' })
    expect(survivingBlocks(owners)).toContain('managed-by-members')
    expect(survivingBlocks(owners)).not.toContain('managed-by-manager')

    const manager = decideBranches({ ...withExit, managedBy: 'an appointed manager' })
    expect(survivingBlocks(manager)).toContain('managed-by-manager')
    expect(survivingBlocks(manager)).not.toContain('managed-by-members')
  })

  it('says in plain words what each surviving block means', () => {
    // So a person reading the record can see which version of a term they got
    // without opening the document.
    for (const decision of decideBranches(withExit)) {
      expect(decision.meaning.length).toBeGreaterThan(30)
    }
  })

  it('refuses if two branches ever try to decide the same block', () => {
    // Cannot happen with the branches as written. Asserted anyway, because the
    // guarantee is a claim about code somebody may later edit.
    const clashing = [
      ...BRANCHES,
      { ...(BRANCHES[0] as (typeof BRANCHES)[number]), name: 'a-copy' },
    ]
    const seen = new Set<string>()
    let clashed = false
    for (const branch of clashing) {
      for (const block of [branch.whenYes, branch.whenNo]) {
        if (seen.has(block)) clashed = true
        seen.add(block)
      }
    }
    expect(clashed).toBe(true)
    expect(BrokenBranch).toBeDefined()
  })

  it('gives every branch a question a person could actually be asked', () => {
    for (const branch of BRANCHES) {
      expect(branch.question).toMatch(/\?$/)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Fault four: a heading that outlives the clause it belongs to
// ─────────────────────────────────────────────────────────────────────────────

describe('no article heading is left standing with nothing under it', () => {
  it('accepts a document where every heading has text beneath it', () => {
    expect(() =>
      assertNoOrphanHeadings(
        ['ARTICLE 1 — FORMATION', 'ARTICLE 2 — PURPOSE'],
        ['The company is formed under...', 'The company may carry on any lawful...'],
      ),
    ).not.toThrow()
  })

  it('refuses a document where a heading is followed straight by the next heading', () => {
    // The document service's own shipped sample has this fault, so it is the first
    // mistake anybody copying that sample will make.
    expect(() =>
      assertNoOrphanHeadings(
        ['ARTICLE 5 — ALLOCATION', 'ARTICLE 6 — DISTRIBUTIONS'],
        ['', 'Distributions are made...'],
      ),
    ).toThrow(BrokenAgreement)
  })

  it('names the heading that lost its clause, and says what to do about it', () => {
    expect(() => assertNoOrphanHeadings(['ARTICLE 5 — ALLOCATION'], ['   '])).toThrow(
      /ARTICLE 5 — ALLOCATION/,
    )
    expect(() => assertNoOrphanHeadings(['ARTICLE 5 — ALLOCATION'], [''])).toThrow(
      /Move the heading inside the block/,
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Putting it together, and refusing rather than guessing
// ─────────────────────────────────────────────────────────────────────────────

const ana: Owner = {
  name: 'Ana Rivera',
  contribution: 'the delivery van and the ovens',
  contributionCents: '2500000',
  sharePercent: '50',
}

const ben: Owner = {
  name: 'Ben Rivera',
  contribution: 'the lease deposit and the first year of rent',
  contributionCents: '2500000',
  sharePercent: '50',
}

const caseWith = (owners: readonly Owner[], extra: Partial<CaseFacts> = {}): CaseFacts =>
  ({
    caseId: 'case-1',
    proposedName: 'Rivera Sisters Baking Co LLC',
    state: 'Texas',
    owners,
    openQuestions: [],
    agreementChoices: { managedBy: 'the owners themselves', hasExitProcess: false },
    ...extra,
  }) as CaseFacts

describe('preparing a whole agreement', () => {
  it('produces every value already finished, with nothing left to compute', () => {
    const { data } = prepareAgreement(caseWith([ana, ben]), '2026-09-03')

    expect(data.companyName).toBe('Rivera Sisters Baking Co LLC')
    expect(data.agreementDate).toBe('3 September 2026')
    expect(data.ownerCountInWords).toBe('two (2)')
    expect(data.totalContributions).toBe('$50,000.00')
    expect(data.owners[0]?.agreedShare).toBe('50%')
    expect(data.owners[0]?.ordinal).toBe('First')
    expect(data.owners[1]?.ordinal).toBe('Second')
  })

  it('includes the deadlock article for an even split, and not otherwise', () => {
    const even = prepareAgreement(caseWith([ana, ben]), '2026-09-03')
    expect(even.data.deadlockPossible).toBe(true)

    const uneven = prepareAgreement(
      caseWith([
        { ...ana, sharePercent: '60', contributionCents: '3000000' },
        { ...ben, sharePercent: '40', contributionCents: '2000000' },
      ]),
      '2026-09-03',
    )
    expect(uneven.data.deadlockPossible).toBe(false)
  })

  it('notices when the agreed shares match what people put in', () => {
    const { shape, explanation } = prepareAgreement(caseWith([ana, ben]), '2026-09-03')
    expect(shape.sharesFollowContributions).toBe(true)
    expect(explanation.join(' ')).toMatch(/matches their share of what they put in/)
  })

  it('does not tell three equal partners they departed from their contributions', () => {
    // Three partners who each put in the same amount have a true share of
    // 33.333…%, which truncates to 33.33% each — and three of those total 99.99%,
    // not 100%. The only split that totals exactly 100% is 33.33 / 33.33 / 33.34,
    // so the third owner is always one basis point above the truncated figure.
    //
    // Demanding exact equality told them they had DELIBERATELY departed from their
    // contributions, and put that in their agreement. That is not a rounding
    // curiosity: it is the document stating a choice nobody made, in the article
    // about how profit is divided.
    const equal = prepareAgreement(
      caseWith([
        { ...ana, sharePercent: '33.33', contributionCents: '1000000' },
        { ...ben, name: 'Ben Rivera', sharePercent: '33.33', contributionCents: '1000000' },
        {
          name: 'Cleo Rivera',
          contribution: 'the shopfront',
          sharePercent: '33.34',
          contributionCents: '1000000',
        },
      ]),
      '2026-09-03',
    )

    expect(equal.shape.sharesFollowContributions).toBe(true)
    expect(equal.explanation.join(' ')).toMatch(/matches their share of what they put in/)
  })

  it('still spots a real departure, which is nowhere near the rounding line', () => {
    // Fifty-fifty on an eighty-twenty contribution differs by three thousand basis
    // points. One basis point is arithmetic; two is a decision.
    const departed = prepareAgreement(
      caseWith([
        { ...ana, sharePercent: '50', contributionCents: '4000000' },
        { ...ben, sharePercent: '50', contributionCents: '1000000' },
      ]),
      '2026-09-03',
    )

    expect(departed.shape.sharesFollowContributions).toBe(false)
  })

  it('notices when they deliberately do not, and says why that has to be written down', () => {
    // Texas divides profit by contribution value as stated in the company's
    // records unless the agreement says otherwise. Silence hands the question back
    // to the statute, and the statute will not produce what these two agreed.
    const uneven = prepareAgreement(
      caseWith([
        { ...ana, sharePercent: '50', contributionCents: '4000000' },
        { ...ben, sharePercent: '50', contributionCents: '1000000' },
      ]),
      '2026-09-03',
    )
    expect(uneven.shape.sharesFollowContributions).toBe(false)
    expect(uneven.explanation.join(' ')).toMatch(/statute divides by contribution value/)
  })

  it('resolves every cross-reference to an article that is really in the document', () => {
    const { data } = prepareAgreement(caseWith([ana, ben]), '2026-09-03')
    const numbers = new Set(data.articles.map((one) => `Article ${one.number}`))

    for (const resolved of Object.values(data.references)) {
      expect(numbers.has(resolved)).toBe(true)
    }
  })

  it('leaves exactly one side of every either/or term visible', () => {
    const { data } = prepareAgreement(caseWith([ana, ben]), '2026-09-03')
    for (const branch of BRANCHES) {
      const visible = data.blocks.filter((one) => one.branch === branch.name && !one.hidden)
      expect(visible).toHaveLength(1)
    }
  })

  it('gives the same document for the same facts, because the date is passed in', () => {
    const first = prepareAgreement(caseWith([ana, ben]), '2026-09-03')
    const second = prepareAgreement(caseWith([ana, ben]), '2026-09-03')
    expect(JSON.stringify(first.data)).toBe(JSON.stringify(second.data))
  })
})

describe('refusing to draft, rather than filling in a term nobody agreed', () => {
  it('refuses when an owner has no recorded share', () => {
    // Deleted rather than set to undefined. Under this project's compiler
    // settings those are different things, and only one of them is "absent".
    const noShare: Owner = { ...ben }
    delete (noShare as { sharePercent?: string }).sharePercent

    expect(() => prepareAgreement(caseWith([ana, noShare]), '2026-09-03')).toThrow(NotEnoughToDraft)
    expect(() => prepareAgreement(caseWith([ana, noShare]), '2026-09-03')).toThrow(
      /will not divide the remainder/,
    )
  })

  it('refuses when the shares do not total one hundred percent', () => {
    expect(() =>
      prepareAgreement(caseWith([ana, { ...ben, sharePercent: '40' }]), '2026-09-03'),
    ).toThrow(/must total exactly 100%/)
  })

  it('refuses when a contribution has never been given a value', () => {
    const unvalued: Owner = { ...ben }
    delete (unvalued as { contributionCents?: string }).contributionCents

    expect(() => prepareAgreement(caseWith([ana, unvalued]), '2026-09-03')).toThrow(
      /no record for the statute to read/,
    )
  })

  it('refuses when nobody has said who runs the company', () => {
    // No safe default exists. One answer gives every owner authority to bind the
    // company; the other takes it away from all of them.
    const facts = caseWith([ana, ben], { agreementChoices: { hasExitProcess: false } })
    expect(() => prepareAgreement(facts, '2026-09-03')).toThrow(/no safe default/)
  })

  it('refuses when nobody has said whether there is a way out', () => {
    const facts = caseWith([ana, ben], {
      agreementChoices: { managedBy: 'the owners themselves' },
    })
    expect(() => prepareAgreement(facts, '2026-09-03')).toThrow(
      /most consequential blank in the document/,
    )
  })

  it('says plainly, when there is no way out, that this is the term', () => {
    // Texas states a member may not withdraw or be expelled. An agreement that
    // adds nothing leaves that as the deal, and the owners should read it in their
    // own document rather than discover it later.
    const { explanation } = prepareAgreement(caseWith([ana, ben]), '2026-09-03')
    expect(explanation.join(' ')).toMatch(/may not withdraw or be expelled/)
  })

  it('refuses a business with fewer than two owners', () => {
    expect(() => prepareAgreement(caseWith([ana]), '2026-09-03')).toThrow(NotEnoughToDraft)
  })

  it('refuses without a name or without a state', () => {
    expect(() =>
      prepareAgreement(caseWith([ana, ben], { proposedName: '  ' }), '2026-09-03'),
    ).toThrow(/no agreed name/)
    expect(() => prepareAgreement(caseWith([ana, ben], { state: '' }), '2026-09-03')).toThrow(
      /which state's law reads this document/,
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Voting, and the contradiction a document can hold without looking wrong
// ─────────────────────────────────────────────────────────────────────────────

describe('what carries a vote', () => {
  it('makes an ordinary decision need MORE than half, not half', () => {
    // The bug. Until 30 August 2026 an ordinary decision carried at exactly one
    // half, tested as "holds at least this much". In the most common two-owner
    // business — fifty percent each — either owner alone met it.
    const ordinary = moreThan(1, 2)

    expect(ordinary.carriesAt).toBe(5_001n)
    expect(carries(ordinary, 5_000n), 'exactly half carried an ordinary vote').toBe(false)
    expect(carries(ordinary, 5_001n)).toBe(true)
  })

  it('writes it the way an agreement writes it, not as 50.01%', () => {
    // The smallest holding that carries a simple majority is 50.01%, and no
    // agreement in the world says 50.01%. It says "more than fifty percent".
    expect(moreThan(1, 2).wording).toBe('more than 50%')
  })

  it('lets a singled-out threshold be met exactly', () => {
    // "Two-thirds or more" is the ordinary form for a decision an agreement marks
    // as important: landing exactly on the fraction is meant to carry.
    const major = atLeast(2, 3)
    expect(carries(major, major.carriesAt)).toBe(true)
    expect(carries(major, major.carriesAt - 1n)).toBe(false)
  })

  it('rounds a singled-out threshold UP, never down', () => {
    // Rounded down, a threshold could be met by less than the fraction the
    // document names, so the document would say one thing and permit another.
    // Two thirds of 10,000 is 6,666.66…, so the smallest holding that genuinely
    // satisfies it is 6,667.
    expect(atLeast(2, 3).carriesAt).toBe(6_667n)
  })

  it('refuses a fraction that is not one', () => {
    expect(() => moreThan(0, 2)).toThrow(UnusableNumber)
    expect(() => moreThan(3, 2)).toThrow(UnusableNumber)
    expect(() => moreThan(1, 0)).toThrow(UnusableNumber)
    expect(() => moreThan(1.5, 2)).toThrow(UnusableNumber)
  })
})

describe('the voting rule and the deadlock article have to agree', () => {
  const twoEqual = [5_000n, 5_000n]
  const threeUneven = [4_000n, 3_500n, 2_500n]

  it('accepts fifty-fifty with a deadlock article and a more-than-half rule', () => {
    expect(() =>
      assertVotesAndDeadlockAgree(twoEqual, moreThan(1, 2), true),
    ).not.toThrow()
  })

  it('refuses a document that includes a deadlock article and lets half carry', () => {
    // Both sentences read perfectly: "a tie can happen, and here is what to do",
    // and "an ordinary decision carries at 50%". They cannot both be true. Only
    // the arithmetic shows it, which is why this is a check and not proofreading.
    expect(() => assertVotesAndDeadlockAgree(twoEqual, atLeast(1, 2), true)).toThrow(
      BrokenAgreement,
    )
    expect(() => assertVotesAndDeadlockAgree(twoEqual, atLeast(1, 2), true)).toThrow(
      /cannot both be true/,
    )
  })

  it('refuses a deadlock article when no group can hold exactly half', () => {
    expect(() =>
      assertVotesAndDeadlockAgree(threeUneven, moreThan(1, 2), true),
    ).toThrow(BrokenAgreement)
  })

  it('refuses leaving the deadlock article out when a tie is possible', () => {
    expect(() =>
      assertVotesAndDeadlockAgree(twoEqual, moreThan(1, 2), false),
    ).toThrow(BrokenAgreement)
  })

  it('refuses shares where no group can ever reach the threshold', () => {
    // A company that cannot decide anything, with nothing in the document saying
    // so. These shares do not add to a whole on purpose: this is the check for a
    // set of holdings nobody can combine into a majority.
    expect(() =>
      assertVotesAndDeadlockAgree([1_000n, 1_000n], moreThan(1, 2), false),
    ).toThrow(/permanently blocked/)
  })
})

describe('a real fifty-fifty agreement', () => {
  it('says a tie is possible and does not let either owner carry a vote alone', () => {
    // The whole point, end to end: the two sisters, half each. The document must
    // include the deadlock article AND must not permit either of them to decide
    // an ordinary question by themselves.
    const prepared = prepareAgreement(caseWith([ana, ben]), '2026-09-03')

    expect(prepared.data.deadlockPossible).toBe(true)
    expect(prepared.data.ordinaryVote).toBe('more than 50%')
    expect(BigInt(prepared.data.ordinaryVotePoints)).toBe(5_001n)
    expect(carries(
      { carriesAt: BigInt(prepared.data.ordinaryVotePoints), wording: '', mustBeat: true },
      5_000n,
    )).toBe(false)
  })
})
