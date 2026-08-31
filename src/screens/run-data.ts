/**
 * Turning one real run into the data the website replays.
 *
 * WHY THE WEBSITE IS FED FROM A REAL RUN AND NOT FROM A SCRIPT
 *
 * A marketing page can say anything. The moment it shows a number, a feed, or a
 * document, a reader has to decide whether to believe it, and most readers have
 * been trained by four hundred landing pages to assume it was typed in by hand.
 *
 * So nothing on Charter's website is typed in by hand. Every entry the visitor
 * scrolls through, every count, every fingerprint and every refusal is read out of
 * the append-only record of a run that really happened, and the same record is
 * downloadable beside the page so anybody can check one against the other.
 *
 * THE RULE THIS FILE ENFORCES
 *
 * If a number appears on the website, it was counted here. There is no path for a
 * hand-written figure to reach the page, because the page is handed this object
 * and nothing else.
 *
 * WHAT IS DELIBERATELY LEFT OUT
 *
 * Identity values. The record holds which fields were read and which a person
 * checked, and this carries those. It does not carry a date of birth or a document
 * number, because a website is the last place either belongs and a rule that only
 * holds while somebody remembers it is not a rule.
 */

import { genesisHash, hashEvent, type ChainedEvent } from '../record/chain.js'
import { fingerprint } from '../record/canonical.js'

/** One entry of the record, as the website shows it. */
export interface RunEntry {
  /**
   * Which run this belongs to.
   *
   * Repeated on every entry rather than written once at the top, because it is
   * part of what gets fingerprinted. A reader who wants to recompute an entry's
   * fingerprint needs it here, beside the entry, and not somewhere else in the
   * file that they have to trust applies.
   */
  readonly runId: string
  readonly seq: string
  readonly kind: string
  /** `human`, `model`, `system` or `vendor`. */
  readonly actor: string
  readonly stage: string | null
  /** When it happened. This is the `ts` that goes into the fingerprint. */
  readonly at: string
  /** The first twelve characters of this entry's fingerprint. Enough to compare. */
  readonly fingerprint: string
  /** One line a person reads. */
  readonly detail: string
  /** True when this entry is something being refused. */
  readonly refusal: boolean
  /** Set on the entries a person caused, saying what they had to do. */
  readonly humanAct?: HumanAct

  // ---- the chain itself, so a reader can check it rather than believe it -----
  //
  // WHY THE FULL FINGERPRINTS ARE HERE AND NOT JUST THE SHORT ONE
  //
  // The website says the record is tamper-evident, and then invites a visitor to
  // alter an entry and watch the check fail. That check is a real one: it takes
  // the fingerprint of the altered detail, rebuilds that entry's own fingerprint
  // from its header, and walks every link from the first entry to the last.
  //
  // None of that can be done from a twelve-character abbreviation. Without these
  // four fields the page could only draw a picture of a check happening, which is
  // the one thing this project must never do.

  /** The fingerprint of this entry's detail. Sixty-four characters. */
  readonly payloadHash: string
  /** The fingerprint of the entry before this one. Sixty-four characters. */
  readonly prevHash: string
  /** This entry's own fingerprint. Sixty-four characters. */
  readonly hash: string
  /**
   * The entry's detail, exactly as it was written.
   *
   * Carried so the page can recompute `payloadHash` itself. Identity VALUES are
   * never in here, because the record never held them: it holds which fields were
   * read and which a person checked. `complaintsAbout` looks anyway, and refuses
   * to let the file be written if anything shaped like one turns up.
   */
  readonly payload: Record<string, unknown> | null
}

/**
 * One of the moments the software could not get past on its own.
 *
 * These are the product. Each one is something the software cannot do for itself,
 * none of them has a tool, and the code that writes them is not reachable from
 * anything the model can trigger.
 */
export interface HumanAct {
  /** What the person is being asked to do, on the button. */
  readonly button: string
  /** Why the software cannot do it, in one sentence. */
  readonly why: string
  /** What the software had asked for, when it asked. */
  readonly asked?: string
}

