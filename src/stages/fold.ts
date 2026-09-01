/**
 * Reading the record forward into what Charter knows.
 *
 * WHY THE SUMMARY IS ALWAYS REBUILT AND NEVER KEPT
 *
 * Charter holds no running summary of a case. Every time it needs to know
 * something, it reads the record from the first entry to the last and folds it
 * into a plain value. That sounds wasteful and is the opposite.
 *
 * **A run survives anything.** A closed browser tab, a machine restarting, a crash
 * in the middle of stage three: none of them lose a thing, because nothing was
 * being held in the first place. The record is on disk and rebuilding takes
 * milliseconds.
 *
 * **The summary cannot drift from the truth.** There is no second place where what
 * Charter knows is stored, so there is no possibility of two places disagreeing.
 * A stored summary and an append-only record will eventually differ, and the
 * moment they do, one of them is lying and nothing says which.
 *
 * **What Charter believes is auditable.** Every fact traces to an entry that has a
 * fingerprint, a position in a chain, and something that caused it. "Why did it
 * think the state was Texas?" has an exact answer.
 *
 * WHY UNKNOWN ENTRIES ARE PASSED OVER RATHER THAN REFUSED
 *
 * A record written by a later version of Charter will hold entry kinds this code
 * has never heard of. Refusing to read such a record would make every past run
 * unreadable the first time a new kind of entry is added, which would defeat the
 * point of keeping a permanent record at all. Anything unrecognised is passed over
 * and the rest is read.
 *
 * The same applies within an entry: a payload missing the field this code expects
 * is skipped rather than crashing. A record is read by things that check it,
 * including things a stranger runs, and a checker that stops at the first surprise
 * checks nothing.
 *
 * THE ONE ENTRY NO TOOL CAN WRITE
 *
 * `spend.authorised` is a person granting permission to spend, in their browser.
 * It is read here, and it is written by ordinary code on a path the model is not
 * on. There is no tool that produces it. That is what stops a model authorising
 * itself and then spending under its own permission — not a rule it is asked to
 * follow, but the absence of anything to call.
 */

import type { JsonObject, JsonValue } from '../record/canonical.js'
import {
  emptyCase,
  type CaseFacts,
  type IdentityCheck,
  type Owner,
  type PossibleCollision,
  type SearchPerformed, type WrittenRecord } from './facts.js'

/** One entry as the fold sees it: what kind it is, and what it carried. */
export interface RecordedEntry {
  readonly kind: string
  readonly payload: JsonObject | null
}

const asText = (payload: JsonObject, field: string): string | undefined => {
  const value = payload[field]
  return typeof value === 'string' ? value : undefined
}

const asFlag = (payload: JsonObject, field: string): boolean | undefined => {
  const value = payload[field]
  return typeof value === 'boolean' ? value : undefined
}

/** A list of plain text lines, skipping anything that is not text. */
/**
 * Read a list of address records out of an entry.
 *
 * Anything that is not shaped like a record is dropped rather than guessed at. A
 * half-read record compared against a whole one would report a mismatch that is
 * ours rather than the registrar's.
 */
const asRecords = (payload: JsonObject, field: string): readonly WrittenRecord[] => {
  const value = payload[field]
  if (!Array.isArray(value)) return []

  const out: WrittenRecord[] = []
  for (const row of value) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) continue
    const one = row as JsonObject
    const kind = asText(one, 'kind')
    const answer = asText(one, 'answer')
    if (kind === undefined || answer === undefined) continue
    out.push({
      host: asText(one, 'host') ?? '',
      kind,
      answer,
      ttl: asText(one, 'ttl') ?? '',
    })
  }
  return out
}

const asTextList = (payload: JsonObject, field: string): readonly string[] => {
  const value = payload[field]
  return Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : []
}

const asRows = (payload: JsonObject, field: string): JsonObject[] => {
  const value = payload[field]
  if (!Array.isArray(value)) return []
  return value.filter(
    (row): row is JsonObject => typeof row === 'object' && row !== null && !Array.isArray(row),
  )
}

/**
 * Fold a case's entries into what is known.
 *
 * The entries must be in the order they were written, which is the order the
 * record keeps them in. Order matters: a later answer replaces an earlier one, and
 * that is how somebody correcting themselves works.
 */
