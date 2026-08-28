/**
 * Changing one line of an environment file, and proving nothing else moved.
 *
 * WHAT AN ENVIRONMENT FILE IS
 *
 * A plain text file called `.env`, holding one setting per line as `NAME=value`.
 * It is where a project keeps the passwords and keys it needs to talk to outside
 * services. It is never committed to the repository, because everything in it is
 * secret.
 *
 * WHY THIS IS ITS OWN FILE, AND WHY IT IS ALL PURE
 *
 * `npm run keys:generate` writes the private half of Charter's attestation key
 * into that file. Charter's `.env` holds around forty real credentials, and there
 * is no undo — a program that mangles it costs every one of them, and some cannot
 * be regenerated without going back to a vendor.
 *
 * So the part that could get it wrong takes text and returns text, touching no
 * disk at all. That makes the dangerous half completely testable: the tests can
 * throw awkward files at it — comments, blank lines, values containing an equals
 * sign, no line break at the end — and check the exact output, without a single
 * real file existing anywhere.
 *
 * It also checks its own work. After making the change it compares every other
 * line against the original, and refuses rather than returning anything if even
 * one of them moved. A check that runs on the result is worth more than care taken
 * while writing the code, because the check keeps working after somebody edits it.
 */

export class EnvFileRefusal extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EnvFileRefusal'
  }
}

/** What happened to the line, so a command can say it in plain words. */
export type SetOutcome = 'filled in' | 'replaced' | 'added'

export interface SetResult {
  readonly text: string
  readonly outcome: SetOutcome
}

/**
 * Set one name to one value, changing nothing else.
 *
 * `header` is only used when the name is not in the file at all, in which case
 * those lines are added as comments above it. A value appearing from nowhere with
 * no explanation is how environment files become unreadable.
 *
 * Refuses, rather than overwriting, when the name already holds a value and
 * `replaceExisting` was not asked for. Silently replacing a key that is already in
 * use is the one mistake here that is genuinely unrecoverable.
 */
export function setEnvValue(
  original: string,
  name: string,
  value: string,
  options: { readonly replaceExisting?: boolean; readonly header?: readonly string[] } = {},
): SetResult {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
    throw new EnvFileRefusal(
      `"${name}" is not a usable setting name. Names are capitals, digits and ` +
        `underscores, starting with a letter.`,
    )
  }
  if (value.includes('\n')) {
    throw new EnvFileRefusal(
      `the value for ${name} contains a line break, and one setting is one line. ` +
        `Write the line breaks as the two characters \\ and n instead.`,
    )
  }

  const lines = original.split('\n')
  const index = lines.findIndex((line) => line.startsWith(`${name}=`))

  let outcome: SetOutcome
  const next = [...lines]

  if (index === -1) {
    // Leave exactly one blank line before the new block, whatever the file ended with.
    while (next.length > 0 && next[next.length - 1] === '') next.pop()
    if (next.length > 0) next.push('')
    for (const line of options.header ?? []) next.push(line)
    next.push(`${name}=${value}`)
    next.push('')
    outcome = 'added'
  } else {
    const existing = lines[index] ?? ''
    const hadValue = existing.slice(name.length + 1).trim() !== ''
    if (hadValue && options.replaceExisting !== true) {
      throw new EnvFileRefusal(
        `${name} already holds a value. Replacing it was not asked for, so nothing ` +
          `was changed.`,
      )
    }
    next[index] = `${name}=${value}`
    outcome = hadValue ? 'replaced' : 'filled in'
  }

  assertOnlyThisLineMoved(lines, next, name)
  return { text: next.join('\n'), outcome }
}

/**
 * Confirm that every line other than the one for `name` survived unchanged, in the
 * same order.
 *
 * Comparing in order rather than as a set matters: two settings swapping places
 * would pass a set comparison and could change which value wins in a file that
 * happens to name something twice.
 */
function assertOnlyThisLineMoved(before: readonly string[], after: readonly string[], name: string): void {
  const strip = (lines: readonly string[]): string[] => lines.filter((line) => !line.startsWith(`${name}=`))
  const a = strip(before)
  const b = strip(after)

  // Adding a setting also adds its comment header and spacing, which is expected.
  // Everything that was there before must still be there, in the same order.
  let at = 0
  for (const line of a) {
    const found = b.indexOf(line, at)
    if (found === -1) {
      throw new EnvFileRefusal(
        `refusing to change this file: the line "${truncate(line)}" would have been ` +
          `lost or moved. Nothing was changed. This file holds real credentials and ` +
          `has no undo.`,
      )
    }
    at = found + 1
  }
}

const truncate = (line: string): string => (line.length > 40 ? `${line.slice(0, 40)}…` : line)

/**
 * Read one setting out of environment-file text, without applying it to anything.
 *
 * Used to check our own work: after writing a value, read it back from the text
 * that is about to be saved and confirm it is the value intended.
 */
export function readEnvValue(text: string, name: string): string | undefined {
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith(`${name}=`)) continue
    return trimmed.slice(name.length + 1)
  }
  return undefined
}
