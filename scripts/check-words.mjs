/**
 * Check that this project does not use the words it said it would never use.
 *
 *     npm run words:check
 *
 * WHY A PROJECT WOULD BOTHER
 *
 * Charter's whole argument rests on saying only things it can back up. A few
 * specific words break that no matter how carefully the sentence around them is
 * written, and they are exactly the words that turn up when somebody is tired and
 * reaching for a phrase that sounds strong.
 *
 * The two that matter most:
 *
 * **"Immutable" and "tamper-proof" claim prevention.** Charter detects that a
 * record was changed; it does not stop anybody changing it. Claiming prevention is
 * a claim the code cannot back, and the published standards use "evident" for
 * exactly this reason. The honest words are "append-only" and "tamper-evident".
 *
 * **"Signature" is reserved for what a person does.** The machine puts a SEAL on a
 * document it made, and an ATTESTATION over its own record. A project whose entire
 * argument is that software never signs for a human cannot describe its own output
 * as a signature and expect to be believed. Anywhere the code, the screens or the
 * writing breaks that, it is a bug.
 *
 * WHY IT IS A CHECK RATHER THAN A RULE PEOPLE REMEMBER
 *
 * A rule written in a document is followed until the day somebody is in a hurry. A
 * rule the build enforces is followed on that day too. This is the same reasoning
 * that put the tool boundary in a test rather than in a policy.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not try to judge whether a sentence is good. It looks for specific words
 * and specific phrasings. Anything cleverer would produce false alarms, and a check
 * that cries wolf is a check people switch off.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const OFF = '\x1b[0m'

/**
 * What is looked for, and why each one is a problem.
 *
 * `pattern` must have the `g` and `i` flags so every occurrence on a line is found.
 */
const RULES = [
  {
    pattern: /\bimmutable\b/gi,
    // Set on the rules where saying the word in order to forbid it is the whole
    // point of the sentence. See `isDenial` below.
    deniable: true,
    why: 'claims prevention. Charter detects modification; it does not prevent it',
    instead: '"append-only"',
  },
  {
    pattern: /\btamper[- ]?proof\b/gi,
    deniable: true,
    why: 'claims prevention. The published standards say "evident" for this reason',
    instead: '"tamper-evident"',
  },
  {
    pattern: /\bAI[- ]co-?founder\b/gi,
    deniable: true,
    why: 'overclaims what this is',
    instead: '"makes your business legally alive"',
  },
  {
    pattern: /\bstartup[- ]in[- ]a[- ]box\b/gi,
    deniable: true,
    why: 'overclaims what this is',
    instead: '"prepares everything around the government filing"',
  },
  {
    pattern: /\bwe incorporate your\b/gi,
    why: 'Charter does not file with the government; it prepares everything around that',
    instead: '"prepares everything around the government filing"',
  },
  {
    pattern: /\blegal advice\b/gi,
    deniable: true,
    why: 'this project never gives it, and saying the words invites the reading',
    instead: 'say what was checked and what was not',
  },
  {
    // The machine act is a SEAL. This catches the specific phrasings where
    // something other than a person is the one doing the signing.
    pattern: /\b(?:charter|the agent|the system|the software|our agent|it|we)\s+signs?\b/gi,
    deniable: true,
    why: 'describes a machine signing. The machine seals; only a person signs',
    instead: '"seals" for a document, "attests" for our own record',
  },
  {
    pattern: /\bagent (?:will |can |may )?sign(?:s|ed|ing)?\b/gi,
    deniable: true,
    why: 'describes a machine signing. The machine seals; only a person signs',
    instead: '"seals" for a document, "attests" for our own record',
  },
  {
    // The NOUN, used for something a machine produced. This was missing until 30
    // August, which meant the checker passed clean while the code called the
    // machine's own attestation "the signature" in five places — including in text
    // printed to a person.
    //
    // Deliberately narrow. It looks for the word attached to a machine subject or
    // to our own record, not for every use of it: the project talks about human
    // signatures constantly and has to be able to.
    pattern:
      /\b(?:the|its|our|a)\s+signature\s+(?:over|of)\s+(?:our|the|its)\s+(?:own\s+)?(?:record|log|chain|attestation)/gi,
    deniable: true,
    why: 'calls a machine act a signature. What the machine puts over its own record is an attestation',
    instead: '"attestation"',
  },
  {
    // The other shape: a machine subject producing one.
    pattern: /\b(?:charter|the agent|the system|the software|the machine)\s+(?:makes|creates|produces|applies|adds)\s+(?:a|its|the)\s+signature/gi,
    deniable: true,
    why: 'calls a machine act a signature. The machine seals documents and attests over its own record',
    instead: '"seal" for a document, "attestation" for our own record',
  },
  {
    pattern: /\bco-?authored-by\b/gi,
    why: 'nothing here carries a tool’s name. A person is responsible for this work',
    instead: 'nothing',
  },
  {
    pattern: /\bgenerated with\b/gi,
    why: 'nothing here carries a tool’s name. A person is responsible for this work',
    instead: 'nothing',
  },
]

/**
 * Is this occurrence a DENIAL — a sentence saying the thing does not happen?
 *
 * This project has to say these words in order to forbid them. "Charter signs
 * nothing for anybody" and "we never say immutable" both contain the exact text
 * being looked for, and both are the sentence doing the right thing.
 *
 * Reporting those would be a check that cries wolf, and a check that cries wolf
 * gets switched off — at which point it stops catching the real ones too. So a
 * match sitting near a negation is left alone.
 *
 * THE LIMIT, SAID OUT LOUD. This would also miss a genuinely wrong sentence that
 * happens to contain a negation nearby, such as "the agent signs, not the human."
 * That is a real gap. It is accepted because the alternative is a check nobody
 * runs, and because that sentence is not one somebody writes by accident — the
 * failures this is built for are the tired reach for a strong-sounding word.
 */
