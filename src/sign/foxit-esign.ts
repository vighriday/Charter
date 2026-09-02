/**
 * Carrying the sealed packet to the owners, so that they sign it themselves.
 *
 * THIS FILE IS INSIDE THE WALL.
 *
 * `src/sign/` is the one folder nothing the model can trigger may reach. Not "we
 * were careful" — no chain of imports of any length runs from any tool handler to
 * anything in here, and `tests/boundary.test.ts` walks every import in the project
 * on every push and fails the build if one ever appears. Code that cannot be
 * reached cannot be run, whatever the model asks for.
 *
 * The signing service's own documentation would happily let a program create a
 * signature. This program cannot get to the call.
 *
 * WHAT THIS DOES
 *
 * It takes a request that `prepareSignatureRequest` has already refused four ways
 * if anything was wrong with it, and it does three things with the service:
 *
 *   1. creates the signing folder as a DRAFT, with the packet in it, the owners
 *      named, and a signature box placed where Charter drew each line
 *   2. sends it, as a separate act, at a moment this project chooses and records
 *   3. reads the state back from the service, rather than believing a message
 *
 * WHY CREATING AND SENDING ARE TWO ACTS
 *
 * Because the moment a person is asked to sign something is a moment worth
 * controlling. Creating and sending in one call means the emails go out as a side
 * effect of building a request, before anything has looked at what was built. So
 * `sendNow` is false when the folder is created, always, and sending is a second
 * call somebody made on purpose.
 *
 * WHY THE SIGNATURE BOXES ARE PLACED BY COORDINATE
 *
 * A signing service places a signature one of three ways: it finds marks in the
 * document text, it finds form fields already there, or it is told exactly where.
 * There is deliberately no fourth way meaning "work it out", because that is the
 * setting that produces a signing screen with no required fields, where a person
 * reaches "Finish" without ever having signed.
 *
 * Charter draws the signature lines, so Charter knows where they are, and says so.
 * That is the most explicit of the three and the only one that cannot silently
 * find nothing.
 *
 * WHAT THIS FILE DOES NOT KNOW
 *
 * **It has never been called.** At the time of writing, Foxit issues eSign API
 * credentials from the eSign product itself, and the developer-portal pair that
 * works for their document services is refused here with "invalid consumer
 * credentials". So this is written from their published interface and it has not
 * met their server.
 *
 * That sentence is here because the last client in this project that had never
 * been called was wrong in three separate ways at once, and every one of them was
 * invisible to a test suite that passed. Nothing in this project may report this
 * as working until somebody has run `npm run esign:proof` and seen it work. Until
 * then the honest description is "written, not proven", and that is what the
 * settings file and the website both say.
 *
 * The defensive choices below follow from that. Anything the service says that
 * this file does not recognise is treated as NOT finished, never as finished.
 */

import { ask, describeReply, type Fetcher, type Reply } from '../vendors/http.js'
import { isFinished, type SignatureRequest, type Signer } from './request.js'

/** How long to wait for one answer from the signing service. */
const PATIENCE = 60_000

/** Their name, written once, so every record entry spells it the same way. */
export const CARRIED_BY = 'Foxit eSign'

/**
 * What a person is allowed to do with the document, in the service's words.
 *
 * One value, used everywhere, and it is the one that requires a signature. The
 * service offers a "view only" and a "fill fields only" that would each produce a
 * completed folder with nothing signed in it.
 */
export const MUST_SIGN = 'FILL_FIELDS_AND_SIGN'

/** Where one owner signs, as the service measures it. */
export interface SignatureBox {
  readonly owner: string
  readonly page: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface ESignOptions {
  readonly baseUrl: string
  readonly clientId: string
  readonly clientSecret: string
  readonly fetcher?: Fetcher
}

/** A signing folder that exists at the service, and has not been sent. */
export interface DraftFolder {
  readonly folderId: string
  readonly signers: readonly Signer[]
  readonly carriedBy: string
}

/** What the service says about a folder now. */
export interface FolderState {
  /** The service's own word for it, kept exactly as it arrived. */
  readonly said: string
  /**
   * Whether every person has signed and the service has closed it.
   *
   * False for anything this file does not recognise. A word we have not seen
   * before is not evidence that everybody signed.
   */
  readonly finished: boolean
}

export class CannotCarry extends Error {
  constructor(what: string, reply: Reply) {
    // The detail is kept, not summarised away. The one-line description says what
    // kind of failure it was; the detail is the service's own sentence, and that
    // is the part that tells somebody which credential to go and fetch.
    const detail = 'detail' in reply ? reply.detail : ''
    super(
      `${what}: ${CARRIED_BY} ${describeReply(reply)}` +
        (detail === '' ? '' : `. It said: ${detail}`),
    )
    this.name = 'CannotCarry'
  }
}

export class WillNotAsk extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WillNotAsk'
  }
}

