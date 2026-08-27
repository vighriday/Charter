/**
 * Bring a database up to date.
 *
 *     npm run db:migrate
 *
 * Migrations are plain SQL files in migrations/, applied in filename order. Each
 * one is applied once and recorded, so running this twice is safe.
 *
 * No migration framework. There are two tables and a handful of rules; a framework
 * would be more moving parts than the thing it manages, and one more thing for
 * someone evaluating this project to have to understand.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase, type Database } from './driver.js'
import { fingerprintBytes } from '../record/canonical.js'

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations')

export interface Applied {
  readonly name: string
  readonly alreadyDone: boolean
}

export async function migrate(db: Database, dir = MIGRATIONS_DIR): Promise<Applied[]> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      name       TEXT PRIMARY KEY,
      -- The fingerprint of the file as it was when applied. If a migration file is
      -- edited after it has run, the next run says so instead of silently doing
      -- nothing — a changed migration and an applied migration look identical by
      -- name alone, and that difference has ruined many afternoons.
      file_hash  TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `)

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  const done = await db.query<{ name: string; file_hash: string }>(
    'SELECT name, file_hash FROM migrations',
  )
  const seen = new Map(done.rows.map((r) => [r.name, r.file_hash]))

  const results: Applied[] = []
  for (const name of files) {
    const sql = readFileSync(join(dir, name), 'utf8')
    const hash = fingerprintBytes(new TextEncoder().encode(sql))
    const previous = seen.get(name)

    if (previous) {
      if (previous !== hash) {
        throw new Error(
          `migration ${name} has been edited since it was applied. Applied migrations ` +
            `are history and are never changed — add a new migration instead.`,
        )
      }
      results.push({ name, alreadyDone: true })
      continue
    }

    await db.exec(sql)
    await db.query('INSERT INTO migrations (name, file_hash) VALUES ($1, $2)', [name, hash])
    results.push({ name, alreadyDone: false })
  }

  return results
}

async function main(): Promise<void> {
  const db = await openDatabase()
  try {
    const applied = await migrate(db)
    console.log(`\nDatabase: ${db.kind}`)
    for (const { name, alreadyDone } of applied) {
      console.log(`  ${alreadyDone ? 'already done' : 'applied     '}  ${name}`)
    }
    console.log()
  } finally {
    await db.close()
  }
}

// Only run when invoked directly, not when imported by a test.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop()!)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
