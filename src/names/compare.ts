/**
 * Deciding whether two business names are the same name.
 *
 * WHY THIS IS PLAIN CODE AND NOT A MODEL
 *
 * "Does *Acme Bakery LLC* collide with *ACME Baking Co*?" looks like a judgement
 * call, and it is tempting to hand it to a model. It is done here in ordinary code
 * instead, for four reasons that all point the same way:
 *
 *   **It is reproducible.** The same two names give the same answer today, next
 *   week, and on a judge's machine. A model gives an answer that depends on the
 *   day, and one that cannot be reproduced cannot be argued about.
 *
 *   **It can be shown.** Every comparison returns the tidied forms it actually
 *   compared and the number it produced. Somebody who disagrees can check the
 *   working rather than being told the answer.
 *
 *   **It costs nothing.** Charter's whole daily allowance is 500 model requests.
 *   Spending them on string comparison would be absurd.
 *
 *   **It is defensible to somebody who asks how it works.** "Lowercase it, remove
 *   the company suffix and the punctuation, compare, and send anything close to a
 *   person" is a complete answer. "The model thought so" is not.
 *
 * The model still has a job here, and it is the one models are good at: writing
 * the plain-English explanation of a decision this code has already made.
 *
 * WHY IT LEANS TOWARDS SENDING THINGS TO A PERSON
 *
 * There are three answers, not two: clearly different, clearly the same, and close
 * enough that a person should look. The middle one is where most real cases land,
 * and the thresholds below are deliberately generous — they catch more than
 * strictly necessary.
 *
 * That direction is chosen and not accidental. Sending an unnecessary case to a
 * person costs somebody a minute. Missing a real collision means a business is
 * formed under a name somebody else is already using, which is expensive, slow and
 * embarrassing to undo. The two mistakes are not the same size, so the threshold
 * is not set in the middle.
 */

/** How close two names are, after tidying. */
export type Closeness = 'exact' | 'same-after-tidying' | 'close' | 'different'

export interface Comparison {
  readonly closeness: Closeness
  /** The forms actually compared, so the working can be checked by hand. */
  readonly comparedAs: { readonly proposed: string; readonly found: string }
  /** How similar, from 0 to 1, rounded to two places and written as text. */
  readonly similarity: string
  /** Which rule decided it, in plain words. */
  readonly because: string
}

/**
 * Endings that say what kind of company something is, not what it is called.
 *
 * *Acme Bakery LLC* and *Acme Bakery Inc* are the same name in two different
 * wrappers, and a comparison that treats them as different would miss almost every
 * real collision. Sorted longest first so that `limited liability company` is
 * removed as one piece rather than leaving `liability company` behind.
 */
const COMPANY_ENDINGS = [
  'limited liability company',
  'limited liability partnership',
  'professional limited liability company',
  'incorporated',
  'corporation',
  'company',
  'limited',
  'pllc',
  'llc',
  'l l c',
  'inc',
  'corp',
  'ltd',
  'llp',
  'lp',
  'co',
].sort((a, b) => b.length - a.length)

/**
 * Words too common to carry meaning in a business name.
 *
 * Kept very short on purpose. Removing too many words makes different businesses
 * look identical, which is the dangerous direction: it would turn a real
 * difference into a false collision and stop a legitimate name.
 */
const NOISE_WORDS = new Set(['the', 'and', 'a', 'an', 'of'])

/** Is this word only filler? Used to stop tidying from removing a whole name. */
const isNoise = (word: string): boolean => NOISE_WORDS.has(word)

/** Would nothing meaningful survive? Then the step that produced it is refused. */
const nothingLeft = (words: readonly string[]): boolean =>
  words.length === 0 || words.every(isNoise)

/**
 * Reduce a name to the part that actually identifies it.
 *
 * Every step is listed here because this is the part somebody will want to check:
 *
 *   1. Accents are folded, so *café* and *cafe* are the same word.
 *   2. Everything becomes lowercase.
 *   3. `&` becomes `and`, because people write both.
 *   4. Punctuation becomes spaces, so *A.C.M.E.* becomes *a c m e*.
 *   5. A run of two or more single letters joins back up, so that becomes *acme*.
 *   6. Company endings are removed from the end, repeatedly.
 *   7. Common filler words are dropped.
 *
 * **Steps six and seven refuse to run when they would leave nothing behind.** A
 * business really can be called *The Company*, and a tidier that reduced it to
 * nothing would compare two empty strings and call every such name identical — or,
 * worse, compare *The Company* against *The Company LLC* and call them different
 * because the two were emptied unevenly. Both were real faults found by trying it,
 * and both failed towards missing a collision rather than inventing one, which is
 * the dangerous direction.
 *
 * The result is what gets compared, and it is returned with every comparison so
 * nobody has to take the answer on trust.
 */