export function foxitESign(options: ESignOptions): {
  /** Exchange the credentials for a token. Held only for this run. */
  readonly signIn: () => Promise<string>
  readonly createDraft: (
    token: string,
    request: SignatureRequest,
    boxes: readonly SignatureBox[],
  ) => Promise<DraftFolder>
  readonly send: (token: string, folder: DraftFolder) => Promise<void>
  readonly stateOf: (token: string, folderId: string) => Promise<FolderState>
} {
  const base = options.baseUrl.replace(/\/+$/, '')

  const call = async (
    path: string,
    token: string,
    body: unknown,
    what: string,
  ): Promise<unknown> => {
    const reply = await ask(`${base}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body,
      patience: PATIENCE,
      ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
    })
    if (reply.kind !== 'ok') throw new CannotCarry(what, reply)
    return reply.body
  }

  return {
    async signIn(): Promise<string> {
      // A form rather than JSON, which is what their token endpoint takes. Sent
      // as JSON it answers 415, and sent in the address it answers 500.
      const body = new URLSearchParams({
        client_id: options.clientId,
        client_secret: options.clientSecret,
        grant_type: 'client_credentials',
        scope: 'read-write',
      })

      const send = options.fetcher ?? ((url: string, init: RequestInit) => fetch(url, init))

      let response: Response
      try {
        response = await send(`${base}/oauth2/access_token`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
          signal: AbortSignal.timeout(PATIENCE),
        })
      } catch (error) {
        throw new CannotCarry('signing in', {
          kind: 'never-arrived',
          detail: error instanceof Error ? error.message : String(error),
        })
      }

      const text = await response.text().catch(() => '')
      let parsed: unknown = null
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new CannotCarry('signing in', {
          kind: 'unreadable',
          status: response.status,
          detail: 'the reply was not readable',
        })
      }

      // Their token endpoint answers 200 and puts the refusal in the body, so the
      // status on its own says nothing. Read the body.
      const token = field(parsed, 'access_token')
      if (typeof token !== 'string' || token === '') {
        const said = String(field(parsed, 'error_description') ?? field(parsed, 'error') ?? '')
        throw new CannotCarry('signing in', {
          kind: 'refused',
          status: response.status,
          detail:
            said === ''
              ? 'no access_token came back'
              : `${said}. Their eSign product issues its own key pair, and the ` +
                `developer-portal pair that works for their document services is ` +
                `not accepted here.`,
        })
      }

      return token
    },

    async createDraft(
      token: string,
      request: SignatureRequest,
      boxes: readonly SignatureBox[],
    ): Promise<DraftFolder> {
      // The quietest and worst failure this whole project has: a folder with
      // nowhere to sign. The person reaches "Finish", the service reports a
      // completed folder, and nothing in it has been signed. So it is checked
      // here as well as in prepareSignatureRequest, because this is the last
      // place before it leaves.
      if (boxes.length === 0) {
        throw new WillNotAsk(
          'There is nowhere to sign in this packet, so nobody would be asked to ' +
            'sign anything. The service would report a completed folder containing ' +
            'an unsigned document, and every screen would say the run had worked.',
        )
      }

      const missing = request.signers.filter(
        (signer) => !boxes.some((box) => box.owner === signer.fullName),
      )
      if (missing.length > 0) {
        throw new WillNotAsk(
          `${missing.map((one) => one.fullName).join(' and ')} would be asked to sign ` +
            `a document with no signature box for them. A folder where one owner ` +
            `signs and another cannot is not the deal the packet describes.`,
        )
      }

      // Party numbers start at one and are what the field list points at.
      const parties = request.signers.map((signer, at) => ({
        firstName: firstNameOf(signer.fullName),
        lastName: lastNameOf(signer.fullName),
        emailId: signer.email,
        permission: MUST_SIGN,
        sequence: at + 1,
        workflowSequence: signer.order,
      }))

      const fields = boxes.map((box) => ({
        type: 'signature',
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
        documentNumber: 1,
        pageNumber: box.page,
        party: partyNumberFor(box.owner, request.signers),
      }))

      const body = await call(
        '/folders/createfolder',
        token,
        {
          folderName: `Formation Pack — ${request.caseId}`,
          base64FileString: [Buffer.from(request.pack).toString('base64')],
          fileNames: ['formation-pack.pdf'],
          parties,
          fields,
          // Both false. The boxes above are exact, and letting the service also
          // hunt for marks in the text or fields in the document would mean the
          // number of places to sign depended on what it happened to find.
          processTextTags: false,
          processAcroFields: false,
          // Never true here. See the note at the top: the moment a person is asked
          // to sign is a moment this project controls and records.
          sendNow: false,
        },
        'creating the signing folder',
      )

      const folderId = field(body, 'folderId')
      if (folderId === undefined || folderId === null || String(folderId) === '') {
        throw new CannotCarry('creating the signing folder', {
          kind: 'unreadable',
          status: 200,
          detail: 'the reply carried no folderId, so there is nothing to send later',
        })
      }

      return { folderId: String(folderId), signers: request.signers, carriedBy: CARRIED_BY }
    },

    async send(token: string, folder: DraftFolder): Promise<void> {
      await call(
        '/folders/sendDraftFolder',
        token,
        {
          folderId: Number(folder.folderId),
          sendNow: true,
          // In order, and said out loud rather than left to a default. "Both
          // owners signed" and "one owner signed twice" are different documents.
          signInSequence: true,
        },
        'sending the packet to the owners',
      )
    },

    async stateOf(token: string, folderId: string): Promise<FolderState> {
      const reply = await ask(`${base}/folders/${folderId}`, {
        headers: { authorization: `Bearer ${token}` },
        patience: PATIENCE,
        ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
      })
      if (reply.kind !== 'ok') throw new CannotCarry('reading the folder back', reply)

      const said = String(
        field(reply.body, 'status') ?? field(field(reply.body, 'folder'), 'status') ?? '',
      )

      return { said, finished: isFinished(said.trim().toLowerCase()) }
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Small shared pieces
// ─────────────────────────────────────────────────────────────────────────────

function field(body: unknown, name: string): unknown {
  if (body === null || typeof body !== 'object') return undefined
  return (body as Record<string, unknown>)[name]
}

/**
 * Which party number belongs to an owner.
 *
 * Worked out from the same list the parties were built from, so a box can never
 * point at a party that is not there. Throws rather than defaulting to the first
 * party: a signature box silently assigned to the wrong person is a document
 * signed by the wrong owner.
 */
export function partyNumberFor(owner: string, signers: readonly Signer[]): number {
  const at = signers.findIndex((one) => one.fullName === owner)
  if (at === -1) {
    throw new WillNotAsk(
      `There is a signature box for "${owner}", who is not one of the people being ` +
        `asked to sign. A box assigned to the wrong person is a document signed by ` +
        `the wrong owner.`,
    )
  }
  return at + 1
}

/**
 * Split a name the way the signing service insists on, and say what was assumed.
 *
 * The service asks for a first name and a last name. Most of the world does not
 * work that way, and there is no correct general answer — so the rule is the
 * simplest one that never loses a character: everything before the first space is
 * the first name, everything after it is the last name, and a single word goes in
 * the first name with the last name repeating it, because the service refuses an
 * empty one.
 *
 * Nothing is dropped and nothing is reordered. The full name as the owners wrote
 * it is what appears in the packet itself, which is the document that binds them.
 */
export function firstNameOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/)
  return parts[0] ?? ''
}

export function lastNameOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/)
  return parts.length === 1 ? (parts[0] ?? '') : parts.slice(1).join(' ')
}