export interface RunStage {
  readonly name: string
  readonly position: number
  readonly title: string
  readonly whatHappens: string
  /** The tools offered in this stage. Empty for stage seven, on purpose. */
  readonly tools: readonly string[]
  /** The first and last entry numbers belonging to this stage. */
  readonly from: string
  readonly to: string
}

/** One article of the ownership agreement, as the page prints it. */
export interface RunArticle {
  readonly number: number
  /** The heading without its number. */
  readonly heading: string
  /** The heading as the document prints it, number and all. */
  readonly fullHeading: string
  /** Why this article exists, in plain words. The document's own sentence. */
  readonly why: string
}

/** One question the checker asked, and what it answered. */
export interface RunFinding {
  readonly question: string
  readonly answer: 'yes' | 'no' | 'cannot say'
  readonly detail: string
}

export interface RunData {
  readonly caseId: string
  readonly businessName: string
  readonly state: string
  readonly owners: readonly string[]
  readonly entries: readonly RunEntry[]
  readonly stages: readonly RunStage[]
  readonly counts: Readonly<Record<string, number>>
  readonly totalEntries: number
  /** Every refusal in the run, with its reason. */
  readonly refusals: readonly { readonly seq: string; readonly kind: string; readonly why: string }[]
  readonly pack?: {
    readonly fingerprint: string
    readonly sizeBytes: string
    readonly permissionLevel: string
    readonly parts: readonly string[]
    /**
     * The words actually in the sealed file, one list per page.
     *
     * Read back out of the bytes rather than written again, so the page shows a
     * reader the document itself. A browser that will not render a PDF in place
     * would otherwise leave the most important artifact on the site as a blank
     * rectangle.
     */
    readonly pages: readonly (readonly string[])[]
  }
  /** The name the owners first chose, and the one they ended with. */
  readonly naming?: {
    readonly firstChoice: string
    readonly collidedWith: string
    readonly settledOn: string
  }
  /** Which addresses were tried, and what happened to each. */
  readonly addresses: readonly {
    readonly domain: string
    readonly outcome: 'taken' | 'too dear' | 'registered'
    readonly priceCents?: string
  }[]
  /** The records sent to the registrar, and what it handed back. */
  readonly records: {
    readonly sent: readonly { readonly host: string; readonly kind: string; readonly answer: string }[]
    readonly held: readonly { readonly host: string; readonly kind: string; readonly answer: string }[]
    readonly match: boolean
  }
  /** What each owner's document produced. Field names only, never values. */
  readonly identity: readonly {
    readonly owner: string
    readonly fieldsRead: string
    readonly sentToAPerson: readonly { readonly field: string; readonly reasons: readonly string[] }[]
  }[]
  readonly agreement?: {
    readonly articleCount: number
    /** Every article, from the same code that wrote the document on disk. */
    readonly articles: readonly RunArticle[]
    /** The "How decisions are made" paragraphs, exactly as the document prints them. */
    readonly decisions: readonly string[]
    readonly dated: string
    readonly ordinaryVote: string
    readonly majorVote: string
    readonly deadlockPossible: boolean
    readonly explanation: readonly string[]
  }
  /** The words that would have drawn the storefront picture. The owners' own. */
  readonly storefront?: { readonly fromWords: string; readonly shape: string }
  readonly site?: { readonly liveAt: string }
  /**
   * Which outside services were real in this run and which stood in.
   *
   * `company` and `host` come from the credential catalogue in `settings.ts`, so
   * the page names a company only where a credential for that company exists.
   * `company` is null for the one that is not built, and the page says so instead
   * of naming somebody who was not involved.
   */
  readonly services: readonly {
    readonly name: string
    readonly kind: string
    readonly why: string
    readonly company: string | null
    readonly host: string
  }[]
  /** Whether anybody outside Charter vouched for when this record existed. */
  readonly anchor: string
  readonly generatedAt: string

  // ---- what a reader needs to check the record without trusting anybody ------

