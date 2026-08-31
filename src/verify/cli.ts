/**
 * The check anybody can run against a finished pack.
 *
 *     npm run verify -- <pack.pdf> <record.jsonl> [attestation.json]
 *
 * WHAT IT IS
 *
 * Somebody is handed a Formation Pack and the record of everything Charter did to
 * produce it. This tells them, in a few seconds, whether either can be believed.
 *
 * It asks Charter for nothing, contacts nothing, and reads no setting. The public
 * key it checks the attestation against comes from this repository — never from
 * the pack, because a checker that took its key out of the thing it was checking
 * would prove nothing at all.
 *
 * WHY IT PRINTS WHAT IT CANNOT PROVE
 *
 * The certificate that seals the pack is issued by us, to us. No outside authority
 * has vouched for who we are, and any PDF reader will say the same. Printing that
 * ourselves is the stronger position: it is a limit a careful reader would find
 * anyway, and a project that names its own limits reads very differently from one
 * that has to be caught.
 */

import { readFileSync, existsSync } from 'node:fs'
import type { ChainedEvent } from '../record/chain.js'
import type { Attestation } from '../record/attestation.js'
import {
  describeVerification,
  packFingerprintFromRecord,
  verifyEverything,
} from './check.js'

const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const OFF = '\x1b[0m'

const HELP = `
${BOLD}Charter — check a pack without trusting us${OFF}

  npm run verify -- <pack.pdf> <record.jsonl> [attestation.json]

  pack.pdf          the Formation Pack, exactly as you received it
  record.jsonl      the record of the run, one entry per line
  attestation.json  optional. Vouches for the END of the record, which the
                    chain cannot do on its own — a shortened chain is still a
                    valid chain.

  --key <file>      optional. Check the attestation against this public key
                    instead of the one committed to this repository.

                    Use it when somebody handed you a key SEPARATELY from the
                    pack. Never take a key out of the pack itself: anybody could
                    invent a key, vouch for anything with it, and ship both
                    together, and a checker that accepted that would prove
                    nothing at all. Which key was used is printed below every
                    time, so nobody has to remember which one they chose.

Everything is checked on your machine. Nothing is sent anywhere.
`

function readRecord(path: string): { events: ChainedEvent[]; payloads: Map<string, Record<string, unknown>> } {
  const events: ChainedEvent[] = []
  const payloads = new Map<string, Record<string, unknown>>()

  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const text = line.trim()
    if (text === '') continue

    let entry: ChainedEvent & { payload?: Record<string, unknown> | null }
    try {
      entry = JSON.parse(text)
    } catch {
      throw new Error(`${path} has a line that is not readable as one record entry:\n  ${text.slice(0, 120)}`)
    }

    // The payload travels beside the entry rather than inside what is
    // fingerprinted, because a payload can be forgotten at somebody's request
    // while the entry itself stays and the chain still holds.
    if (entry.payload !== undefined && entry.payload !== null) {
      payloads.set(entry.seq, entry.payload)
    }
    const { payload: _ignored, ...event } = entry
    events.push(event as ChainedEvent)
  }

  return { events, payloads }
}

const argv = process.argv.slice(2)

/**
 * A key the person running this chose, handed to them separately from the pack.
 *
 * Optional, and the default matters more than the option: without it, the key
 * comes from this repository. A checker that read its key out of the thing it was
 * checking would prove nothing at all, so the key never comes from the pack —
 * whichever of the two is used is printed every time.
 */
const chosenKey = ((): string | undefined => {
  const at = argv.indexOf('--key')
  return at === -1 ? undefined : argv[at + 1]
})()

const args = argv.filter(
  (one, at) => !one.startsWith('-') && argv[at - 1] !== '--key',
)

if (args.length < 2) {
  console.log(HELP)
  process.exit(args.length === 0 ? 0 : 1)
}

const [packPath, recordPath, attestationPath] = args as [string, string, string | undefined]

for (const path of [packPath, recordPath]) {
  if (!existsSync(path)) {
    console.error(`${RED}There is no file at ${path}.${OFF}`)
    process.exit(1)
  }
}

const pack = new Uint8Array(readFileSync(packPath))
const { events, payloads } = readRecord(recordPath)

if (events.length === 0) {
  console.error(`${RED}${recordPath} holds no entries, so there is nothing to check.${OFF}`)
  process.exit(1)
}

const attestation: Attestation | undefined =
  attestationPath !== undefined && existsSync(attestationPath)
    ? (JSON.parse(readFileSync(attestationPath, 'utf8')) as Attestation)
    : undefined

const publicKeyPath = chosenKey ?? 'keys/attestation.pub'
if (!existsSync(publicKeyPath)) {
  console.error(
    `${RED}${publicKeyPath} is missing.${OFF}\n` +
      `That key is what makes this check worth running: it comes from the repository\n` +
      `rather than from the pack, so nobody can vouch for a pack with a key they\n` +
      `shipped alongside it.`,
  )
  process.exit(1)
}

const result = verifyEverything({
  pack,
  events,
  runId: events[0]?.runId ?? '',
  attestation,
  publicKeyPem: readFileSync(publicKeyPath, 'utf8'),
  recordedPackFingerprint: packFingerprintFromRecord(
    events,
    (event) => payloads.get(event.seq) ?? null,
  ),
})

console.log('')
console.log(`${BOLD}Charter — checking a pack${OFF}`)
console.log(`${DIM}${'─'.repeat(72)}${OFF}`)
console.log(`  pack    ${packPath}   ${pack.length} bytes`)
console.log(`  record  ${recordPath}   ${events.length} entries`)
console.log(
  `  key     ${publicKeyPath}   ${DIM}${
    chosenKey === undefined
      ? 'from this repository, never from the pack'
      : 'you chose this key. It did not come from the pack'
  }${OFF}`,
)
console.log(`${DIM}${'─'.repeat(72)}${OFF}`)
console.log('')
console.log(describeVerification(result))
console.log(`${DIM}${'─'.repeat(72)}${OFF}`)

if (result.ok) {
  console.log(`${GREEN}  Everything that could be checked, checks out.${OFF}`)
} else {
  console.log(`${RED}  Something does not hold. See the lines marked NO above.${OFF}`)
}
console.log('')

process.exit(result.ok ? 0 : 1)
