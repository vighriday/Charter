/**
 * Talking to a database, without caring which one.
 *
 * TWO WAYS TO RUN, ONE INTERFACE
 *
 *   Built in    Real PostgreSQL, compiled to WebAssembly, running inside Node.
 *               No install, no service, no password, no container. `npm install`
 *               and it works. This is the default.
 *
 *   Hosted      An ordinary PostgreSQL server, reached with DATABASE_URL. Used
 *               when Charter is deployed.
 *
 * WHY THE BUILT-IN ONE IS THE DEFAULT, AND WHY IT MATTERS MORE THAN IT SOUNDS
 *
 * Three of the challenges this project enters require that a stranger can clone
 * the repository and run it. The original plan used a container, which quietly
 * assumes the person has Docker installed and running. Many do not. It was not
 * installed on the machine this was written on either, which is how the problem
 * was noticed.
 *
 * PGlite is genuinely PostgreSQL — the same engine, the same SQL, the same
 * triggers, the same procedural language. So the rules that make our record
 * append-only are enforced identically whether someone is evaluating this on a
 * laptop with nothing installed, or it is running against a hosted database. That
 * is the part that matters: the guarantee does not weaken when the setup gets
 * easier.
 *
 * The interface below is deliberately tiny — a query, a batch of statements, and a
 * transaction. Anything a database driver offers beyond that would be a difference
 * between the two, and differences are where the surprises live.
 */

export interface QueryResult<Row> {
  readonly rows: Row[]
}

export interface Database {
  /** Which kind is in use, for messages and for tests that need to know. */
  readonly kind: 'built-in' | 'hosted'
  /** One statement, with values passed separately so nothing can be injected. */
  query<Row = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<QueryResult<Row>>
  /** Several statements at once. For migrations only. */
  exec(sql: string): Promise<void>
  /** Run a piece of work so that either all of it lands or none of it does. */
  transaction<T>(work: (tx: Database) => Promise<T>): Promise<T>
  close(): Promise<void>
}

/** Thrown when the database refuses something. Carries the code Postgres gave. */
export class DatabaseRuleError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
  ) {
    super(message)
    this.name = 'DatabaseRuleError'
  }
}

/**
 * The code PostgreSQL reports when one of our own rules refuses something.
 *
 * Every trigger in migrations/001_record.sql raises with `restrict_violation`,
 * which PostgreSQL reports as SQLSTATE 23001. Checked against a live database
 * rather than taken from memory — the first guess here was 2F004, which is wrong,
 * and the tests caught it.
 */
export const RULE_VIOLATION = '23001'

/**
 * Did the database refuse this because one of our own rules said no?
 *
 * Matching on the code rather than on the message. The messages are written for
 * people to read and will be reworded; a check that depends on their exact
 * wording would break quietly the first time someone improved one, and a broken
 * check that still returns `false` looks exactly like a passing test.
 *
 * Telling a refusal apart from a failure matters: "you may not change the record"
 * is the system working, not the system breaking.
 */
export function isRuleViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === RULE_VIOLATION
}

// ─────────────────────────────────────────────────────────────────────────────
// The built-in database
// ─────────────────────────────────────────────────────────────────────────────

type PGliteLike = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>
  exec: (sql: string) => Promise<unknown>
  transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>
  close: () => Promise<void>
}

function wrapPGlite(pg: PGliteLike, owned: boolean): Database {
  return {
    kind: 'built-in',
    async query<Row>(sql: string, params: readonly unknown[] = []) {
      const result = await pg.query(sql, [...params])
      return { rows: result.rows as Row[] }
    },
    async exec(sql: string) {
      await pg.exec(sql)
    },
    async transaction<T>(work: (tx: Database) => Promise<T>) {
      return pg.transaction(async (tx) => work(wrapPGlite(tx as PGliteLike, false)))
    },
    async close() {
      if (owned) await pg.close()
    },
  }
}

/**
 * Start the built-in database.
 *
 * With no path it lives in memory and vanishes when the process ends, which is
 * what tests want. With a path it persists to disk.
 */
export async function openBuiltIn(path?: string): Promise<Database> {
  const { PGlite } = await import('@electric-sql/pglite')
  const pg = (path ? new PGlite(path) : new PGlite()) as unknown as PGliteLike
  return wrapPGlite(pg, true)
}

// ─────────────────────────────────────────────────────────────────────────────
// A hosted PostgreSQL server
// ─────────────────────────────────────────────────────────────────────────────

export async function openHosted(connectionString: string): Promise<Database> {
  const pg = await import('pg')
  const pool = new pg.default.Pool({ connectionString, max: 4 })

  const wrap = (runner: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }, owned: boolean): Database => ({
    kind: 'hosted',
    async query<Row>(sql: string, params: readonly unknown[] = []) {
      const result = await runner.query(sql, [...params])
      return { rows: result.rows as Row[] }
    },
    async exec(sql: string) {
      await runner.query(sql)
    },
    async transaction<T>(work: (tx: Database) => Promise<T>) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const result = await work(wrap(client, false))
        await client.query('COMMIT')
        return result
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
    },
    async close() {
      if (owned) await pool.end()
    },
  })

  return wrap(pool, true)
}

/**
 * Open whichever database this environment is set up for.
 *
 * DATABASE_URL present and pointing somewhere real means hosted. Otherwise the
 * built-in one, so that someone who has just cloned this and typed `npm install`
 * gets a working database with no further steps.
 */
export async function openDatabase(env: NodeJS.ProcessEnv = process.env): Promise<Database> {
  const url = env['DATABASE_URL']?.trim()
  // The example value points at a local server that a fresh clone will not have.
  // Treating it as "not configured" is what keeps the no-setup promise true.
  const isPlaceholder = !url || url.includes('@localhost:5432/charter')
  if (isPlaceholder) {
    return openBuiltIn(env['CHARTER_DB_PATH'])
  }
  return openHosted(url)
}