  /**
   * Where this run's chain begins.
   *
   * Not a row of zeroes. It is derived from the run, so entries belonging to one
   * run cannot be spliced into another. The page recomputes it and compares.
   */
  readonly genesis: string
  /**
   * The signed statement about where the record ended, if one was made.
   *
   * The proof and the key are deliberately absent. A visitor needs to know that a
   * statement exists and what it covers. Handing them the signature over a public
   * page would let anybody replay it, and it proves nothing they could check here
   * anyway, because checking it needs the published key and the record file.
   */
  readonly attestation?: {
    readonly head: string
    readonly count: string
    readonly keyId: string
  }
  /** How many tests this project runs. Counted by running them, never typed. */
  readonly tests: number
  /**
   * What `npm run verify` answered, on this pack and this record.
   *
   * The page prints these questions in the checker's own words and its own order,
   * including the ones it cannot answer. Writing them out again on the page would
   * be a second copy able to drift from the code that does the checking.
   */
  readonly verify: {
    readonly findings: readonly RunFinding[]
    readonly cannotProve: readonly string[]
  }
}

/**
 * The six moments a person has to act, and what each one is.
 *
 * Keyed by the entry kind a person's act produces. Written here rather than
 * guessed from the record, because the words a visitor reads on a button are
 * copy and copy is not something to derive.
 *
 * The list is checked against the run: a kind here that never appears, or a
 * human-caused entry whose kind is not here, fails the build. So it cannot fall
 * out of step with what actually happens.
 */
export const HUMAN_ACTS: Readonly<Record<string, HumanAct>> = {
  'question.answered': {
    button: 'Answer',
    why:
      'The software asked something it has no safe default for. It will not guess, ' +
      'and it will not carry on until somebody answers.',
  },
  'spend.authorised': {
    button: 'Allow up to $25.00',
    why:
      'The software can ask to spend. It has no tool that grants permission, and the ' +
      'code that writes one is not reachable from anything it can trigger.',
  },
  'identity.field.checked': {
    button: 'I checked this against the document',
    why:
      'A value read off an identity document could only be matched approximately. ' +
      'Nothing in the software can clear that. A person looks, or the case waits.',
  },
  'signature.approved': {
    button: 'Approve sending the packet',
    why:
      'This is the boundary. Stage seven has no tools at all, and the packet does ' +
      'not move until a person names it by its fingerprint and approves.',
  },
}

/** Whether an entry is something being refused. */
export function isRefusal(kind: string): boolean {
  return kind.includes('refused') || kind.includes('rejected') || kind.includes('abandoned')
}

const asText = (payload: Record<string, unknown> | null, field: string): string => {
  const value = payload?.[field]
  return typeof value === 'string' ? value : ''
}

const asList = (payload: Record<string, unknown> | null, field: string): readonly string[] => {
  const value = payload?.[field]
  return Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : []
}

/**
 * Read one run into the shape the website replays.
 *
 * `describe` is the same function the running agent uses for its own feed, passed
 * in rather than written again here. Two describers would drift, and the website
 * would eventually say something about an entry that the run never said.
 */