export function foldFacts(caseId: string, entries: readonly RecordedEntry[]): CaseFacts {
  let facts = emptyCase(caseId)

  // Built up as we go, then attached once, so the returned value has no partly
  // filled sections.
  const searches: SearchPerformed[] = []
  let collisions: readonly PossibleCollision[] = []
  let verdict: 'clear' | 'collides' | 'needs-a-person' | undefined
  const owners: Owner[] = []
  const openQuestions: string[] = []
  const answers: { question: string; answer: string }[] = []
  const identityChecks: IdentityCheck[] = []
  let addressRecords: readonly WrittenRecord[] = []
  let addressRecordsHeld: readonly WrittenRecord[] = []

  for (const entry of entries) {
    // A forgotten payload is a real state: personal details can be cleared from
    // the record while the entry itself stays, so the chain still checks out. A
    // fold that crashed on one would make forgetting break every past run.
    const payload = entry.payload
    if (payload === null) continue

    switch (entry.kind) {
      case 'fact.recorded': {
        const about = asText(payload, 'about')
        const value = asText(payload, 'value')
        if (about === undefined || value === undefined) break
        if (about === 'description') facts = { ...facts, description: value }
        else if (about === 'state') facts = { ...facts, state: value.toUpperCase() }
        else if (about === 'proposed_name') facts = { ...facts, proposedName: value }
        else if (about === 'owner') {
          const contribution = asText(payload, 'contribution') ?? ''
          const already = owners.findIndex((owner) => owner.name === value)

          if (already === -1) {
            owners.push({ name: value, contribution })
          } else {
            // MERGED, not replaced. Somebody correcting an owner's description must
            // not silently delete their share and the value of what they put in,
            // which were written down by separate entries. Replacing the whole
            // record here made the agreement refuse to draft with "no share has
            // been recorded", naming a person whose share had been recorded.
            //
            // An empty contribution means the argument was absent rather than that
            // somebody meant to erase what they said, so it is left alone.
            const previous = owners[already] as Owner
            owners[already] = {
              ...previous,
              name: value,
              contribution: contribution === '' ? previous.contribution : contribution,
            }
          }
        } else if (about === 'owner_share' || about === 'owner_contribution_value') {
          // These two attach to an owner already written down. An owner nobody
          // has recorded yet is not created here: a share belonging to a person
          // whose name was never given is a share nobody can check.
          const whose = asText(payload, 'owner')
          if (whose === undefined) break
          const at = owners.findIndex((owner) => owner.name === whose)
          if (at === -1) break
          const owner = owners[at] as Owner
          owners[at] =
            about === 'owner_share'
              ? { ...owner, sharePercent: value }
              : { ...owner, contributionCents: value }
        }
        break
      }

      case 'question.asked': {
        const question = asText(payload, 'question')
        if (question !== undefined && !openQuestions.includes(question)) openQuestions.push(question)
        break
      }

      case 'question.answered': {
        const question = asText(payload, 'question')
        if (question === undefined) break
        const at = openQuestions.indexOf(question)
        if (at !== -1) openQuestions.splice(at, 1)
        // Kept with its answer, because two terms of the ownership agreement may
        // only be written down when a person was asked and replied, and that
        // cannot be checked against a list of questions still outstanding.
        answers.push({ question, answer: asText(payload, 'answer') ?? '' })
        break
      }

      case 'agreement.choice.recorded': {
        const which = asText(payload, 'which')
        const value = asText(payload, 'value')
        if (which === undefined || value === undefined) break
        const choices = facts.agreementChoices ?? {}
        if (which === 'managed_by' && (value === 'the owners themselves' || value === 'an appointed manager')) {
          facts = { ...facts, agreementChoices: { ...choices, managedBy: value } }
        } else if (which === 'exit_process') {
          facts = { ...facts, agreementChoices: { ...choices, hasExitProcess: value === 'yes' } }
        }
        break
      }

      case 'identity.read': {
        const owner = asText(payload, 'owner')
        const fieldsRead = asText(payload, 'fieldsRead')
        const depth = asText(payload, 'depth')
        if (owner === undefined || fieldsRead === undefined || depth === undefined) break
        // A later reading of the same owner replaces the earlier one. Somebody
        // uploading a clearer photograph of the same passport is the ordinary
        // case, and two entries for one person would double the review queue.
        const already = identityChecks.findIndex((one) => one.owner === owner)
        const check: IdentityCheck = {
          owner,
          fieldsRead,
          depth,
          toReview: asTextList(payload, 'toReview'),
          missing: asTextList(payload, 'missing'),
          // A fresh reading of the same document starts the checking over. A
          // person who confirmed a value on an older, blurrier photograph has not
          // confirmed the value on this one.
          checkedByAPerson: [],
        }
        if (already === -1) identityChecks.push(check)
        else identityChecks[already] = check
        break
      }

      case 'identity.field.checked': {
        // Only a person writes this. A value confirmed correct leaves the review
        // queue; a value confirmed WRONG stays in it, because the case must not
        // move on from a document somebody has just said is wrong.
        const owner = asText(payload, 'owner')
        const field = asText(payload, 'field')
        const found = asText(payload, 'found')
        if (owner === undefined || field === undefined) break
        const at = identityChecks.findIndex((one) => one.owner === owner)
        if (at === -1) break
        const check = identityChecks[at] as IdentityCheck
        // A field the document never produced cannot be confirmed. There is
        // nothing to confirm. Leaving it in the queue is not stubbornness: the only
        // thing that fixes a missing value is a document that has it, and an answer
        // of "correct" about a value nobody has read is either a mistake or
        // somebody clicking through.
        if (check.missing.includes(field)) break

        // Recorded whichever way they answered. A value a person looked at and
        // said was WRONG stays in the queue and is still a value somebody looked
        // at, and the finished pack has to be able to say so.
        const looked = check.checkedByAPerson.includes(field)
          ? check.checkedByAPerson
          : [...check.checkedByAPerson, field]

        identityChecks[at] = {
          ...check,
          checkedByAPerson: looked,
          toReview:
            found === 'the value is correct'
              ? check.toReview.filter((one) => one !== field)
              : check.toReview,
        }
        break
      }

      case 'pack.sealed': {
        const fingerprintValue = asText(payload, 'fingerprint')
        const sizeBytes = asText(payload, 'sizeBytes')
        if (fingerprintValue === undefined || sizeBytes === undefined) break
        facts = {
          ...facts,
          pack: {
            fingerprint: fingerprintValue,
            sizeBytes,
            refusedAfterSealing: asTextList(payload, 'refusedAfterSealing'),
          },
        }
        break
      }

      case 'pack.operation.refused': {
        // Kept with the pack it belongs to, so the finished document can print
        // what Charter was asked to do after sealing and would not.
        const why = asText(payload, 'why')
        const current = facts.pack
        if (why === undefined || current === undefined) break
        facts = {
          ...facts,
          pack: { ...current, refusedAfterSealing: [...current.refusedAfterSealing, why] },
        }
        break
      }

      case 'signature.approved': {
        const approvedBy = asText(payload, 'approvedBy')
        const packFingerprint = asText(payload, 'packFingerprint')
        const approvedAt = asText(payload, 'approvedAt')
        if (approvedBy === undefined || packFingerprint === undefined || approvedAt === undefined) {
          break
        }
        facts = { ...facts, approvalToSend: { approvedBy, packFingerprint, approvedAt } }
        break
      }

      case 'site.published': {
        const address = asText(payload, 'address')
        const liveAt = asText(payload, 'liveAt')
        if (address === undefined || liveAt === undefined) break
        facts = { ...facts, site: { address, liveAt } }
        break
      }

      case 'agreement.drafted': {
        const articleCount = asText(payload, 'articleCount')
        const dated = asText(payload, 'dated')
        if (articleCount === undefined || dated === undefined) break
        facts = {
          ...facts,
          agreement: {
            articleCount,
            dated,
            blocks: asTextList(payload, 'blocks'),
            explanation: asTextList(payload, 'explanation'),
          },
        }
        break
      }

      case 'spend.requested': {
        const limitCents = asText(payload, 'limitCents')
        const forWhat = asText(payload, 'forWhat')
        if (limitCents === undefined || forWhat === undefined) break
        facts = {
          ...facts,
          spendRequested: { limitCents, forWhat, sinceLastPermission: true },
        }
        break
      }

      // Written by a person in their browser, never by any tool. See the note at
      // the top of this file.
      case 'spend.authorised': {
        const limitCents = asText(payload, 'limitCents')
        const forWhat = asText(payload, 'forWhat')
        const grantedAt = asText(payload, 'grantedAt')
        if (limitCents === undefined || forWhat === undefined || grantedAt === undefined) break
        // WHAT IS ALREADY SPENT CARRIES FORWARD. It is not reset.
        //
        // A second permission is an ordinary path, not a hypothetical one: when a
        // price is above what is left, the spending rule refuses with the words "a
        // person has to raise the limit before this can run", and nothing stops a
        // person granting again.
        //
        // Starting the count at zero each time would let a raised limit be spent in
        // full a second time, so £25 granted twice would permit £50 of spending
        // while every screen showed a £25 limit. Money already gone is gone.
        facts = {
          ...facts,
          // Whatever was being asked for has now been answered. A later request
          // sets this back to true and stops the run again, which is how a limit
          // that turned out to be too low gets raised.
          ...(facts.spendRequested === undefined
            ? {}
            : {
                spendRequested: { ...facts.spendRequested, sinceLastPermission: false },
              }),
          spendAuthorisation: {
            limitCents,
            forWhat,
            grantedAt,
            spentCents: facts.spendAuthorisation?.spentCents ?? '0',
          },
        }
        break
      }

      case 'spend.applied': {
        const spentAfter = asText(payload, 'spentCentsAfter')
        const existing = facts.spendAuthorisation
        if (spentAfter === undefined || existing === undefined) break
        facts = { ...facts, spendAuthorisation: { ...existing, spentCents: spentAfter } }
        break
      }

      case 'search.performed': {
        const query = asText(payload, 'query')
        const resultCount = asText(payload, 'resultCount')
        const answeredBy = asText(payload, 'answeredBy')
        if (query === undefined) break
        searches.push({
          query,
          resultCount: resultCount ?? '0',
          answeredBy: answeredBy ?? 'unrecorded',
          // The titles, so that what the search learned is part of what is known
          // rather than only part of what was written down.
          found: asRows(payload, 'results')
            .map((row) => asText(row, 'title') ?? '')
            .filter((title) => title !== ''),
        })
        break
      }

      // A person settling a name the comparison called close. Read AFTER the
      // comparison in the same pass, because the record is read forward and a
      // person's decision comes after the comparison that prompted it — so it wins
      // simply by being later, which is also how a person changing their mind
      // works.
      case 'name.decided': {
        const decided = asText(payload, 'verdict')
        if (decided === 'clear' || decided === 'collides') verdict = decided
        break
      }

      case 'names.compared': {
        const found = asText(payload, 'verdict')
        if (found === 'clear' || found === 'collides' || found === 'needs-a-person') {
          verdict = found
        }
        collisions = asRows(payload, 'comparisons').flatMap((row): PossibleCollision[] => {
          const foundName = asText(row, 'foundName')
          const closeness = asText(row, 'closeness')
          if (foundName === undefined) return []
          const comparedAs = row['comparedAs']
          const pair =
            typeof comparedAs === 'object' && comparedAs !== null && !Array.isArray(comparedAs)
              ? comparedAs
              : {}
          return [
            {
              foundName,
              where: 'the live web',
              closeness:
                closeness === 'exact' ||
                closeness === 'same-after-tidying' ||
                closeness === 'close'
                  ? closeness
                  : 'different',
              comparedAs: {
                proposed: asText(pair as JsonObject, 'proposed') ?? '',
                found: asText(pair as JsonObject, 'found') ?? '',
              },
            },
          ]
        })
        break
      }

      case 'address.checked': {
        const domain = asText(payload, 'domain')
        if (domain === undefined) break
        const available = asFlag(payload, 'available')
        const priceCents = asText(payload, 'priceCents')
        facts = {
          ...facts,
          address: {
            candidate: domain,
            ...(available === undefined ? {} : { available }),
            ...(priceCents === undefined ? {} : { priceCents }),
          },
        }
        break
      }

      case 'address.registered': {
        const domain = asText(payload, 'domain')
        if (domain === undefined) break
        const existing = facts.address
        facts = {
          ...facts,
          address:
            existing !== undefined && existing.candidate === domain
              ? { ...existing, registered: true }
              : { candidate: domain, available: true, registered: true },
        }
        break
      }

      case 'address.records.written': {
        // What was SENT. Kept separately from what the registrar hands back,
        // because comparing the two is the only way to find out whether the
        // registrar stored what it accepted.
        addressRecords = asRecords(payload, 'records')
        break
      }

      case 'address.records.listed': {
        addressRecordsHeld = asRecords(payload, 'held')
        break
      }

      case 'storefront.drawn': {
        const url = asText(payload, 'url')
        const fromWords = asText(payload, 'fromWords')
        if (url === undefined || fromWords === undefined) break
        facts = {
          ...facts,
          storefront: {
            url,
            shape: asText(payload, 'shape') ?? '',
            fromWords,
            drawnBy: asText(payload, 'drawnBy') ?? '',
          },
        }
        break
      }

      default:
        // An entry kind this version has never heard of. Passed over on purpose.
        break
    }
  }

  if (searches.length > 0 || verdict !== undefined) {
    // The verdict is left out when nothing has been compared yet, rather than
    // defaulting to anything. Defaulting it to "a person should look" made a run
    // stop and wait before there was anything for a person to look at.
    facts = {
      ...facts,
      nameResearch: { searches, collisions, ...(verdict === undefined ? {} : { verdict }) },
    }
  }

  return {
    ...facts,
    owners,
    openQuestions,
    answers,
    identityChecks,
    addressRecords,
    addressRecordsHeld,
  }
}

