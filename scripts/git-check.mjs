#!/usr/bin/env node
/**
 * What would go public?
 *
 * Run this before every commit. It answers one question: if this were pushed right
 * now, what would a stranger be able to read?
 *
 * It is deliberately paranoid, because the cost of the two mistakes is wildly
 * different. A false alarm costs ten seconds. A real secret pushed to a public
 * repository cannot be taken back — deleting it later leaves it in the history, in
 * forks, and in every cache that saw it.
 *
 * Five checks:
 *   1. Every real value in .env is searched for in every file git would publish.
 *   2. Generic secret shapes are searched for, in case something is not in .env.
 *   3. Files that would be added are compared against what we expect to publish.
 *   4. Large files are flagged, because they are usually something's output.
 *   5. The ignore rules are proved to actually work on the files that matter.
 *
 * Exits non-zero if anything looks wrong, so it can gate a commit.
 *
 * No dependencies on purpose — this must run before `npm install` does.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, statSync, existsSync } from 'node:fs'

const RED = '\x1b[31m', GREEN = '\x1b[32m', YELLOW = '\x1b[33m', DIM = '\x1b[2m', OFF = '\x1b[0m'

let problems = 0
const fail = (m) => { console.log(`${RED}  FAIL${OFF}  ${m}`); problems++ }
const warn = (m) => console.log(`${YELLOW}  WARN${OFF}  ${m}`)
const ok = (m) => console.log(`${GREEN}  ok${OFF}    ${m}`)

const git = (...args) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  } catch {
    return ''
  }
}

// Everything git would publish: already tracked, plus anything a `git add -A`
// would pick up. Ignored files are excluded by git itself, which is the point —
// we test the real rules rather than our belief about them.
const tracked = git('ls-files').split('\n').filter(Boolean)
const untracked = git('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean)
const wouldPublish = [...new Set([...tracked, ...untracked])]

console.log(`\n${DIM}Charter — what would go public${OFF}`)
console.log(`${DIM}${'─'.repeat(60)}${OFF}`)
console.log(`  ${tracked.length} tracked, ${untracked.length} would be added, ${wouldPublish.length} total\n`)

// ── 1. Real values from .env, searched for in everything publishable ──────────
// The names of these variables are public on purpose. The values never are.
const secrets = new Map()
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (!m) continue
    const [, name, raw] = m
    const value = raw.trim()
    // Short values are things like "true" or "test" and would match everywhere.
    // Anything at or above this length is a real credential shape.
    if (value.length >= 12) secrets.set(name, value)
  }
}

// Values that are in .env but are published on purpose in documentation, because
// they are not secrets: service addresses, a public OAuth client identifier, and
// the local development database string that exists so a stranger can run this.
const PUBLISHED_ON_PURPOSE = new Set([
  'DOCTAVIAN_BASE_URL', 'DOCTAVIAN_OAUTH_CLIENT_ID', 'DOCTAVIAN_OAUTH_SCOPE',
  'FOXIT_PDF_BASE_URL', 'FOXIT_ESIGN_BASE_URL', 'NAMECOM_BASE_URL_TEST',
  'DATABASE_URL', 'PUBLISH_DOMAIN_SUFFIX',
])

const readable = (f) => {
  try {
    if (statSync(f).size > 8 * 1024 * 1024) return ''
    return readFileSync(f, 'utf8')
  } catch { return '' }
}

const leaks = []
for (const file of wouldPublish) {
  const text = readable(file)
  if (!text) continue
  for (const [name, value] of secrets) {
    if (PUBLISHED_ON_PURPOSE.has(name)) continue
    if (text.includes(value)) leaks.push({ file, name })
  }
}
if (leaks.length) {
  for (const l of leaks) fail(`${l.file} contains the value of ${l.name}`)
} else {
  ok(`no value from .env appears in any publishable file (${secrets.size} checked)`)
}

// ── 2. Secret shapes, for anything that never went through .env ───────────────
const SHAPES = [
  // A real key has a body between its BEGIN and END lines. Requiring that body is
  // what separates an actual key from an error message or a comment that merely
  // names the header — and a check that cries wolf is one people learn to ignore,
  // which is worse than not having it.
  ['private key block', /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----\s+[A-Za-z0-9+/=\s]{40,}-----END/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Slack token', /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/],
  ['Stripe secret key', /\bsk_(?:live|test)_[0-9A-Za-z]{20,}\b/],
  ['bearer token', /\b[Bb]earer\s+[A-Za-z0-9._~+/-]{30,}/],
  // Only a QUOTED literal counts. `password: options.password` is a reference to
  // a field, not a secret, and flagging it teaches people to ignore this check —
  // which is worse than not having it, because they then ignore the real one too.
  ['password assignment', /(?:password|passwd|pwd)\s*[:=]\s*["'][^\s"'<>{}()[\]]{8,}["']/i],
  ['generic 32-char hex secret', /\b(?:key|token|secret|api[_-]?key)["']?\s*[:=]\s*["']?[0-9a-f]{32,}\b/i],
]
/**
 * Exact strings that look like a secret and are not one.
 *
 * Listed here rather than marked in the files they appear in, so the complete set
 * of exceptions can be read in one place. An exception scattered through the code
 * it excuses is an exception nobody audits.
 *
 * Each needs a reason. "It is only a test" is not one on its own — a real
 * credential pasted into a test is still a real credential.
 */
const NOT_ACTUALLY_SECRETS = [
  {
    // Wraps a key that is generated during the test, lives in memory, and is
    // thrown away when the test ends. There is nothing on the other side of it:
    // the key it protects never existed before the test began.
    text: "password: 'a-long-enough-password'",
    why: 'wraps a throwaway key generated inside the test itself',
  },
]