export function readRun(input: {
  readonly caseId: string
  readonly events: readonly ChainedEvent[]
  readonly payloadOf: (seq: string) => Record<string, unknown> | null
  readonly describe: (kind: string, payload: Record<string, unknown>) => string
  readonly stages: readonly RunStage[]
  readonly businessName: string
  readonly state: string
  readonly owners: readonly string[]
  readonly services: readonly {
    readonly name: string
    readonly kind: string
    readonly why: string
    readonly company: string | null
    readonly host: string
  }[]
  readonly anchor: string
  readonly generatedAt: string
  /** Where this run's chain begins, worked out from the run itself. */
  readonly genesis: string
  /** The signed statement over the end of the record. Never its signature. */
  readonly attestation?: { readonly head: string; readonly count: string; readonly keyId: string }
  /** How many tests this project runs. Counted by running them. */
  readonly tests: number
  /** What the checker answered, in its own words. */
  readonly verify: {
    readonly findings: readonly RunFinding[]
    readonly cannotProve: readonly string[]
  }
  /** The words in the sealed packet, one list per page, read out of the bytes. */
  readonly packPages: readonly (readonly string[])[]
  /** Every article of the agreement, from the code that wrote the document. */
  readonly articles: readonly RunArticle[]
  /** The "How decisions are made" paragraphs, as the document prints them. */
  readonly decisions: readonly string[]
}): RunData {
  const entries: RunEntry[] = []
  const counts: Record<string, number> = {}
  const refusals: { seq: string; kind: string; why: string }[] = []
  const addresses: { domain: string; outcome: 'taken' | 'too dear' | 'registered'; priceCents?: string }[] = []
  const identity: {
    owner: string
    fieldsRead: string
    sentToAPerson: { field: string; reasons: readonly string[] }[]
  }[] = []

  let pack: RunData['pack']
  let naming: RunData['naming']
  let agreement: RunData['agreement']
  let storefront: RunData['storefront']
  let site: RunData['site']
  let recordsSent: readonly { host: string; kind: string; answer: string }[] = []
  let recordsHeld: readonly { host: string; kind: string; answer: string }[] = []
  let recordsMatch = false

  // The name the owners first wrote down, so a change of name can be shown as a
  // change rather than as a fact that was always true.
  let firstName = ''
  let collidedWith = ''

  for (const event of input.events) {
    const payload = input.payloadOf(event.seq)
    const kind = event.kind

    counts[event.actor] = (counts[event.actor] ?? 0) + 1

    const refusal = isRefusal(kind)
    if (refusal) {
      refusals.push({
        seq: event.seq,
        kind,
        why: asText(payload, 'why') || input.describe(kind, payload ?? {}),
      })
    }

    const humanAct = event.actor === 'human' ? HUMAN_ACTS[kind] : undefined

    entries.push({
      runId: event.runId,
      seq: event.seq,
      kind,
      actor: event.actor,
      stage: event.stage,
      at: event.ts,
      fingerprint: event.hash.slice(0, 12),
      detail: input.describe(kind, payload ?? {}),
      refusal,
      ...(humanAct === undefined ? {} : { humanAct }),
      payloadHash: event.payloadHash,
      prevHash: event.prevHash,
      hash: event.hash,
      payload,
    })

    // ---- the facts the page shows beside the feed ---------------------------

    if (kind === 'fact.recorded' && asText(payload, 'about') === 'proposed_name') {
      const value = asText(payload, 'value')
      if (firstName === '') firstName = value
      else naming = { firstChoice: firstName, collidedWith, settledOn: value }
    }

    if (kind === 'names.compared' && asText(payload, 'verdict') === 'collides') {
      const rows = payload?.['comparisons']
      if (Array.isArray(rows)) {
        const hit = rows.find(
          (row) =>
            typeof row === 'object' &&
            row !== null &&
            (row as Record<string, unknown>)['closeness'] !== 'different',
        )
        collidedWith =
          typeof hit === 'object' && hit !== null
            ? String((hit as Record<string, unknown>)['foundName'] ?? '')
            : ''
      }
    }

    if (kind === 'address.checked') {
      const domain = asText(payload, 'domain')
      const available = payload?.['available']
      if (available === false) addresses.push({ domain, outcome: 'taken' })
    }

    if (kind === 'address.registration.refused') {
      const domain = asText(payload, 'domain')
      const already = addresses.find((one) => one.domain === domain)
      if (already === undefined) {
        addresses.push({
          domain,
          outcome: 'too dear',
          ...(asText(payload, 'priceCents') === '' ? {} : { priceCents: asText(payload, 'priceCents') }),
        })
      }
    }

    if (kind === 'address.registered') {
      addresses.push({
        domain: asText(payload, 'domain'),
        outcome: 'registered',
        priceCents: asText(payload, 'chargedCents'),
      })
    }

    if (kind === 'address.records.written') {
      const rows = payload?.['records']
      if (Array.isArray(rows)) {
        recordsSent = rows.map((row) => ({
          host: String((row as Record<string, unknown>)['host'] ?? ''),
          kind: String((row as Record<string, unknown>)['kind'] ?? ''),
          answer: String((row as Record<string, unknown>)['answer'] ?? ''),
        }))
      }
    }

    if (kind === 'address.records.listed') {
      const rows = payload?.['held']
      if (Array.isArray(rows)) {
        recordsHeld = rows.map((row) => ({
          host: String((row as Record<string, unknown>)['host'] ?? ''),
          kind: String((row as Record<string, unknown>)['kind'] ?? ''),
          answer: String((row as Record<string, unknown>)['answer'] ?? ''),
        }))
      }
      recordsMatch = payload?.['matchesWhatWasSent'] === true
    }

    if (kind === 'identity.read') {
      identity.push({
        owner: asText(payload, 'owner'),
        fieldsRead: asText(payload, 'fieldsRead'),
        sentToAPerson: [],
      })
    }

    if (kind === 'identity.field.sent.for.review') {
      const owner = asText(payload, 'owner')
      const found = identity.find((one) => one.owner === owner)
      // Field NAMES and the reasons. Never the value that was read, because a
      // website is the last place an identity value belongs.
      found?.sentToAPerson.push({
        field: asText(payload, 'field'),
        reasons: asList(payload, 'reasons'),
      })
    }

    if (kind === 'agreement.drafted') {
      agreement = {
        articleCount: Number(asText(payload, 'articleCount')) || 0,
        articles: input.articles,
        decisions: input.decisions,
        dated: asText(payload, 'dated'),
        ordinaryVote: asText(payload, 'ordinaryVote'),
        majorVote: asText(payload, 'majorVote'),
        deadlockPossible: payload?.['deadlockPossible'] === true,
        explanation: asList(payload, 'explanation'),
      }
    }

    if (kind === 'pack.sealed') {
      pack = {
        fingerprint: asText(payload, 'fingerprint'),
        sizeBytes: asText(payload, 'sizeBytes'),
        permissionLevel: asText(payload, 'permissionLevel'),
        parts: asList(payload, 'parts'),
        pages: input.packPages,
      }
    }

    if (kind === 'storefront.drawn') {
      storefront = { fromWords: asText(payload, 'fromWords'), shape: asText(payload, 'shape') }
    }

    if (kind === 'site.published') {
      site = { liveAt: asText(payload, 'liveAt') }
    }
  }

  return {
    caseId: input.caseId,
    businessName: input.businessName,
    state: input.state,
    owners: input.owners,
    entries,
    stages: input.stages,
    counts,
    totalEntries: entries.length,
    refusals,
    ...(pack === undefined ? {} : { pack }),
    ...(naming === undefined ? {} : { naming }),
    addresses,
    records: { sent: recordsSent, held: recordsHeld, match: recordsMatch },
    identity,
    ...(agreement === undefined ? {} : { agreement }),
    ...(storefront === undefined ? {} : { storefront }),
    ...(site === undefined ? {} : { site }),
    genesis: input.genesis,
    ...(input.attestation === undefined ? {} : { attestation: input.attestation }),
    tests: input.tests,
    verify: input.verify,
    services: input.services,
    anchor: input.anchor,
    generatedAt: input.generatedAt,
  }
}