export function tidy(name: string): string {
  const plain = name
    // Separate letters from their accents, then drop the accents.
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

  // A run of single letters is somebody writing initials. Join them back up, so
  // "A.C.M.E." and "ACME" become the same word. A single lone letter is left
  // alone — "A Bakery" is not an initialism.
  let text = joinInitials(plain)

  // Strip company endings until none is left. Stripping only one would leave
  // "The Company LLC" as "the company" while "The Company" stayed whole, and the
  // two would then be tidied unevenly.
  for (;;) {
    const shorter = stripOneEnding(text)
    if (shorter === undefined) break
    if (nothingLeft(shorter.split(' ').filter(Boolean))) break
    text = shorter
  }

  const words = text.split(' ').filter((word) => word !== '')
  const withoutFiller = words.filter((word) => !isNoise(word))
  return nothingLeft(withoutFiller) ? words.join(' ') : withoutFiller.join(' ')
}

/** Join runs of two or more single letters: `a c m e corp` becomes `acme corp`. */
function joinInitials(text: string): string {
  const words = text.split(' ').filter(Boolean)
  const out: string[] = []
  let run: string[] = []
  const flush = () => {
    if (run.length >= 2) out.push(run.join(''))
    else out.push(...run)
    run = []
  }
  for (const word of words) {
    if (word.length === 1) run.push(word)
    else {
      flush()
      out.push(word)
    }
  }
  flush()
  return out.join(' ')
}

/** Remove one company ending from the end, or return nothing if there is none. */
function stripOneEnding(text: string): string | undefined {
  for (const ending of COMPANY_ENDINGS) {
    // A name that is *only* a company word is that business's actual name.
    if (text === ending) return undefined
    if (text.endsWith(` ${ending}`)) return text.slice(0, -(ending.length + 1)).trim()
  }
  return undefined
}

/**
 * How many single-character changes turn one piece of text into the other.
 *
 * The ordinary edit distance. Business names are short, so the simple version is
 * fast enough and is the one people can check against a worked example.
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  let current = new Array<number>(b.length + 1).fill(0)

  for (let i = 1; i <= a.length; i++) {
    current[0] = i
    for (let j = 1; j <= b.length; j++) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1)
      const deletion = (previous[j] ?? 0) + 1
      const insertion = (current[j - 1] ?? 0) + 1
      current[j] = Math.min(substitution, deletion, insertion)
    }
    const swap = previous
    previous = current
    current = swap
  }
  return previous[b.length] ?? 0
}

/** 1 when identical, 0 when nothing in common. */
export function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length)
  if (longest === 0) return 1
  return 1 - editDistance(a, b) / longest
}

/**
 * Anything at or above this counts as close enough for a person to look.
 *
 * Chosen so that *acme bakery* and *acme baking* — the same business with the
 * word changed slightly — is caught. It is deliberately generous, for the reason
 * given at the top of this file: the two mistakes are not the same size.
 */
export const CLOSE_ENOUGH = 0.7

/** Compare a proposed name against one that already exists. */
export function compareNames(proposed: string, found: string): Comparison {
  const a = tidy(proposed)
  const b = tidy(found)
  const comparedAs = { proposed: a, found: b }
  const score = similarity(a, b)
  const asText = score.toFixed(2)

  if (proposed.trim() === found.trim()) {
    return {
      closeness: 'exact',
      comparedAs,
      similarity: '1.00',
      because: 'the two names are written identically',
    }
  }

  if (a === b) {
    return {
      closeness: 'same-after-tidying',
      comparedAs,
      similarity: '1.00',
      because:
        'the same name once the company ending, punctuation and capitals are ' +
        `removed: both become "${a}"`,
    }
  }

  // One name being entirely contained in the other, word for word. "Sunrise" and
  // "Sunrise Bakery" are far apart letter by letter, and obviously worth a look.
  const wordsA = new Set(a.split(' ').filter(Boolean))
  const wordsB = new Set(b.split(' ').filter(Boolean))
  const contained =
    (wordsA.size > 0 && [...wordsA].every((word) => wordsB.has(word))) ||
    (wordsB.size > 0 && [...wordsB].every((word) => wordsA.has(word)))
  if (contained) {
    return {
      closeness: 'close',
      comparedAs,
      similarity: asText,
      because:
        'every word of one name appears in the other, so one is contained in the ' +
        'other rather than being a different name',
    }
  }

  if (score >= CLOSE_ENOUGH) {
    return {
      closeness: 'close',
      comparedAs,
      similarity: asText,
      because:
        `the two are ${asText} alike after tidying, which is at or above the ` +
        `${CLOSE_ENOUGH.toFixed(2)} mark where a person is asked to look`,
    }
  }

  return {
    closeness: 'different',
    comparedAs,
    similarity: asText,
    because: `only ${asText} alike after tidying, below the ${CLOSE_ENOUGH.toFixed(2)} mark`,
  }
}

/**
 * What a whole set of comparisons adds up to.
 *
 * The rule, in one sentence: an exact match blocks, anything close goes to a
 * person, and only a set with nothing close in it is clear.
 *
 * The middle answer is the one that matters. A system with only "yes" and "no"
 * has to guess at the hard cases; this one is allowed to say it does not know,
 * which is both more honest and, for anything with legal weight, the only safe
 * design.
 */
export function verdictFrom(
  comparisons: readonly Comparison[],
): 'clear' | 'collides' | 'needs-a-person' {
  if (comparisons.some((c) => c.closeness === 'exact' || c.closeness === 'same-after-tidying')) {
    return 'collides'
  }
  if (comparisons.some((c) => c.closeness === 'close')) return 'needs-a-person'
  return 'clear'
}