function isDenial(line, at, before = '', after = '') {
  // The line before and after are included because prose wraps. A sentence like
  // "the difference between helping someone prepare a document and giving legal
  // advice" is one thought split across two lines, and a check that reads one line
  // at a time sees only the second half — which looks exactly like the thing it is
  // distancing itself from.
  const around = (before + ' ' + line.slice(Math.max(0, at - 70), at + 70) + ' ' + after).toLowerCase()
  return /\b(?:never|nothing|not|no|cannot|can't|won't|refus|avoid|forbid|outside|difference between|distinct from|instead of|rather than|do not|does not|is not|are not)\b/.test(
    around,
  )
}

/**
 * Lines allowed to break a rule, because they are the line that states the rule.
 *
 * Every one is listed here rather than marked in the file itself, so the complete
 * set of exceptions can be read in one place. A rule with exceptions scattered
 * through the files it governs is a rule nobody can audit.
 *
 * A line matches if it CONTAINS the text below. Kept long and specific so an
 * exception cannot quietly widen.
 */
const ALLOWED = [
  // The readme's own table defining the three words.
  'Two words are never used',
  'The record is',
  '| **Signature** | What a **person** does',
  // CLAUDE.md states the rules, so it must quote them.
  'Never write "immutable" or "tamper-proof."',
  'Never write: "AI cofounder"',
  'Instead write: "makes your business legally alive"',
  'Do not write "only humans sign what binds them"',
  '**Machine acts on documents are "seals."',
  // The files whose job is to hold the list of forbidden words. A list of
  // forbidden words necessarily contains the forbidden words.
  "  const banned = [",
  "    'immutable',",
  "    'tamper-proof',",
  "    'tamperproof',",
  "    'AI cofounder',",
  "    'AI co-founder',",
  "    'startup-in-a-box',",
  "    'legal advice',",
]

/** Files that exist to state the rules, so they may quote them freely. */
const RULE_FILES = ['scripts/check-words.mjs', 'CLAUDE.md', 'tests/readme.test.ts']

/** Every file worth checking: everything tracked by git, plus the internal docs. */
function filesToCheck() {
  const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .split('\n')
    .map((one) => one.trim())
    .filter((one) => one.length > 0)

  const internal = []
  const walk = (directory) => {
    if (!existsSync(directory)) return
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry).replace(/\\/g, '/')
      if (statSync(path).isDirectory()) walk(path)
      else internal.push(path)
    }
  }
  walk('docs')
  if (existsSync('CLAUDE.md')) internal.push('CLAUDE.md')

  const readable = /\.(ts|tsx|js|mjs|cjs|md|json|sql|yml|yaml|txt|example)$/
  return [...new Set([...tracked, ...internal])].filter(
    (one) => readable.test(one) && existsSync(one) && !one.includes('package-lock'),
  )
}

const findings = []

for (const file of filesToCheck()) {
  const lines = readFileSync(file, 'utf8').split('\n')
  const isPublic = !file.startsWith('docs/') && file !== 'CLAUDE.md'


  if (RULE_FILES.includes(file)) continue

  lines.forEach((line, index) => {
    if (ALLOWED.some((allowed) => line.includes(allowed))) return

    for (const rule of RULES) {
      rule.pattern.lastIndex = 0
      let match
      while ((match = rule.pattern.exec(line)) !== null) {
        if (
          rule.deniable &&
          isDenial(line, match.index, lines[index - 1] ?? '', lines[index + 1] ?? '')
        ) {
          continue
        }
        findings.push({
          file,
          line: index + 1,
          text: match[0],
          why: rule.why,
          instead: rule.instead,
          isPublic,
          context: line.trim().slice(0, 100),
        })
      }
    }
  })
}

console.log('')
console.log(`${BOLD}Charter — the words we said we would never use${OFF}`)
console.log(`${DIM}${'─'.repeat(70)}${OFF}`)

if (findings.length === 0) {
  console.log(`${GREEN}  ok${OFF}    none of them appear, in ${filesToCheck().length} files`)
  console.log(`${DIM}${'─'.repeat(70)}${OFF}`)
  console.log('')
  process.exit(0)
}

const publicFindings = findings.filter((one) => one.isPublic)
const internalFindings = findings.filter((one) => !one.isPublic)

for (const [label, group] of [
  ['IN PUBLIC FILES', publicFindings],
  ['in internal documents', internalFindings],
]) {
  if (group.length === 0) continue
  console.log('')
  console.log(`  ${label} — ${group.length}`)
  for (const one of group) {
    console.log('')
    console.log(`    ${RED}${one.text}${OFF}  ${DIM}${one.file}:${one.line}${OFF}`)
    console.log(`      ${one.context}`)
    console.log(`      ${YELLOW}${one.why}${OFF}`)
    console.log(`      ${DIM}instead: ${one.instead}${OFF}`)
  }
}

console.log('')
console.log(`${DIM}${'─'.repeat(70)}${OFF}`)
console.log(
  `${RED}  ${findings.length} to fix${OFF}` +
    (publicFindings.length > 0 ? `, ${publicFindings.length} of them in files that go public` : ''),
)
console.log('')
process.exit(1)
