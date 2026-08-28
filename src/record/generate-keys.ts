/**
 * Make Charter's attestation keypair.
 *
 *     npm run keys:generate
 *
 * WHAT AN ATTESTATION KEY IS FOR
 *
 * Charter keeps a record of everything it does, and each entry carries the
 * fingerprint of the entry before it, so nothing in the middle can be altered
 * without breaking every link after it. That chain cannot catch one thing:
 * entries removed from the END, because a shortened chain is still a valid chain.
 *
 * The attestation closes that. It is a short statement, bound to one key, saying
 * "at this moment this run's record ended here, and held this many entries."
 *
 * WHY ONE HALF IS PUBLISHED AND THE OTHER NEVER LEAVES THIS MACHINE
 *
 * The key comes in two halves. The PUBLIC half only checks statements; it cannot
 * make them. It is written to `keys/attestation.pub` and belongs in the repository
 * in the open, because that is what lets a stranger check our record without
 * asking us for anything. A checker that read its key out of the same file it was
 * checking would prove nothing at all — anyone could sign anything with a key they
 * invented.
 *
 * The PRIVATE half makes statements, so anyone holding it can write a record and
 * vouch for it. It goes into `.env`, which is never committed, and nowhere else.
 *
 * WHY IT IS WRITTEN STRAIGHT INTO .env RATHER THAN PRINTED
 *
 * The earlier version printed the private half and asked a person to copy it. That
 * puts a private key into terminal scrollback, into the shell's saved history if
 * it is ever echoed, and into any recording of the session. Writing it directly
 * means it exists in exactly one place, which is the place that is already
 * excluded from the repository and already checked on every commit.
 *
 * `.env` holds real credentials, so the edit is deliberately narrow: exactly one
 * line changes, and the program checks that afterwards and refuses to save if any
 * other line moved.
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs'
import { generateKeyPair, privateKeyFromEnv } from './attestation.js'
import { setEnvValue, readEnvValue, type SetOutcome } from './env-file.js'

const PUBLIC_PATH = 'keys/attestation.pub'
const ENV_PATH = '.env'
const ENV_NAME = 'ATTESTATION_PRIVATE_KEY'

/** A key written on one line, with real line breaks spelled out as `\n`. */
function asOneLine(pem: string): string {
  return `"${pem.trimEnd().replace(/\n/g, '\\n')}"`
}

/**
 * Put the private half on its line in `.env`, changing nothing else.
 *
 * The part that could go wrong is in `env-file.ts` and touches no disk, so it is
 * fully tested. What happens here is only read, change, check, write — and the
 * check reads the value back out of the text about to be saved and confirms it is
 * the key we meant, before anything is written.
 */
function writeIntoEnv(pem: string, force: boolean): SetOutcome {
  const before = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : ''

  const { text, outcome } = setEnvValue(before, ENV_NAME, asOneLine(pem), {
    replaceExisting: force,
    header: [
      '# The private half of the attestation key. Made by: npm run keys:generate',
      '# The public half is published at keys/attestation.pub, on purpose.',
    ],
  })

  // Read our own work back out of the text about to be saved, through the same
  // reader the running program uses. A key that survives being written but not
  // being read is the failure that shows up days later, in the one place it
  // matters.
  const readBack = privateKeyFromEnv({ [ENV_NAME]: readEnvValue(text, ENV_NAME) } as NodeJS.ProcessEnv)
  if (readBack === undefined || readBack.trim() !== pem.trim()) {
    throw new Error(
      `Refusing to save ${ENV_PATH}: the key was written but did not read back as the ` +
        `same key. Nothing was written.`,
    )
  }

  writeFileSync(ENV_PATH, text, 'utf8')
  return outcome
}

function main(): void {
  const force = process.argv.includes('--force')

  if (existsSync(PUBLIC_PATH) && !force) {
    console.error(
      `\n${PUBLIC_PATH} already exists.\n\n` +
        `Replacing a key means every attestation made with the old one can no longer\n` +
        `be checked by anyone holding only the new public half. That is almost never\n` +
        `what you want.\n\n` +
        `If you are certain, run it again with --force.\n`,
    )
    process.exit(1)
  }

  const { publicKeyPem, privateKeyPem, keyId } = generateKeyPair()

  let outcome: string
  try {
    outcome = writeIntoEnv(privateKeyPem, force)
  } catch (error) {
    // Nothing has been written yet, including the public half. Say so plainly, so
    // nobody is left wondering whether a half-finished key is lying around.
    console.error(`\n${error instanceof Error ? error.message : String(error)}\n`)
    console.error(`Nothing was written. No key file was created.\n`)
    process.exit(1)
    return
  }

  mkdirSync('keys', { recursive: true })
  writeFileSync(PUBLIC_PATH, publicKeyPem, 'utf8')

  console.log(`
Attestation keypair created.

  Key name       ${keyId}
  Public half    ${PUBLIC_PATH}          — commit this, it is meant to be public
  Private half   ${ENV_PATH} (${outcome})   — never committed, never printed

The key name above is a fingerprint of the public half. Publish it in the readme so
anyone checking one of our packets can confirm the key they were handed is the key
we published, without having to trust the packet.

Nothing else was written. The private half is on one line in ${ENV_PATH} and appears
nowhere else on this machine — not in this output, and not in your terminal history.
`)
}

main()
