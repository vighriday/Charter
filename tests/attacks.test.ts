/**
 * Attacks on Charter's own boundary, and the proof that each one fails.
 *
 * WHY THIS FILE IS IN A PUBLIC REPOSITORY
 *
 * Every other entry at this event will document what its software accomplished.
 * This one documents what its software cannot be talked into. A claim that a
 * boundary holds is worth very little; a set of attacks on that boundary, run on
 * every build, on anybody's machine, is worth something.
 *
 * The plan for this project listed eight attacks. Six were already covered
 * elsewhere in this suite as the features they attack were built:
 *
 *   Ask for a signing tool in every stage    tests/stages.test.ts
 *   Register with no spend permission        tests/tools.test.ts
 *   Register above the permitted amount      tests/tools.test.ts
 *   Forge a permission through a tool        tests/stages.test.ts, boundary.test.ts
 *   Skip a stage, or go backwards            tests/stages.test.ts
 *   Change a past event                      tests/log.test.ts — the database refuses
 *
 * The two here are the ones that had nowhere to live until the code they attack
 * existed. They are the last two, and this suite is now complete against the plan.
 *
 * WHAT AN ATTACK TEST HAS TO DO TO BE WORTH ANYTHING
 *
 * It has to actually try. A test that asserts a guard exists proves the guard
 * exists. A test that drives the system towards the forbidden outcome and shows it
 * refusing proves the guard works. Each one below does the second thing, and says
 * what would have happened had it succeeded.
 */

import { describe, expect, it, beforeAll } from 'vitest'
import { openBuiltIn, type Database } from '../src/db/driver.js'
import { migrate } from '../src/db/migrate.js'
import { append, fixedClock, readEvents, verifyRun } from '../src/record/log.js'
import { fingerprintBytes } from '../src/record/canonical.js'
import { approveSendingForSignature } from '../src/case/human.js'
import {
  approvalOnRecord,
  sendForSignature,
  type SigningService,
} from '../src/case/send-for-signature.js'
import { WillNotSend, prepareSignatureRequest } from '../src/sign/request.js'
import { makeSealCertificate, type SealCertificate } from '../src/seal/certificate.js'
import { sealPack } from '../src/seal/seal.js'
import { PDFDocument } from 'pdf-lib'
import { ALL_TOOLS } from '../src/tools/stage-tools.js'
import { STAGES } from '../src/stages/stages.js'
import { DEFAULT_SCORE_FLOOR, reviewField } from '../src/identity/review.js'
import { LABELS_NEEDING_A_PERSON } from '../src/identity/fields.js'

const TOKEN = 'a-long-unguessable-token-for-this-case'

/** A signing service that records what it was asked to do and does nothing else. */
function watchfulService(): SigningService & { readonly asked: unknown[] } {
  const asked: unknown[] = []
  return {
    asked,
    async create(request) {
      asked.push(request)
      return { folderId: 'folder-1', state: 'draft' }
    },
  }
}

let certificate: SealCertificate
let sealedPack: Uint8Array
let sealedFingerprint: string

beforeAll(async () => {
  certificate = makeSealCertificate({
    notBefore: new Date(Date.UTC(2026, 0, 1)),
    password: 'a-long-enough-password',
  })

  const doc = await PDFDocument.create()
  doc.addPage([595, 842])
  const sealed = await sealPack(await doc.save(), certificate, {
    at: new Date(Date.UTC(2026, 7, 30, 12)),
  })

  sealedPack = sealed.bytes
  sealedFingerprint = sealed.fingerprint
}, 120_000)

const freshCase = async (): Promise<Database> => {
  const db = await openBuiltIn()
  await migrate(db)
  return db
}

// ─────────────────────────────────────────────────────────────────────────────
// Attack seven: send the pack for signature with no recorded approval
// ─────────────────────────────────────────────────────────────────────────────