/**
 * The situation, written for the model at the start of a turn.
 *
 * Deliberately short. Everything here is sent again on every turn of the stage,
 * and there is a hard ceiling on request size that exists so the fallback provider
 * stays usable at all. A summary that grows without limit is the thing that
 * quietly breaks a run halfway through.
 */
/**
 * How many of the answers a person gave are repeated back to the model each turn.
 *
 * Every turn of a stage sends this whole summary again, and there is a hard ceiling
 * on request size that exists so the smallest fallback model stays usable. Ten is
 * enough to carry a stage's worth of conversation and small enough that a long run
 * cannot grow the request until it is refused.
 */
const ANSWERS_SHOWN = 10

/** How many of the searches already run are listed back to the model. */
const SEARCHES_SHOWN = 4

/** How many results from each of those searches are listed. */
const FOUND_SHOWN = 8

/** The longest a single question or answer is repeated back, in characters. */
const LONGEST_REPEATED = 400

/** Cut long text at a word, and say that it was cut rather than pretending. */
function shorten(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= LONGEST_REPEATED) return flat

  const cut = flat.slice(0, LONGEST_REPEATED)
  const lastSpace = cut.lastIndexOf(' ')
  return `${lastSpace > LONGEST_REPEATED - 60 ? cut.slice(0, lastSpace) : cut}... (cut short)`
}

