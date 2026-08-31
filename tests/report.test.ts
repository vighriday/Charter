/**
 * Proving the page a person opens says what happened, and never says what to do.
 *
 * WHAT THIS PAGE IS
 *
 * One HTML file, written at the end of a run, opened by double-clicking it. No
 * server, no build step, no framework, and nothing fetched from anywhere.
 * Everything on it is read out of the append-only record that run produced, and
 * the same record is handed over beside it, so anybody can check one against the
 * other.
 *
 * THE TWO TESTS THAT MATTER MOST
 *
 * The first is the one that reads every line of the legal section and requires a
 * source on each. This project has already been legally wrong in three documents
 * at once. A claim with no statute or case behind it is exactly how that happened,
 * and the only defence that keeps working is a check that fails the build.
 *
 * The second is the one that looks for the sentences this project has said it will
 * never write again. "You wrote nothing, so the state decides for you" is a legal
 * error: Texas makes an oral or implied agreement a company agreement. The true
 * version is worse and simpler — your deal becomes a thing you must prove, and
 * people lose everything doing that.
 */

import { describe, expect, it } from 'vitest'
import {
  ACTOR_MEANING,
  WHAT_CAN_BE_CHECKED,
  WHAT_THE_LAW_DOES,
  escape,
  isRefusal,
  renderReport,
  type FeedEntry,
  type ReportContents,
} from '../src/screens/report.js'

const entries: readonly FeedEntry[] = [
  {
    seq: '1',
    kind: 'stage.entered',
    actor: 'system',
    stage: 'understand',
    at: '2026-08-28T09:00:00.000Z',
    detail: 'moved to understand',
  },
  {
    seq: '2',
    kind: 'question.answered',
    actor: 'human',
    stage: 'understand',
    at: '2026-08-28T09:01:00.000Z',
    detail: 'a person answered',
  },
  {
    seq: '3',
    kind: 'tool.refused',
    actor: 'system',
    stage: 'address',
    at: '2026-08-28T09:02:00.000Z',
    detail: 'refused register_address — the price is above the permission',
  },
  {
    seq: '4',
    kind: 'model.answered',
    actor: 'model',
    stage: 'address',
    at: '2026-08-28T09:03:00.000Z',
    detail: 'chose check_address',
  },
  {
    seq: '5',
    kind: 'address.checked',
    actor: 'vendor',
    stage: 'address',
    at: '2026-08-28T09:04:00.000Z',
    detail: 'the registrar answered',
  },
]

const contents: ReportContents = {
  caseId: 'demo-bakery',
  businessName: 'Rivera Sisters Bakery',
  state: 'Texas',
  owners: ['Ana Rivera', 'Lucia Rivera'],
  entries,
  pack: { fingerprint: 'a'.repeat(64), sizeBytes: '17745' },
  anchor: 'Not attempted, because REPLAY_MODE is true.',
  services: ['search     stand-in  Saved answers.'],
  generatedAt: '2026-08-28T09:05:00.000Z',
}

const page = renderReport(contents)

/**
 * The same page with its line breaks collapsed.
 *
 * The page wraps its sentences wherever the source happens to end a line, so a
 * test looking for a phrase should not fail because the phrase crossed a line
 * break. Anything about the FILE itself — that it fetches nothing, that it carries
 * its own styling — is tested against the real thing above.
 */
const said = page.replace(/\s+/g, ' ')

// ─────────────────────────────────────────────────────────────────────────────
// The legal section
// ─────────────────────────────────────────────────────────────────────────────