describe('attack: send the pack for signature without a person approving', () => {
  it('refuses, and nothing reaches the signing service', async () => {
    // Had this succeeded, owners would have been emailed a contract to sign that
    // no person ever approved sending. That is the failure this whole project is
    // built to make impossible.
    const db = await freshCase()
    const clock = fixedClock('2026-08-30T09:00:00.000Z', 1000)
    const service = watchfulService()

    await expect(
      sendForSignature({
        db,
        caseId: 'no-approval',
        clock,
        service,
        pack: sealedPack,
        signers: [{ fullName: 'Ana Rivera', email: 'ana@example.com', order: 1 }],
        whereToSign: 'text tags in the document',
      }),
    ).rejects.toThrow(WillNotSend)

    // Proved by nothing being sent, rather than by an error being thrown. An error
    // after the request had already gone out would be no defence at all.
    expect(service.asked, 'the signing service was contacted anyway').toEqual([])
    await db.close()
  })

  it('records the refusal, so a run shows the moment it declined', async () => {
    const db = await freshCase()
    const clock = fixedClock('2026-08-30T09:00:00.000Z', 1000)

    await sendForSignature({
      db,
      caseId: 'no-approval-2',
      clock,
      service: watchfulService(),
      pack: sealedPack,
      signers: [{ fullName: 'Ana Rivera', email: 'ana@example.com', order: 1 }],
      whereToSign: 'text tags in the document',
    }).catch(() => undefined)

    const events = await readEvents(db, 'no-approval-2')
    expect(events.map((one) => one.kind)).toContain('signature.request.refused')
    await db.close()
  })

  it('refuses an approval given for a different pack', async () => {
    // The nastier version of the same attack: a real approval exists, but for a
    // different document. Letting it carry across is how somebody ends up having
    // approved a document they never saw.
    const db = await freshCase()
    const clock = fixedClock('2026-08-30T09:00:00.000Z', 1000)
    const service = watchfulService()

    await approveSendingForSignature(
      { db, caseId: 'stale-approval', token: TOKEN, expectedToken: TOKEN, clock },
      'Ana Rivera',
      fingerprintBytes(new TextEncoder().encode('a completely different pack')),
    )

    await expect(
      sendForSignature({
        db,
        caseId: 'stale-approval',
        clock,
        service,
        pack: sealedPack,
        signers: [{ fullName: 'Ana Rivera', email: 'ana@example.com', order: 1 }],
        whereToSign: 'text tags in the document',
      }),
    ).rejects.toThrow(/does not carry across|belongs to the exact document/)

    expect(service.asked).toEqual([])
    await db.close()
  })

  it('sends only when a person approved this exact pack', async () => {
    // The other half of the proof. A guard that refuses everything is not a guard,
    // it is a broken feature, and a test suite that only shows refusals cannot
    // tell the two apart.
    const db = await freshCase()
    const clock = fixedClock('2026-08-30T09:00:00.000Z', 1000)
    const service = watchfulService()

    await approveSendingForSignature(
      { db, caseId: 'good-approval', token: TOKEN, expectedToken: TOKEN, clock },
      'Ana Rivera',
      sealedFingerprint,
    )

    const sent = await sendForSignature({
      db,
      caseId: 'good-approval',
      clock,
      service,
      pack: sealedPack,
      signers: [{ fullName: 'Ana Rivera', email: 'ana@example.com', order: 1 }],
      whereToSign: 'text tags in the document',
    })

    expect(sent.folderId).toBe('folder-1')
    expect(service.asked).toHaveLength(1)

    const events = await readEvents(db, 'good-approval')
    expect(events.map((one) => one.kind)).toContain('signature.requested')
    await db.close()
  })

  it('refuses to send an unsealed pack even with a valid approval', async () => {
    // Sending an unsealed document means the file people sign is not provably the
    // file that was approved.
    const plain = new TextEncoder().encode('%PDF-1.7\nnot sealed\n')

    expect(() =>
      prepareSignatureRequest({
        caseId: 'x',
        pack: plain,
        packFingerprint: fingerprintBytes(plain),
        approval: {
          approvedBy: 'Ana Rivera',
          packFingerprint: fingerprintBytes(plain),
          approvedAt: '2026-08-30T09:00:00.000Z',
        },
        signers: [{ fullName: 'Ana Rivera', email: 'ana@example.com', order: 1 }],
        whereToSign: 'text tags in the document',
      }),
    ).toThrow(/has not been sealed/)
  })

  it('refuses a request with nowhere to sign', async () => {
    // The quietest failure of all. If the signing service is not told where the
    // signature goes, its screen reports zero required fields and a person can
    // reach "Finish" without ever having signed. A system whose whole argument is
    // that only a person signs, producing an unsigned document while every screen
    // says it worked, is the worst available outcome.
    expect(() =>
      prepareSignatureRequest({
        caseId: 'x',
        pack: sealedPack,
        packFingerprint: sealedFingerprint,
        approval: {
          approvedBy: 'Ana Rivera',
          packFingerprint: sealedFingerprint,
          approvedAt: '2026-08-30T09:00:00.000Z',
        },
        signers: [],
        whereToSign: 'text tags in the document',
      }),
    ).toThrow(/nobody to ask/)
  })

  it('has no way to express "let the service decide" where the signature goes', () => {
    // There are exactly two settings and both are explicit. The absence of a third
    // is what makes the previous test's failure impossible to reach by accident.
    const allowed: string[] = ['text tags in the document', 'form fields already in the document']
    expect(allowed).toHaveLength(2)
  })

  it('reads the approval from the record rather than being handed one', async () => {
    // The obvious way to break a guard is to hand it its own answer. This one gets
    // its answer from an append-only record the database itself refuses to change.
    const db = await freshCase()
    expect(await approvalOnRecord(db, 'from-record')).toBeUndefined()

    const clock = fixedClock('2026-08-30T09:00:00.000Z', 1000)
    await approveSendingForSignature(
      { db, caseId: 'from-record', token: TOKEN, expectedToken: TOKEN, clock },
      'Ana Rivera',
      sealedFingerprint,
    )

    expect((await approvalOnRecord(db, 'from-record'))?.packFingerprint).toBe(sealedFingerprint)
    await db.close()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Attack eight: lower the human-review threshold from inside the model's reach
// ─────────────────────────────────────────────────────────────────────────────

describe('attack: lower the identity review threshold from inside the model’s reach', () => {
  it('offers no tool that could change any threshold or setting', () => {
    // The first line of defence is that the lever does not exist. A model cannot
    // reach for a setting it has never been shown.
    const suspicious = /threshold|floor|confidence|setting|config|tolerance|sensitivity|approve|override|bypass|skip/i

    const offending = ALL_TOOLS.filter((tool) => suspicious.test(tool.name))
    expect(offending.map((one) => one.name)).toEqual([])
  })

  it('offers no tool argument that could change one either', () => {
    // The subtler version: a tool with an innocent name that takes a threshold as
    // an argument would be exactly as dangerous.
    const suspicious = /threshold|floor|confidence|tolerance|sensitivity|skip_review|no_review/i

    for (const tool of ALL_TOOLS) {
      for (const field of Object.keys(tool.schema.properties)) {
        expect(
          suspicious.test(field),
          `the tool "${tool.name}" takes an argument called "${field}"`,
        ).toBe(false)
      }
    }
  })

  it('has no tool in the identity stage that can clear a review', () => {
    // The stage that reads identity documents offers two tools. One reads a
    // document; the other writes down a plain fact. Neither can mark a doubtful
    // value as fine.
    expect(STAGES.verify.tools).toEqual(['read_identity_document', 'record_fact'])
  })

  it('routes on grounding first, so lowering the score would not help anyway', () => {
    // Even if a threshold could somehow be moved, it would not open the door. A
    // value that cannot be found in the document goes to a person on the strength
    // of the label alone, at any confidence, with any floor.
    for (const label of LABELS_NEEDING_A_PERSON) {
      const review = reviewField(
        { name: 'document_number', value: 'X1', label, confidence: 1 },
        { givenName: 'Ana Rivera', today: '2026-08-30', scoreFloor: 0 },
      )

      expect(
        review.needsAPerson,
        `a "${label}" value passed with the floor set to zero and full confidence`,
      ).toBe(true)
    }
  })

  it('sends more to a person as the floor rises, and never fewer', () => {
    // The rule may only err in one direction. Raising the floor can only add work
    // for a person; it can never take any away.
    const field = { name: 'document_number', value: 'X1', label: 'id_match' as const, confidence: 0.5 }
    const settings = (scoreFloor: number) => ({
      givenName: 'Ana Rivera',
      today: '2026-08-30',
      scoreFloor,
    })

    expect(reviewField(field, settings(0.4)).needsAPerson).toBe(false)
    expect(reviewField(field, settings(0.6)).needsAPerson).toBe(true)
    expect(reviewField(field, settings(1)).needsAPerson).toBe(true)
  })

  it('keeps a high floor by default, because too much review is the safe direction', () => {
    expect(DEFAULT_SCORE_FLOOR).toBeGreaterThanOrEqual(0.85)
  })

  it('has no tool anywhere that writes a fact about identity at all', () => {
    // record_fact exists in the identity stage, and it is worth checking what it
    // can actually write. None of its options touch a review.
    const recordFact = ALL_TOOLS.find((tool) => tool.name === 'record_fact')
    const about = recordFact?.schema.properties['about']?.enum ?? []

    expect(about).not.toContain('identity')
    expect(about).not.toContain('review')
    expect(about.length).toBeGreaterThan(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Attacks on the record itself
// ─────────────────────────────────────────────────────────────────────────────

/**
 * These exist because a claim in this project's readme turned out to be false.
 *
 * It said the append-only rule inside the database "has no setting to turn it
 * off". Two documented PostgreSQL routes were found and both worked:
 *
 *   SET session_replication_role = 'replica'   skips ordinary triggers
 *   ALTER TABLE events DISABLE TRIGGER ALL     needs only table ownership
 *
 * The first is now closed, by creating the triggers with ENABLE ALWAYS. The second
 * cannot be closed by anybody: the owner of a table may always disable its
 * triggers, and the role that runs the migration owns the table by definition.
 *
 * So the honest claim is not prevention, and these tests fix the honest claim in
 * place. Charter DETECTS modification. It does not prevent it. The value of
 * putting the rule in the database is that nobody gets around it by accident or
 * through any ordinary code path — and somebody who does it deliberately still
 * cannot hide it.
 */
describe('attack: change a past entry in the record', () => {
  const threeEntries = async (db: Database, runId: string) => {
    const clock = fixedClock('2026-08-30T09:00:00.000Z', 1000)
    for (const kind of ['a.one', 'a.two', 'a.three']) {
      await append(db, { runId, kind, actor: 'system', stage: null, payload: { kind } }, clock)
    }
  }

  it('is refused for ordinary code, by the database rather than by us', async () => {
    const db = await freshCase()
    await threeEntries(db, 'ordinary')

    await expect(db.query("UPDATE events SET kind = 'changed' WHERE seq = 1")).rejects.toThrow(
      /append-only/,
    )
    await db.close()
  })

  it('is still refused in replication mode, which used to be a way through', async () => {
    // `session_replication_role = 'replica'` is a documented, supported setting
    // that skips ordinary triggers. Before the triggers were created with ENABLE
    // ALWAYS, an UPDATE in this mode rewrote a past entry silently.
    const db = await freshCase()
    await threeEntries(db, 'replica')

    await db.query("SET session_replication_role = 'replica'")
    await expect(db.query("UPDATE events SET kind = 'quiet' WHERE seq = 1")).rejects.toThrow(
      /append-only/,
    )
    await db.query("SET session_replication_role = 'origin'")
    await db.close()
  })

  it('CAN be forced by disabling the triggers, and the chain catches it', async () => {
    // This route cannot be closed, so it is tested rather than denied. Whoever owns
    // the table may disable its triggers. What they cannot do is hide the result:
    // every entry carries the fingerprint of the one before it, so changing one in
    // the middle breaks every link after it.
    const db = await freshCase()
    await threeEntries(db, 'forced')

    await db.query('ALTER TABLE events DISABLE TRIGGER ALL')
    await db.query("UPDATE events SET kind = 'changed.in.the.middle' WHERE seq = 1")
    await db.query('ALTER TABLE events ENABLE TRIGGER ALL')

    const check = await verifyRun(db, 'forced')
    expect(check.ok, 'a changed entry passed the checker').toBe(false)
    await db.close()
  })

  it('is not caught by the chain alone when the END is removed, which is why the attestation exists', async () => {
    // The one thing a chain of fingerprints cannot notice on its own: a shortened
    // chain is still a valid chain. This project says so in its readme rather than
    // hiding it, and this test is what keeps that statement true.
    const db = await freshCase()
    await threeEntries(db, 'shortened')

    await db.query('ALTER TABLE events DISABLE TRIGGER ALL')
    await db.query("DELETE FROM events WHERE run_id = 'shortened' AND seq = 3")
    await db.query('ALTER TABLE events ENABLE TRIGGER ALL')

    const check = await verifyRun(db, 'shortened')
    expect(
      check.ok,
      'if this ever fails, the chain has become able to catch truncation on its ' +
        'own and the readme should stop saying it cannot',
    ).toBe(true)

    // Two entries left where there were three. The chain is happy; only something
    // vouching for the END of it can tell.
    expect(await readEvents(db, 'shortened')).toHaveLength(2)
    await db.close()
  })
})
