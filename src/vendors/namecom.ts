/**
 * Checking and registering a web address with name.com.
 *
 * WHAT THIS IS
 *
 * The real client. Everything above it — the tool the model can call, the rule
 * that nothing costs money without a person's permission — is unchanged, because
 * this fits the same narrow description of what Charter needs from a registrar.
 *
 * TWO SEPARATE ACCOUNTS, AND THE MISTAKE THAT COSTS MONEY
 *
 * name.com runs a practice area at a different address, with a **separate account**
 * whose username is the live one with `-test` on the end. Identical paths,
 * identical validation, identical limits — and nothing registered is real.
 *
 * The username and the token are kept as two pairs rather than one shared username
 * with two tokens, because the mistake that costs money is pairing a live token
 * with a practice username or the reverse. Here they travel together and cannot be
 * separated: which environment you are in decides BOTH halves at once.
 *
 * Registering is refused outright unless the settings say `live` AND say
 * `SPEND_REAL_MONEY`, which are checked before the program starts.
 *
 * THE PATH IS /core/v1/ AND NOT /v4/
 *
 * An older `/v4/` interface turns up in search results and is not the one. Their
 * current interface is at `/core/v1/`. A test elsewhere in this project fails the
 * build if the older path appears anywhere in the source.
 *
 * THE KEY THAT STOPS A SECOND PURCHASE
 *
 * Registering accepts an idempotency key — a name the caller invents for this
 * exact request. Send the same key twice and the second reply comes back marked as
 * a replay of the first order, rather than buying a second address. Reusing the
 * key with a *different* body is refused with 409.
 *
 * This matters here more than to most callers. A registration costs money and
 * cannot be undone, and a retry after a timeout is exactly when a duplicate
 * purchase happens. The key is worked out from the case and the address, so a
 * retry is provably the same request rather than a new one that looks similar.
 *
 * TWO DIFFERENT QUESTIONS, ASKED SEPARATELY
 *
 * The cheap wide pass answers up to 500 names at once from zone-file data
 * refreshed twice a day, and their own documentation says plainly it is a "high
 * confidence indication" and not enough on its own: *search or check availability
 * before creating*. The authoritative answer caps at 50 names.
 *
 * So Charter asks them separately and never treats the cheap answer as the real
 * one. That is what makes the wide pass affordable and the final answer honest.
 */

import { ask, basicAuth, describeReply, type Fetcher, type Reply } from './http.js'
import type { AddressQuote, AddressRegistration, RegistrarService } from '../tools/services.js'
import { fingerprint } from '../record/canonical.js'

/** The practice service. Nothing registered here is real and nothing is charged. */
export const TEST_HOST = 'https://api.dev.name.com'

/** The live service. Registering here spends real money and cannot be undone. */
export const LIVE_HOST = 'https://api.name.com'

/** The current interface. An older /v4/ exists in search results and is not it. */
export const PATH = '/core/v1'

/** The most names the cheap wide pass takes at once. Their limit, not ours. */
export const ZONE_CHECK_LIMIT = 500

/** The most names the authoritative check takes at once. Their limit, not ours. */
export const AVAILABILITY_LIMIT = 50

export class RegistrarRefusal extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RegistrarRefusal'
  }
}

export interface NamecomOptions {
  /** `test` uses the practice account and registers nothing real. */
  readonly environment: 'test' | 'live'
  /** The practice username is the live one with `-test` on the end. */
  readonly username: string
  readonly token: string
  /** Only true when the settings say so twice. Registering is refused without it. */
  readonly mayspendRealMoney: boolean
  /**
   * The case this client is registering for.
   *
   * Part of the idempotency key, so two different cases asking for the same
   * address are two different requests, and the same case retrying is provably
   * the same one.
   */
  readonly caseId: string
  readonly baseUrl?: string
  readonly fetcher?: Fetcher
}

/**
 * The name for one registration request, worked out rather than invented.
 *
 * Built from the case and the address, so retrying after a timeout sends the SAME
 * name and the registrar replies with the original order instead of buying a
 * second address. A random name would make every retry a new purchase, which is
 * the exact failure this exists to prevent.
 */
export function idempotencyKeyFor(caseId: string, domain: string): string {
  return fingerprint({ what: 'register-domain', caseId, domain }).slice(0, 32)
}

/** Read a price out of their reply, in whole cents, however they wrote it. */
export function priceInCents(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Their prices come back as an amount in whole currency units, so 12.99 is
    // twelve dollars ninety-nine. Rounded rather than truncated: truncating turns
    // 12.99 into 1298 cents and quietly under-reports every price by a cent.
    return String(Math.round(value * 100))
  }
  if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value)) {
    return String(Math.round(Number(value) * 100))
  }
  return undefined
}

interface AvailabilityRow {
  readonly domainName?: string
  readonly domain?: string
  readonly purchasable?: boolean
  readonly available?: boolean
  readonly purchasePrice?: number | string
  readonly price?: number | string
}