/**
 * Check the run against what the website promises about it.
 *
 * Every complaint here is a place where the page would say something the run did
 * not do. Raised as a list rather than one at a time, and the generator refuses to
 * write the file while any of them stands.
 *
 * This is the whole reason the site can be trusted: it is not that somebody was
 * careful, it is that the file cannot be written otherwise.
 */
export function complaintsAbout(run: RunData): readonly string[] {
  const complaints: string[] = []

  const humanEntries = run.entries.filter((one) => one.actor === 'human')
  if (humanEntries.length === 0) {
    complaints.push('No entry in this run was caused by a person, and the page is about the ones that are.')
  }
  for (const entry of humanEntries) {
    if (entry.humanAct === undefined) {
      complaints.push(
        `Entry ${entry.seq} was caused by a person and "${entry.kind}" is not in HUMAN_ACTS, so the ` +
          `page would have nothing to put on the button.`,
      )
    }
  }
  for (const kind of Object.keys(HUMAN_ACTS)) {
    if (!run.entries.some((one) => one.kind === kind)) {
      complaints.push(`HUMAN_ACTS names "${kind}", and no entry in this run has that kind.`)
    }
  }

  if (run.refusals.length === 0) {
    complaints.push('Nothing was refused in this run, and the refusals are the interesting list.')
  }
  if (run.pack === undefined) {
    complaints.push('No pack was sealed, so the page has no finished document to point at.')
  }
  if (run.pack !== undefined && run.pack.permissionLevel !== '2') {
    complaints.push(
      `The pack was sealed at permission level ${run.pack.permissionLevel}. The page says level 2, ` +
        `which is filling in and signing and nothing else.`,
    )
  }
  if (run.naming === undefined) {
    complaints.push(
      'The name never changed in this run. The page shows a live search changing the decision, and ' +
        'that has to have happened.',
    )
  }
  if (!run.addresses.some((one) => one.outcome === 'taken')) {
    complaints.push('No address came back taken. The page shows the unhappy path, and it has to be real.')
  }
  if (!run.addresses.some((one) => one.outcome === 'registered')) {
    complaints.push('No address was registered, so there is nothing to point anywhere.')
  }
  if (run.records.sent.length === 0) {
    complaints.push('No address records were written, so the registered name points nowhere.')
  }
  if (run.records.held.length === 0) {
    complaints.push('The records were never read back, so "accepted" was never separated from "stored".')
  }
  if (run.identity.length === 0) {
    complaints.push('No identity document was read.')
  }
  if (!run.identity.some((one) => one.sentToAPerson.length > 0)) {
    complaints.push('Nothing was sent to a person to check, and that rule is a large part of the page.')
  }

  // ---- the chain, rechecked from the file the page is actually handed --------
  //
  // WHY THIS IS CHECKED AGAIN HERE
  //
  // The page invites a visitor to alter an entry and watch the check fail. That
  // only means anything if the check passes to begin with, on the exact data the
  // page holds rather than on the record file it was read from. Something
  // reshaping an entry on the way out would leave a page whose tamper control
  // reports a break the moment it loads, and a stranger would rightly conclude
  // the whole thing is theatre.
  //
  // So the chain is walked once more here, on `run.entries`, with the same
  // functions the record itself uses. Nothing else in this file recomputes a
  // fingerprint, and this is the reason.

  if (!/^[0-9a-f]{64}$/.test(run.genesis)) {
    complaints.push(
      `The starting fingerprint of the chain is "${run.genesis}", which is not a fingerprint. ` +
        `The page recomputes it and would report a break on the first entry.`,
    )
  }

  const runIds = new Set(run.entries.map((one) => one.runId))
  if (runIds.size > 1) {
    complaints.push(
      `The entries name ${runIds.size} different runs (${[...runIds].join(', ')}). A chain ` +
        `belongs to one run, and the page would be replaying two things at once.`,
    )
  }

  const runId = run.entries[0]?.runId ?? ''
  if (runId !== '' && run.genesis !== genesisHash(runId)) {
    complaints.push(
      `The starting fingerprint does not match run "${runId}". It was worked out from a ` +
        `different run, so the first link would not join.`,
    )
  }

  let expectedPrev = run.genesis
  let brokeAt = ''
  for (const entry of run.entries) {
    if (brokeAt !== '') break

    if (fingerprint(entry.payload ?? {}) !== entry.payloadHash) {
      brokeAt = `entry ${entry.seq}: its detail does not produce the fingerprint stored beside it`
      break
    }
    if (entry.prevHash !== expectedPrev) {
      brokeAt = `entry ${entry.seq}: it points back at an entry that is not the one before it`
      break
    }
    const shouldBe = hashEvent(
      {
        runId: entry.runId,
        seq: entry.seq,
        ts: entry.at,
        kind: entry.kind,
        actor: entry.actor as ChainedEvent['actor'],
        stage: entry.stage,
        payloadHash: entry.payloadHash,
      },
      entry.prevHash,
    )
    if (shouldBe !== entry.hash) {
      brokeAt = `entry ${entry.seq}: its own fingerprint is not the one its header produces`
      break
    }
    expectedPrev = entry.hash
  }
  if (brokeAt !== '') {
    complaints.push(
      `The chain in the data handed to the page does not hold: ${brokeAt}. The page lets a ` +
        `visitor break the record on purpose, which only means something when it is whole ` +
        `to begin with.`,
    )
  }

  if (run.attestation !== undefined && run.attestation.head !== expectedPrev && brokeAt === '') {
    complaints.push(
      `The attestation vouches for a record ending "${run.attestation.head.slice(0, 12)}" and ` +
        `this record ends "${expectedPrev.slice(0, 12)}". One of the two is not about the other.`,
    )
  }
  if (run.attestation !== undefined && run.attestation.count !== String(run.entries.length)) {
    complaints.push(
      `The attestation vouches for ${run.attestation.count} entries and the page holds ` +
        `${run.entries.length}. The page shows exactly this comparison as a demonstration, ` +
        `and it must start out agreeing.`,
    )
  }

  // ---- everything else the page prints and cannot make up -------------------

  if (run.tests <= 0) {
    complaints.push(
      'The page prints how many tests this project runs, and the count came back as ' +
        `${run.tests}. That number is produced by running them, so a zero means they did not run.`,
    )
  }

  if (run.verify.findings.length === 0) {
    complaints.push(
      'The checker produced no findings, and a whole section of the page is its output ' +
        'printed in its own words.',
    )
  }
  for (const finding of run.verify.findings) {
    if (finding.answer === 'no') {
      complaints.push(
        `The checker answered no to "${finding.question}" (${finding.detail}). The page shows ` +
          `this run as one that checks out, and it does not.`,
      )
    }
  }
  if (run.verify.cannotProve.length === 0) {
    complaints.push(
      'The checker listed nothing it cannot prove. The page prints that list at full size ' +
        'beside the answers, because a check that appeared to prove everything would be the ' +
        'least trustworthy thing on the page.',
    )
  }

  if (run.agreement === undefined) {
    complaints.push('No agreement was drafted, and the page shows the document it wrote.')
  } else {
    if (run.agreement.articles.length === 0) {
      complaints.push(
        'The agreement section has no articles to print, so the page would describe a ' +
          'document it cannot show.',
      )
    }
    if (run.agreement.articles.length !== run.agreement.articleCount) {
      complaints.push(
        `The run recorded ${run.agreement.articleCount} articles and ${run.agreement.articles.length} ` +
          `were handed to the page. The page would print a different document from the one on disk.`,
      )
    }
    if (run.agreement.decisions.length === 0) {
      complaints.push(
        'The agreement section prints how decisions are made, in the document\'s own words, ' +
          'and none were handed to it.',
      )
    }
  }

  for (const service of run.services) {
    if (service.company === null && service.kind === 'real') {
      complaints.push(
        `The service "${service.name}" was real in this run and no company is named for it. ` +
          `A real call went somewhere, and the page would not say where.`,
      )
    }
  }

  const stageSeven = run.stages.find((one) => one.position === 7)
  if (stageSeven === undefined) {
    complaints.push('There is no seventh stage, and the page is built around its emptiness.')
  } else if (stageSeven.tools.length > 0) {
    complaints.push(
      `Stage seven offers ${stageSeven.tools.join(', ')}. The page says it has no tools at all, and ` +
        `its emptiness is the design.`,
    )
  }

  // Identity values must never reach the page. Checked by looking, not by trusting.
  //
  // Targeted at the two things that would actually be one, rather than at anything
  // date-shaped: a document date is an ordinary part of an agreement and appears
  // all over a run, while a date of BIRTH and a document NUMBER are the two values
  // a website has no business carrying.
  const everything = JSON.stringify(run)
  const looksLikeAnIdentityValue: readonly { readonly shape: RegExp; readonly what: string }[] = [
    // A year somebody could have been born in. A document dated in one of these
    // would be a document older than this project's subject matter.
    { shape: /\b(?:19\d{2}|200\d|201[0-5])-\d{2}-\d{2}\b/, what: 'a date of birth' },
    // A letter and seven digits, which is the shape of every passport number in
    // this project's own recorded documents.
    { shape: /\b[A-Z]\d{7}\b/, what: 'a document number' },
  ]

  for (const one of looksLikeAnIdentityValue) {
    const found = one.shape.exec(everything)
    if (found !== null) {
      complaints.push(
        `Something shaped like ${one.what} ("${found[0]}") is in the data the page is handed. ` +
          `A website is the last place one belongs.`,
      )
    }
  }

  return complaints
}
