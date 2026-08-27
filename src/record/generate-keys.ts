/**
 * Make Charter's attestation keypair.
 *
 *     npm run keys:generate
 *
 * The PUBLIC half is written to keys/attestation.pub and belongs in the
 * repository, in the open. It is what lets anyone check our record without asking
 * us for anything.
 *
 * The PRIVATE half is printed here and nowhere else. Paste it into .env, which is
 * never committed. Nothing writes it to disk, so there is no stray copy to forget
 * about later.
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { generateKeyPair } from './attestation.js'

const PUBLIC_PATH = 'keys/attestation.pub'

function main(): void {
  const replacing = existsSync(PUBLIC_PATH)
  if (replacing && !process.argv.includes('--force')) {
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

  mkdirSync('keys', { recursive: true })
  writeFileSync(PUBLIC_PATH, publicKeyPem, 'utf8')

  console.log(`
Attestation keypair created.

  Key name   ${keyId}
  Public half written to ${PUBLIC_PATH}

The public half is meant to be committed. Publishing it is what makes our record
checkable by a stranger — a checker that read its key from the file it was
checking would prove nothing at all.

Put the private half in .env, on the ATTESTATION_PRIVATE_KEY line, as one line
with the newlines written as \\n. It is not saved anywhere else:

ATTESTATION_PRIVATE_KEY="${privateKeyPem.trimEnd().replace(/\n/g, '\\n')}"

Also add the key name to the readme, so anyone checking a packet can confirm the
key they were given is the one we published:

  ${keyId}
`)
}

main()