// The check script itself contains every pattern above by definition.
const shapeHits = []
for (const file of wouldPublish) {
  if (file === 'scripts/git-check.mjs') continue
  const text = readable(file)
  if (!text) continue
  for (const [label, re] of SHAPES) {
    const hit = re.exec(text)
    if (!hit) continue
    if (NOT_ACTUALLY_SECRETS.some((one) => hit[0].includes(one.text) || one.text.includes(hit[0]))) {
      continue
    }
    shapeHits.push({ file, label, sample: hit[0].slice(0, 28) })
  }
}
if (shapeHits.length) {
  for (const h of shapeHits) fail(`${h.file} looks like it holds a ${h.label} — "${h.sample}…"`)
} else {
  ok(`no secret-shaped strings found (${SHAPES.length} patterns)`)
}

// ── 3. Is everything we would publish something we meant to publish? ──────────
// An allowlist rather than a blocklist. A blocklist only stops what we predicted;
// an allowlist stops everything we did not think of, which is the dangerous set.
const EXPECTED = [
  /^README\.md$/, /^TOOLS\.md$/, /^LICENSE$/, /^\.gitignore$/, /^\.gitattributes$/,
  /^package(-lock)?\.json$/, /^tsconfig(\.[a-z]+)?\.json$/,
  /^vitest\.config\.ts$/, /^next\.config\.[cm]?[jt]s$/,
  /^src\//, /^tests?\//, /^scripts\//, /^public\//, /^migrations\//,
  /^\.github\//, /^keys\/[^/]+\.pub$/, /^keys\/README\.md$/, /^\.env\.example$/,
  /^fixtures\//, /^templates\//,

  // The website, and the files it invites a reader to check it against.
  //
  // index.html, charter.css, demo.js, panel.js and mark.svg are the page. demo.js
  // replays the run this repository ships; panel.js is the seventh tab, where a
  // visitor runs Charter on their own idea against whatever server is behind the
  // page. run.js and
  // run.json are the same run written twice, one for the page to read and one
  // for a person to download. The four type files are committed on purpose, so
  // the page needs nothing from anybody once it is open.
  //
  // record.jsonl, pack.pdf and attestation.json are copies of what the run left
  // in out/. They are here because the page tells a reader to check it against
  // them, and an invitation to check something that is not there is worse than
  // no invitation. They are rewritten by npm run site:data, never edited.
  /^site\/(index\.html|charter\.css|demo\.js|panel\.js|mark\.svg|llms\.txt)$/,
  // services.js is generated from src/vendors/who-does-what.ts by npm run
  // services, and the build fails if the page and the code disagree. It is
  // committed because the page must need nothing from anybody once it is open.
  /^site\/services\.js$/,
  // Screenshots of the page above, taken from a real run of it, shown in the
  // readme. Not mockups: the numbers in them came out of the run this
  // repository ships, and anybody can take the same pictures with npm run serve.
  /^site\/shots\/[a-z0-9-]+\.png$/,
  /^site\/run\.(js|json)$/,
  /^site\/(record\.jsonl|pack\.pdf|attestation\.json)$/,
  /^site\/fonts\/([a-z0-9-]+\.woff2|LICENSE\.md)$/,
]
const unexpected = wouldPublish.filter(f => !EXPECTED.some(re => re.test(f)))
if (unexpected.length) {
  warn(`${unexpected.length} file(s) would be published that are not on the expected list:`)
  for (const f of unexpected.slice(0, 25)) console.log(`          ${f}`)
  if (unexpected.length > 25) console.log(`          ${DIM}… and ${unexpected.length - 25} more${OFF}`)
  console.log(`        ${DIM}Either add them to EXPECTED in this script, or add them to .gitignore.${OFF}`)
} else {
  ok('every publishable file matches something we meant to publish')
}

// ── 4. Large files, which are almost always somebody's output ────────────────
const BIG = 512 * 1024
const large = wouldPublish
  .map(f => { try { return { f, size: statSync(f).size } } catch { return null } })
  .filter(x => x && x.size > BIG)
  .sort((a, b) => b.size - a.size)
if (large.length) {
  for (const { f, size } of large.slice(0, 10)) {
    warn(`${f} is ${(size / 1024).toFixed(0)} KB — is this meant to be in the repository?`)
  }
} else {
  ok(`nothing publishable is larger than ${BIG / 1024} KB`)
}

// ── 5. Prove the ignore rules work on the files that matter most ─────────────
const MUST_BE_IGNORED = [
  '.env', '.env.backup', '.env.local', '.env.prod', '.env.production',
  'private/anything.md', 'docs/decisions.md', 'CLAUDE.md', 'CHANGELOG.md',
  'node_modules/x', '.veris/state.db', 'linear-vars.txt',
  '.playwright-mcp/page.yml', 'tmp/scratch.pdf', 'keys/attestation.pem',
]
const notIgnored = MUST_BE_IGNORED.filter(p => {
  try {
    execFileSync('git', ['check-ignore', '-q', '--no-index', p], { stdio: 'ignore' })
    return false
  } catch { return true }
})
if (notIgnored.length) {
  for (const p of notIgnored) fail(`${p} is NOT ignored, and it must be`)
} else {
  ok(`all ${MUST_BE_IGNORED.length} must-never-publish paths are ignored`)
}

console.log(`${DIM}${'─'.repeat(60)}${OFF}`)
if (problems) {
  console.log(`${RED}  ${problems} problem(s). Do not commit until these are fixed.${OFF}\n`)
  process.exit(1)
}
console.log(`${GREEN}  Safe to commit.${OFF}\n`)