/** Pull the rows out of their reply, whichever of the two shapes it used. */
function rowsOf(body: unknown): readonly AvailabilityRow[] {
  if (body === null || typeof body !== 'object') return []
  const bag = body as Record<string, unknown>
  for (const key of ['results', 'domains', 'items']) {
    const value = bag[key]
    if (Array.isArray(value)) return value as AvailabilityRow[]
  }
  return []
}

const nameOf = (row: AvailabilityRow): string => row.domainName ?? row.domain ?? ''

export function namecomRegistrar(options: NamecomOptions): RegistrarService & {
  /** The cheap wide pass. A shortlist, never an answer. */
  shortlist(domains: readonly string[]): Promise<readonly string[]>
} {
  const base =
    options.baseUrl ?? (options.environment === 'live' ? LIVE_HOST : TEST_HOST)
  const authorization = basicAuth(options.username, options.token)

  const call = (path: string, body?: unknown, extra?: Record<string, string>): Promise<Reply> =>
    ask(`${base}${PATH}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization, ...extra },
      ...(body === undefined ? {} : { body }),
      ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
    })

  return {
    /**
     * Narrow many candidate names down cheaply.
     *
     * Answered from zone-file data refreshed twice a day. Their own documentation
     * calls this a high-confidence indication and says plainly it is not enough on
     * its own, so nothing here treats it as an answer — it decides which names are
     * worth asking about properly.
     *
     * A name whose availability comes back as unknown is KEPT. Dropping it would
     * quietly discard a name that might be free, and the authoritative check is
     * what settles it.
     */
    async shortlist(domains: readonly string[]): Promise<readonly string[]> {
      if (domains.length === 0) return []
      if (domains.length > ZONE_CHECK_LIMIT) {
        throw new RegistrarRefusal(
          `The wide pass takes at most ${ZONE_CHECK_LIMIT} names at once and was ` +
            `given ${domains.length}. That is their limit, not ours.`,
        )
      }

      const reply = await call('/zonecheck', { domainNames: domains })
      if (reply.kind !== 'ok') {
        // A wide pass that could not run is not a wide pass that found nothing.
        // Everything goes through to the authoritative check, which costs more
        // calls and gives the right answer.
        return domains
      }

      const rows = rowsOf(reply.body)
      if (rows.length === 0) return domains

      const taken = new Set(
        rows.filter((row) => row.available === false).map((row) => nameOf(row)),
      )
      return domains.filter((domain) => !taken.has(domain))
    },

    /**
     * The authoritative answer for one address, and what it would cost.
     *
     * Costs nothing to ask. This is the one Charter acts on.
     */
    async quote(domain: string): Promise<AddressQuote> {
      const reply = await call('/domains:checkAvailability', { domainNames: [domain] })

      if (reply.kind !== 'ok') {
        throw new RegistrarRefusal(
          `Could not find out whether ${domain} is free: the registrar ` +
            `${describeReply(reply)}.`,
        )
      }

      const row = rowsOf(reply.body).find((one) => nameOf(one) === domain)
      if (row === undefined) {
        throw new RegistrarRefusal(
          `The registrar answered about ${domain} without mentioning it. Treating ` +
            `silence as "available" is how an address that is already taken gets ` +
            `bought, so this is an error instead.`,
        )
      }

      const available = row.purchasable ?? row.available ?? false
      const price = priceInCents(row.purchasePrice ?? row.price)

      return {
        domain,
        available,
        ...(available && price !== undefined ? { priceCents: price } : {}),
      }
    },

    /**
     * Register the address. Spends money and cannot be undone.
     *
     * Two things stand between this and a charge, and neither is in this file by
     * accident.
     *
     * The permission to spend is checked in `guard.ts`, before the tool runs. It
     * is not in here on purpose: a rule enforced inside the thing it governs is a
     * rule that moves when the thing is replaced.
     *
     * The environment is checked HERE, because it is about this vendor and nothing
     * else. Registering against the live service needs the settings to say so
     * twice, and a client built without that says no rather than quietly spending.
     */
    async register(domain: string, priceCents: string): Promise<AddressRegistration> {
      if (options.environment === 'live' && !options.mayspendRealMoney) {
        throw new RegistrarRefusal(
          `Refusing to register ${domain} against the live service. That spends real ` +
            `money and cannot be undone, and this client was built without permission ` +
            `to do it. Both REGISTRAR_ENV=live and SPEND_REAL_MONEY=true are needed.`,
        )
      }

      const reply = await call(
        '/domains',
        {
          domain: { domainName: domain },
          purchasePrice: Number(priceCents) / 100,
          years: 1,
        },
        // The same request retried sends the same key, so the registrar replies
        // with the original order instead of buying a second address.
        { 'X-Idempotency-Key': idempotencyKeyFor(options.caseId, domain) },
      )

      if (reply.kind !== 'ok') {
        throw new RegistrarRefusal(
          `${domain} was not registered: the registrar ${describeReply(reply)}. ` +
            `Nothing was charged.`,
        )
      }

      return {
        domain,
        chargedCents: priceCents,
        // The practice service registers nothing real. Recorded from what this
        // client was built with rather than from the reply, because a vendor
        // telling us their own sandbox was real would be believed.
        sandbox: options.environment === 'test',
      }
    },
  }
}