describe('what Texas law does if nothing is written down', () => {
  it('gives every single line a statute or a case', () => {
    // This project has already been legally wrong in three documents at once. A
    // claim with no source behind it is exactly how that happened, and the only
    // defence that keeps working is one that fails the build.
    for (const line of WHAT_THE_LAW_DOES) {
      expect(line.source.trim(), line.says).not.toBe('')
      expect(line.says.trim(), 'a line with no claim').not.toBe('')
      expect(line.detail.trim(), line.says).not.toBe('')
    }
  })

  it('cites the section that says an owner may not withdraw', () => {
    expect(page).toContain('101.107')
  })

  it('cites the case that says no Texas court will invent a way out', () => {
    expect(page).toContain('Ritchie v. Rupe')
  })

  it('cites both cases where proving a spoken deal failed completely', () => {
    // Not a trim. Total loss, of a claimed one third, twice. That is the injury,
    // and it is worse and simpler to state than any arithmetic.
    expect(page).toContain('Sohani')
    expect(page).toContain('Chase v. Hodge')
  })

  it('says plainly that this is information and not advice', () => {
    expect(said).toMatch(/not legal advice/)
    expect(said).toMatch(/which split to choose/)
  })

  it('never says the state decides for you', () => {
    // A legal error. Texas makes an oral or implied agreement a company agreement,
    // and a company agreement can displace almost every default in the title.
    expect(page.toLowerCase()).not.toContain('the state decides')
    expect(page.toLowerCase()).not.toContain('state decides for you')
  })

  it('says instead that a spoken deal becomes a thing you must prove', () => {
    expect(said).toMatch(/would have to prove|must prove|have to prove/)
  })

  it('puts no arithmetic on the page about what a share becomes', () => {
    // "The 60/40 becomes 62.5/37.5" was wrong three separate ways, and it is the
    // wrong size of harm besides. Nobody destroys a family over two and a half
    // percentage points.
    expect(page).not.toMatch(/62\.5/)
  })

  it('quotes no figure for how often any of this happens', () => {
    // There is no such figure and inventing one would be the easiest thing on the
    // page to disprove.
    expect(page).not.toMatch(/\b\d+% of (businesses|partnerships|companies)/i)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The feed
// ─────────────────────────────────────────────────────────────────────────────

describe('everything that happened, and who caused it', () => {
  it('lists every entry', () => {
    for (const entry of entries) {
      expect(page, entry.kind).toContain(entry.kind)
    }
  })

  it('names who caused each one', () => {
    for (const actor of ['human', 'model', 'system', 'vendor']) {
      expect(page, actor).toContain(actor)
    }
  })

  it('explains what each of the four actors means, in plain words', () => {
    for (const [actor, meaning] of Object.entries(ACTOR_MEANING)) {
      if (!entries.some((one) => one.actor === actor)) continue
      expect(said, actor).toContain(escape(meaning).replace(/\s+/g, ' '))
    }
  })

  it('counts the entries a person caused, and says they had no tool', () => {
    expect(said).toMatch(/1 entry was caused by a person/)
    expect(said).toMatch(/none of them has a tool/)
  })

  it('pulls the refusals into their own list', () => {
    expect(isRefusal('tool.refused')).toBe(true)
    expect(isRefusal('identity.read.refused')).toBe(true)
    expect(isRefusal('turn.abandoned')).toBe(true)
    expect(isRefusal('tool.ran')).toBe(false)

    expect(page).toContain('What Charter was asked to do, and would not')
    expect(page).toContain('the price is above the permission')
  })

  it('says why a list of refusals is the interesting one', () => {
    expect(said).toMatch(/Most software ships a list of what it can do/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// What it claims, and what it does not
// ─────────────────────────────────────────────────────────────────────────────

describe('what can be checked and what cannot', () => {
  it('prints the things that cannot be shown as well as the things that can', () => {
    expect(WHAT_CAN_BE_CHECKED.some((one) => !one.can)).toBe(true)
    for (const one of WHAT_CAN_BE_CHECKED) {
      expect(said).toContain(escape(one.what).replace(/\s+/g, ' '))
    }
  })

  it('says the certificate is issued by Charter to Charter', () => {
    expect(said).toMatch(/issued by Charter to Charter/)
  })

  it('prints the pack fingerprint so it can be compared', () => {
    expect(page).toContain('a'.repeat(64))
  })

  it('says whether an outside authority stamped the record', () => {
    expect(said).toContain(escape(contents.anchor))
  })

  it('says which outside services were real in this run', () => {
    expect(page).toContain('stand-in')
  })

  it('gives the command that checks the files beside it', () => {
    expect(page).toContain('npm run verify')
  })
})

describe('the line the software will not cross', () => {
  it('says Charter did not sign, and cannot', () => {
    expect(said).toMatch(/did not sign anything, and it is not able to/)
  })

  it('states the law correctly rather than as a slogan', () => {
    // The law lets software FORM a contract. What it does not let software do is
    // sign. Getting that backwards is a claim a well-read judge would catch.
    expect(said).toMatch(/lets software form a contract/)
    expect(said).toMatch(/with the intent to sign/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The file itself
// ─────────────────────────────────────────────────────────────────────────────

describe('the page as a file', () => {
  it('fetches nothing from anywhere', () => {
    // A page that loaded a stylesheet or a font would stop looking right the
    // moment somebody opened it without a network, which is exactly the situation
    // this project promises to work in.
    expect(page).not.toMatch(/<script/i)
    expect(page).not.toMatch(/<link[^>]+href/i)
    expect(page).not.toMatch(/https?:\/\/(?!schema)/)
  })

  it('carries its own styling, so it looks the same everywhere', () => {
    expect(page).toContain('<style>')
  })

  it('works in a dark browser as well as a light one', () => {
    expect(page).toContain('prefers-color-scheme: dark')
  })

  it('reads on a phone as well as a laptop', () => {
    expect(page).toContain('width=device-width')
  })

  it('says when it was written and from which case', () => {
    expect(page).toContain('demo-bakery')
    expect(page).toContain(contents.generatedAt)
  })

  it('says nothing on it was fetched', () => {
    expect(said).toMatch(/No part of this page was fetched/)
  })
})

describe('text that arrives from a record cannot break the page', () => {
  it('escapes anything that looks like markup', () => {
    expect(escape('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    )
    expect(escape('a & b')).toBe('a &amp; b')
    expect(escape('say "this"')).toBe('say &quot;this&quot;')
  })

  it('escapes a business name somebody chose badly', () => {
    // The name comes from what a person typed. A page that pasted it in unescaped
    // would be a page anybody could put anything into.
    const nasty = renderReport({
      ...contents,
      businessName: '<img src=x onerror=alert(1)>',
    })
    expect(nasty).not.toContain('<img src=x')
    expect(nasty).toContain('&lt;img src=x')
  })

  it('escapes a detail line that came out of the record', () => {
    const nasty = renderReport({
      ...contents,
      entries: [{ ...(entries[0] as FeedEntry), detail: '</table><script>x</script>' }],
    })
    expect(nasty).not.toContain('<script>x</script>')
  })
})

describe('a run that did not get far', () => {
  it('says no pack was sealed rather than printing an empty one', () => {
    const { pack: _dropped, ...withoutPack } = contents
    const page = renderReport(withoutPack)
    expect(page).toContain('No pack was sealed in this run')
  })

  it('says nothing was refused rather than showing an empty heading', () => {
    const page = renderReport({
      ...contents,
      entries: entries.filter((one) => !isRefusal(one.kind)),
    })
    expect(page).toContain('Nothing was refused in this run')
  })
})