export function describeSituation(facts: CaseFacts): string {
  const lines: string[] = []
  lines.push(`Case ${facts.caseId}.`)
  lines.push(
    facts.description !== undefined
      ? `The owners describe it as: ${facts.description}`
      : facts.answers.length === 0
        ? 'Nobody has described the business yet.'
        : // They have said something and it has not been written down. Saying only
          // "nobody has described it" while the description sits in the answers
          // below reads as a contradiction, and a model resolves a contradiction by
          // asking again. Which is the loop this whole paragraph exists to stop.
          'The description has not been written down yet. If they have told you ' +
          'below, write it down first, in their words, before asking anything else.',
  )
  if (facts.proposedName !== undefined) lines.push(`Proposed name: ${facts.proposedName}`)
  if (facts.state !== undefined) lines.push(`To be formed in: ${facts.state}`)

  lines.push(
    facts.owners.length === 0
      ? 'No owners are known yet.'
      : `Owners so far: ${facts.owners
          .map((owner) => `${owner.name}${owner.contribution ? ` (${owner.contribution})` : ''}`)
          .join('; ')}`,
  )

  if (facts.openQuestions.length > 0) {
    lines.push(`Waiting for an answer to: ${facts.openQuestions.join('; ')}`)
  }

  // Everything a person has actually said, in their own words.
  //
  // THIS PARAGRAPH IS WHY A REAL RUN WORKS AT ALL. Without it the model was told
  // which questions were still outstanding and never told a single answer. On the
  // first real run with a real model that produced exactly what it should have:
  // the model asked what the business does, was told, could not see the reply, and
  // asked again. Eight turns, eight versions of the same question, until the stage
  // ran out of turns. The answers were all in the record. Nothing was reading them
  // back out.
  //
  // Written as a person speaking rather than as data, because that is what it is,
  // and because a model shown a labelled list of question and answer pairs tends to
  // treat them as a form to be filled rather than as things it has been told.
  if (facts.answers.length > 0) {
    const said = facts.answers.slice(-ANSWERS_SHOWN)
    const older = facts.answers.length - said.length

    lines.push('The owners have already told you this, and must not be asked again:')
    for (const one of said) {
      lines.push(`  asked: ${shorten(one.question)}`)
      lines.push(`  they said: ${shorten(one.answer)}`)
    }
    // Said out loud rather than quietly dropped. A model working from a list it
    // has been told is complete, when it is not, will confidently fill the gap.
    if (older > 0) {
      lines.push(
        `  (${older} earlier answer(s) are in the record and not repeated here, to keep ` +
          `this short enough to send. Ask again only if you truly need one of them.)`,
      )
    }
  }

  const authorisation = facts.spendAuthorisation
  lines.push(
    authorisation === undefined
      ? 'Nobody has given permission to spend anything yet.'
      : `Permission to spend up to ${authorisation.limitCents} cents on ` +
          `${authorisation.forWhat}; ${authorisation.spentCents} cents spent so far.`,
  )

  const research = facts.nameResearch
  if (research !== undefined) {
    // The verdict is deliberately absent until something has actually been
    // compared. Putting it straight into the sentence printed the word "undefined"
    // to the model, which is both meaningless and the kind of thing a model will
    // try to make sense of.
    lines.push(
      research.verdict === undefined
        ? `${research.searches.length} search(es) run, and nothing compared against the ` +
          `proposed name yet.`
        : `${research.searches.length} search(es) run. Name check so far: ${research.verdict}.`,
    )

    // What the searches actually found, which is the whole point of having run
    // them. Without this the model is told a number and never the names, and the
    // next thing it has to do is compare those names.
    for (const search of research.searches.slice(-SEARCHES_SHOWN)) {
      lines.push(`  searched: ${search.query}`)
      if (search.found.length === 0) {
        lines.push('    nothing came back')
        continue
      }
      for (const title of search.found.slice(0, FOUND_SHOWN)) {
        lines.push(`    found: ${shorten(title)}`)
      }
      if (search.found.length > FOUND_SHOWN) {
        lines.push(`    (${search.found.length - FOUND_SHOWN} more, not listed here)`)
      }
    }
  }

  const address = facts.address
  if (address !== undefined) {
    const state =
      address.registered === true
        ? 'registered'
        : address.available === true
          ? 'free, not yet registered'
          : address.available === false
            ? 'taken'
            : 'not checked yet'
    lines.push(
      `Web address ${address.candidate}: ${state}` +
        `${address.priceCents === undefined ? '' : `, ${address.priceCents} cents for the first year`}.`,
    )

    // The exact thing that stopped a real run: a price above the limit, and no
    // way for the model to see that was the problem. It could see the limit and it
    // could see the address; it was never shown the two side by side.
    const permission = facts.spendAuthorisation
    if (
      permission !== undefined &&
      address.priceCents !== undefined &&
      address.registered !== true &&
      Number(address.priceCents) > Number(permission.limitCents) - Number(permission.spentCents)
    ) {
      lines.push(
        `That is MORE than the ${permission.limitCents} cents a person allowed, so ` +
          `registering it will be refused. Either ask a person to allow at least ` +
          `${address.priceCents} cents, or find a cheaper address.`,
      )
    }
  }

  return lines.join('\n')
}

/** The value form, for putting a summary into the record. */
export function factsAsJson(facts: CaseFacts): JsonObject {
  return JSON.parse(JSON.stringify(facts)) as JsonObject
}

export type { JsonValue }
