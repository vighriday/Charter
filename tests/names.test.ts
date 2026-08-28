import { describe, it, expect } from 'vitest'
import {
  tidy,
  compareNames,
  verdictFrom,
  editDistance,
  similarity,
  CLOSE_ENOUGH,
} from '../src/names/compare.js'

/**
 * Deciding whether two business names are the same name.
 *
 * Done in plain code rather than by a model, so that the answer is the same on
 * anyone's machine, the working can be shown, it costs none of the day's five
 * hundred model requests, and "lowercase it, remove the company ending, compare,
 * and send anything close to a person" is a complete answer to somebody who asks
 * how it works.
 *
 * The tests below lean heavily on the middle answer. There are three outcomes, not
 * two, and most real cases land in the middle one. Sending an unnecessary case to
 * a person costs a minute; missing a real collision means a business is formed
 * under somebody else's name. The two mistakes are not the same size, so the
 * threshold is not in the middle.
 */

describe('reducing a name to the part that identifies it', () => {
  it('removes the company ending', () => {
    expect(tidy('Acme Bakery LLC')).toBe('acme bakery')
    expect(tidy('Acme Bakery, Inc.')).toBe('acme bakery')
    expect(tidy('Acme Bakery Corporation')).toBe('acme bakery')
  })

  it('removes more than one ending, so two names tidy the same way', () => {
    // "The Company LLC" against "The Company" was a real fault: stripping only one
    // ending left the first as "the company" and the second as "the", and the two
    // then looked like different businesses.
    expect(tidy('The Company LLC')).toBe(tidy('The Company'))
  })

  it('keeps a name that is only a company word, because that is its name', () => {
    expect(tidy('Limited')).toBe('limited')
    expect(tidy('The Company')).toBe('company')
  })

  it('never reduces a name to nothing', () => {
    // A tidier that emptied a name would compare two empty strings and call every
    // such pair identical.
    for (const name of ['The Company', 'Limited', 'The', 'A Co', 'And Company']) {
      expect(tidy(name), `"${name}" tidied to nothing`).not.toBe('')
    }
  })

  it('joins up initials, so A.C.M.E. and ACME are one word', () => {
    // Another real fault: punctuation became spaces, then the lone "a" was dropped
    // as a filler word, leaving "c m e".
    expect(tidy('A.C.M.E. Corp')).toBe('acme')
    expect(tidy('J P Morgan Co')).toBe('jp morgan')
  })

  it('leaves a single stray letter alone, because that is not an initialism', () => {
    expect(tidy('A Bakery')).toBe('bakery')
  })

  it('folds accents', () => {
    expect(tidy('Sunrise Café')).toBe('sunrise cafe')
  })

  it('treats an ampersand and the word as the same thing', () => {
    expect(tidy('Rivera & Sons')).toBe(tidy('Rivera and Sons'))
  })

  it('drops filler words but not meaning', () => {
    expect(tidy('The Sunrise Cafe')).toBe('sunrise cafe')
    expect(tidy('House of Cards')).toBe('house cards')
  })
})

describe('measuring how far apart two names are', () => {
  it('counts single-character changes', () => {
    expect(editDistance('bakery', 'bakery')).toBe(0)
    expect(editDistance('bakery', 'baking')).toBe(3)
    expect(editDistance('', 'abc')).toBe(3)
    expect(editDistance('abc', '')).toBe(3)
  })

  it('is the same measured either way round', () => {
    expect(editDistance('sunrise', 'sunset')).toBe(editDistance('sunset', 'sunrise'))
  })

  it('gives 1 for identical and 0 for nothing in common', () => {
    expect(similarity('acme', 'acme')).toBe(1)
    expect(similarity('', '')).toBe(1)
    expect(similarity('aaaa', 'bbbb')).toBe(0)
  })
})

describe('comparing a proposed name against one that exists', () => {
  it('calls two identically written names exact', () => {
    const result = compareNames('Acme Bakery LLC', 'Acme Bakery LLC')
    expect(result.closeness).toBe('exact')
  })

  it('catches the same name in a different wrapper', () => {
    // The commonest real collision, and the one a plain string comparison misses.
    const result = compareNames('Acme Bakery LLC', 'Acme Bakery, Inc.')
    expect(result.closeness).toBe('same-after-tidying')
    expect(result.comparedAs).toEqual({ proposed: 'acme bakery', found: 'acme bakery' })
  })

  it('catches the same business with a word changed slightly', () => {
    // Acme Bakery against ACME Baking. This is the case the threshold was set for.
    const result = compareNames('Acme Bakery LLC', 'ACME Baking Co')
    expect(result.closeness).toBe('close')
    expect(Number(result.similarity)).toBeGreaterThanOrEqual(CLOSE_ENOUGH)
  })

  it('catches one name being contained inside the other', () => {
    // Far apart letter by letter, and obviously worth a look.
    const result = compareNames('Sunrise', 'Sunrise Bakery LLC')
    expect(result.closeness).toBe('close')
    expect(result.because).toContain('contained')
  })

  it('does not call two genuinely different businesses close', () => {
    // The check must not fire on everything, or it stops meaning anything.
    expect(compareNames('Acme Bakery', 'Zenith Plumbing').closeness).toBe('different')
    expect(compareNames('Rivera Legal', 'Blue Owl Coffee').closeness).toBe('different')
  })

  it('shows the working, so somebody who disagrees can check it', () => {
    const result = compareNames('The Sunrise Café', 'Sunrise Cafe LLC')
    expect(result.comparedAs.proposed).toBe('sunrise cafe')
    expect(result.comparedAs.found).toBe('sunrise cafe')
    expect(result.because.length).toBeGreaterThan(20)
    expect(result.similarity).toMatch(/^\d\.\d\d$/)
  })

  it('gives the same answer every time it is asked', () => {
    // A model does not. This is the main reason the decision is code.
    const once = compareNames('Hart Legal', 'Heart Legal')
    const twice = compareNames('Hart Legal', 'Heart Legal')
    expect(once).toEqual(twice)
  })
})

describe('what a whole set of comparisons adds up to', () => {
  const against = (found: readonly string[]) =>
    verdictFrom(found.map((name) => compareNames('Rivera Bakery LLC', name)))

  it('is clear when nothing found is close', () => {
    expect(against(['Zenith Plumbing', 'Blue Owl Coffee'])).toBe('clear')
  })

  it('collides when something found is the same name', () => {
    expect(against(['Zenith Plumbing', 'Rivera Bakery Inc'])).toBe('collides')
  })

  it('goes to a person when something is close but not the same', () => {
    expect(against(['Zenith Plumbing', 'Rivera Baking Co'])).toBe('needs-a-person')
  })

  it('lets a collision outrank a close one, because a collision is decided', () => {
    expect(against(['Rivera Baking Co', 'Rivera Bakery, LLC'])).toBe('collides')
  })

  it('is clear when there is nothing to compare against', () => {
    expect(verdictFrom([])).toBe('clear')
  })
})
