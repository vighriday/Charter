import { describe, it, expect } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  readImports,
  resolveSpecifier,
  buildGraph,
  chainBetween,
  reachersOf,
  reachableFrom,
  describeChain,
  readSourceTree,
} from '../src/boundary/graph.js'
import { BOUNDARIES, AGENT_REACHABLE, matches, filesMatching } from '../src/boundary/policy.js'

/**
 * The boundary check.
 *
 * Charter's central promise is that the software never signs anything on a
 * person's behalf. One of the four things holding that promise up is this: the
 * module that asks a human to sign is not reachable from any code the model can
 * trigger — not by a direct call, and not through any chain of imports of any
 * length. Code that cannot be reached cannot be run, whatever the model asks for.
 *
 * The same check guards the private key that vouches for our own record, for the
 * same reason: if the model could reach that key, it could write the record and
 * then vouch for what it wrote.
 *
 * This file is what makes those claims true rather than stated. It is written in
 * two halves, and the first half matters as much as the second.
 *
 *   FIRST — prove the checker works. Small invented projects, each with a known
 *   answer, including ones where the guarded module IS reachable. A check that has
 *   only ever been run against clean code has never been shown to catch anything,
 *   and would pass just as happily if it were broken.
 *
 *   SECOND — run it on this project.
 *
 * WHY IT ONLY WALKS `src/`
 *
 * `src/` is the program. Tests are not shipped and cannot be triggered by the
 * model, so requiring every test file to be written down as a permitted caller
 * would add noise without adding safety.
 *
 * That leaves an obvious hole — a handler could reach a guarded module by going
 * out through a test file and back. It is closed, and closed by accident of a more
 * important rule: any import pointing at a path inside the project that the walk
 * did not read is reported as a missing link, and a missing link fails the build.
 * A route out of `src/` is a route the checker cannot see, and the checker refuses
 * to be blind rather than assuming the best.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const project = buildGraph(readSourceTree(ROOT, ['src']))

// ─────────────────────────────────────────────────────────────────────────────
// First half — prove the checker actually works
// ─────────────────────────────────────────────────────────────────────────────

describe('reading what one file pulls in', () => {
  it('finds an ordinary import', () => {
    const { imports } = readImports(`import { a } from './other.js'`)
    expect(imports).toEqual([
      { specifier: './other.js', kind: 'value', form: 'import', line: 1 },
    ])
  })

  it('finds a file pulled in only for its side effects', () => {
    // No names asked for, but the file still runs.
    const { imports } = readImports(`import './setup.js'`)
    expect(imports[0]).toMatchObject({ specifier: './setup.js', kind: 'value' })
  })

  it('finds something passed straight through with export from', () => {
    const { imports } = readImports(`export { sign } from './sign/envelope.js'`)
    expect(imports[0]).toMatchObject({ specifier: './sign/envelope.js', kind: 'value', form: 'export from' })
  })

  it('finds export star, which pulls in everything', () => {
    const { imports } = readImports(`export * from './sign/envelope.js'`)
    expect(imports[0]).toMatchObject({ kind: 'value', form: 'export from' })
  })

  it('finds a file loaded at the moment it is needed', () => {
    const { imports } = readImports(`async function go() { await import('./sign/envelope.js') }`)
    expect(imports[0]).toMatchObject({ specifier: './sign/envelope.js', kind: 'value', form: 'import()' })
  })

  it('finds the older way of loading a file', () => {
    const { imports } = readImports(`const x = require('./sign/envelope.js')`)
    expect(imports[0]).toMatchObject({ specifier: './sign/envelope.js', form: 'require()' })
  })

  it('finds it even when the loader was made by hand under another name', () => {
    // This is exactly what src/record/canonical.ts does. A checker that only knew
    // the literal word "require" would miss a real link.
    const { imports } = readImports(`
      import { createRequire } from 'node:module'
      const load = createRequire(import.meta.url)
      const x = load('./sign/envelope.js')
    `)
    expect(imports.map((i) => i.specifier)).toContain('./sign/envelope.js')
  })

  it('reports the line, so a person can go and look', () => {
    const { imports } = readImports(`// one\n// two\nimport { a } from './other.js'`)
    expect(imports[0]?.line).toBe(3)
  })
})

describe('telling a real link from one that vanishes', () => {
  it('knows a description-only import is erased and carries nothing', () => {
    const { imports } = readImports(`import type { Shape } from './other.js'`)
    expect(imports[0]?.kind).toBe('type')
  })

  it('knows a mixed import still loads the file', () => {
    // One real value is enough. The file is loaded, so the link is real.
    const { imports } = readImports(`import { run, type Shape } from './other.js'`)
    expect(imports[0]?.kind).toBe('value')
  })

  it('knows an import made only of descriptions is erased', () => {
    const { imports } = readImports(`import { type A, type B } from './other.js'`)
    expect(imports[0]?.kind).toBe('type')
  })

  it('knows an empty import still loads the file', () => {
    // `import {} from` asks for no names but is not erased — the file runs.
    const { imports } = readImports(`import {} from './other.js'`)
    expect(imports[0]?.kind).toBe('value')
  })

  it('knows a default import and a namespace import are both real', () => {
    expect(readImports(`import thing from './a.js'`).imports[0]?.kind).toBe('value')
    expect(readImports(`import * as thing from './b.js'`).imports[0]?.kind).toBe('value')
  })

  it('knows a description written inline is erased', () => {
    const { imports } = readImports(`type Row = import('./other.js').Row`)
    expect(imports[0]).toMatchObject({ specifier: './other.js', kind: 'type', form: 'import() type' })
  })

  it('knows export type is erased but plain export from is not', () => {
    expect(readImports(`export type { A } from './a.js'`).imports[0]?.kind).toBe('type')
    expect(readImports(`export { A } from './a.js'`).imports[0]?.kind).toBe('value')
  })
})

describe('not confusing writing about code with code', () => {
  it('ignores a file named in a comment', () => {
    // The reason this checker reads the code properly instead of searching the
    // text. Every file in this project has a comment naming other files.
    const source = `
      /**
       * This talks to src/sign/envelope.ts, but only in words.
       * import { sign } from './sign/envelope.js'
       */
      import { a } from './safe.js'
    `
    expect(readImports(source).imports.map((i) => i.specifier)).toEqual(['./safe.js'])
  })

  it('ignores a file named inside quotes', () => {
    const source = `const message = "import { sign } from './sign/envelope.js'"`
    expect(readImports(source).imports).toEqual([])
  })

  it('ignores a file named in a single-line comment', () => {
    const source = `// import { sign } from './sign/envelope.js'\nimport { a } from './safe.js'`
    expect(readImports(source).imports.map((i) => i.specifier)).toEqual(['./safe.js'])
  })
})

describe('refusing to be blind', () => {
  it('reports a load whose destination is decided while running', () => {
    // Nothing reading the code can know where this goes. Reporting it is the
    // honest answer; skipping it would let one line defeat the whole check.
    const { opaque } = readImports(`async function go(where: string) { await import(where) }`)
    expect(opaque).toEqual([{ form: 'import()', argument: 'where', line: 1 }])
  })

  it('reports a built-up destination too', () => {
    const { opaque } = readImports('const x = require(`./' + '${name}.js`)')
    expect(opaque[0]?.form).toBe('require()')
  })

  it('reports an import inside the project that points at no file', () => {
    const graph = buildGraph(new Map([['src/a.ts', `import { x } from './gone.js'`]]))
    expect(graph.missing).toEqual([{ from: 'src/a.ts', specifier: './gone.js', line: 1 }])
    // And no link is invented for it.
    expect(graph.links.get('src/a.ts')).toEqual([])
  })
})

describe('working out which file a destination points at', () => {
  const known = new Set(['src/a.ts', 'src/deep/b.ts', 'src/deep/index.ts'])

  it('turns the built name back into the file on disk', () => {
    // Code refers to a neighbour by the name it will have after being built.
    expect(resolveSpecifier('src/x.ts', './a.js', known)).toEqual({ kind: 'inside', file: 'src/a.ts' })
  })

  it('follows a path up and back down', () => {
    expect(resolveSpecifier('src/deep/b.ts', '../a.js', known)).toEqual({ kind: 'inside', file: 'src/a.ts' })
  })

  it('finds a folder with an index file', () => {
    expect(resolveSpecifier('src/a.ts', './deep', known)).toEqual({ kind: 'inside', file: 'src/deep/index.ts' })
  })

  it('treats a package as outside, because it cannot lead back to our code', () => {
    expect(resolveSpecifier('src/a.ts', 'zod', known)).toEqual({ kind: 'outside' })
    expect(resolveSpecifier('src/a.ts', '@electric-sql/pglite', known)).toEqual({ kind: 'outside' })
  })

  it('treats something built into Node as outside', () => {
    expect(resolveSpecifier('src/a.ts', 'node:crypto', known)).toEqual({ kind: 'outside' })
  })

  it('says missing when a path inside the project points at nothing', () => {
    expect(resolveSpecifier('src/a.ts', './nowhere.js', known)).toEqual({ kind: 'missing' })
  })
})

describe('following the chain', () => {
  /** A tiny invented project: a handler four steps away from something guarded. */
  const longChain = new Map([
    ['src/tools/send.ts', `import { build } from '../pack/build.js'`],
    ['src/pack/build.ts', `import { stamp } from './stamp.js'`],
    ['src/pack/stamp.ts', `import { carry } from '../post/carry.js'`],
    ['src/post/carry.ts', `import { envelope } from '../sign/envelope.js'`],
    ['src/sign/envelope.ts', `export const envelope = () => {}`],
  ])

  it('catches a guarded module imported directly', () => {
    const graph = buildGraph(new Map([
      ['src/tools/send.ts', `import { envelope } from '../sign/envelope.js'`],
      ['src/sign/envelope.ts', `export const envelope = () => {}`],
    ]))
    const chain = chainBetween(graph, 'src/tools/send.ts', 'src/sign/envelope.ts')
    expect(chain).not.toBeNull()
    expect(chain).toHaveLength(1)
  })

  it('catches one four steps away, which is the case a person would miss', () => {
    const graph = buildGraph(longChain)
    const chain = chainBetween(graph, 'src/tools/send.ts', 'src/sign/envelope.ts')
    expect(chain).not.toBeNull()
    expect(chain?.map((link) => link.to)).toEqual([
      'src/pack/build.ts',
      'src/pack/stamp.ts',
      'src/post/carry.ts',
      'src/sign/envelope.ts',
    ])
  })

  it('shows the route, because a failure nobody can act on is no use', () => {
    const graph = buildGraph(longChain)
    const chain = chainBetween(graph, 'src/tools/send.ts', 'src/sign/envelope.ts')
    const written = describeChain(chain ?? [])
    expect(written).toContain('src/tools/send.ts:1')
    expect(written).toContain('→ src/sign/envelope.ts')
  })

  it('catches one reached only when the code runs', () => {
    const graph = buildGraph(new Map([
      ['src/tools/send.ts', `export async function go() { await import('../sign/envelope.js') }`],
      ['src/sign/envelope.ts', `export const envelope = () => {}`],
    ]))
    expect(chainBetween(graph, 'src/tools/send.ts', 'src/sign/envelope.ts')).not.toBeNull()
  })

  it('does not invent a link that is not there', () => {
    const graph = buildGraph(new Map([
      ['src/tools/send.ts', `import { a } from '../safe/a.js'`],
      ['src/safe/a.ts', `export const a = 1`],
      ['src/sign/envelope.ts', `export const envelope = () => {}`],
    ]))
    expect(chainBetween(graph, 'src/tools/send.ts', 'src/sign/envelope.ts')).toBeNull()
  })

  it('does not count a description-only mention as reach', () => {
    // Erased when the code is built. Nothing is loaded and nothing can be called.
    const graph = buildGraph(new Map([
      ['src/tools/send.ts', `import type { Envelope } from '../sign/envelope.js'`],
      ['src/sign/envelope.ts', `export interface Envelope { id: string }`],
    ]))
    expect(chainBetween(graph, 'src/tools/send.ts', 'src/sign/envelope.ts')).toBeNull()
    // But the mention is still there to be found, which the boundary rule uses.
    expect(chainBetween(graph, 'src/tools/send.ts', 'src/sign/envelope.ts', ['value', 'type'])).not.toBeNull()
  })

  it('does not let a chain pass through a description-only step', () => {
    const graph = buildGraph(new Map([
      ['src/tools/send.ts', `import { middle } from '../mid/middle.js'`],
      ['src/mid/middle.ts', `import type { E } from '../sign/envelope.js'\nexport const middle = 1`],
      ['src/sign/envelope.ts', `export interface E { id: string }`],
    ]))
    expect(chainBetween(graph, 'src/tools/send.ts', 'src/sign/envelope.ts')).toBeNull()
  })

  it('ends instead of hanging when files pull each other in a loop', () => {
    const graph = buildGraph(new Map([
      ['src/a.ts', `import { b } from './b.js'`],
      ['src/b.ts', `import { c } from './c.js'`],
      ['src/c.ts', `import { a } from './a.js'`],
    ]))
    expect(chainBetween(graph, 'src/a.ts', 'src/c.ts')).toHaveLength(2)
    expect(chainBetween(graph, 'src/a.ts', 'src/nowhere.ts')).toBeNull()
  })

  it('lists everyone who can reach a guarded module, walking backwards', () => {
    const graph = buildGraph(longChain)
    const reachers = reachersOf(graph, ['src/sign/envelope.ts'])
    expect([...reachers].sort()).toEqual([
      'src/pack/build.ts',
      'src/pack/stamp.ts',
      'src/post/carry.ts',
      'src/sign/envelope.ts',
      'src/tools/send.ts',
    ])
  })

  it('lists everything one file can arrive at', () => {
    const graph = buildGraph(longChain)
    expect(reachableFrom(graph, ['src/post/carry.ts']).size).toBe(2)
  })
})

describe('the whole rule, run against an invented project', () => {
  /**
   * The proof that the rules in policy.ts are enforced, not merely written.
   *
   * This project is shaped exactly like the real one, with one difference: a tool
   * handler four steps away from the signing module. If this check ever stops
   * catching that, the boundary claim is empty and the build should say so.
   */
  const withAViolation = new Map([
    ['src/tools/send.ts', `import { build } from '../pack/build.js'`],
    ['src/pack/build.ts', `import { carry } from '../post/carry.js'`],
    ['src/post/carry.ts', `import { envelope } from '../sign/envelope.js'`],
    ['src/sign/envelope.ts', `export const envelope = () => {}`],
  ])

  const signing = BOUNDARIES.find((b) => b.guards.includes('src/sign/'))

  it('has a rule about the signing module at all', () => {
    expect(signing).toBeDefined()
  })

  it('catches a handler that can reach the signing module through three others', () => {
    const graph = buildGraph(withAViolation)
    const handlers = filesMatching(graph.files, AGENT_REACHABLE)
    const guarded = filesMatching(graph.files, signing?.guards ?? [])

    expect(handlers).toEqual(['src/tools/send.ts'])
    expect(guarded).toEqual(['src/sign/envelope.ts'])

    const chain = chainBetween(graph, 'src/tools/send.ts', 'src/sign/envelope.ts')
    expect(chain).not.toBeNull()
  })

  it('catches a file that quietly gained the ability to reach a guarded module', () => {
    // The half of the rule that works before any handler exists: the complete set
    // of files able to reach a guarded module is written down, and anything not on
    // that list fails the build until somebody puts it there on purpose.
    const graph = buildGraph(withAViolation)
    const reachers = reachersOf(graph, ['src/sign/envelope.ts'])
    const allowed = ['src/sign/']
    const unexpected = [...reachers].filter((file) => !matches(file, allowed))
    expect(unexpected.sort()).toEqual(['src/pack/build.ts', 'src/post/carry.ts', 'src/tools/send.ts'])
  })

  it('is quiet when the same project has no route through', () => {
    // A check that fires on everything is a check people turn off.
    const clean = new Map(withAViolation)
    clean.set('src/post/carry.ts', `export const carry = () => {}`)
    const graph = buildGraph(clean)
    expect(chainBetween(graph, 'src/tools/send.ts', 'src/sign/envelope.ts')).toBeNull()
    expect([...reachersOf(graph, ['src/sign/envelope.ts'])]).toEqual(['src/sign/envelope.ts'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Second half — run it on this project
// ─────────────────────────────────────────────────────────────────────────────

describe('this project', () => {
  it('was actually read, rather than quietly finding nothing', () => {
    // Everything below would pass on an empty graph. This is what stops that.
    expect(project.files.length).toBeGreaterThan(5)
    expect(project.files).toContain('src/record/attestation.ts')
  })

  it('has no import pointing at a file that is not there', () => {
    // A destination the walk could not find is a place it has gone blind, and a
    // blind spot is exactly where a boundary breaks unnoticed. This is also what
    // closes the route out of `src/` and back in through a file not walked.
    const written = project.missing
      .map((m) => `${m.from}:${m.line} asks for ${m.specifier}, which is not a file that was read`)
      .join('\n')
    expect(written).toBe('')
  })

  it('loads nothing by a name worked out while running', () => {
    // One of these anywhere would make every claim below unprovable, because no
    // reader of the code can say where it goes.
    const written = project.opaque
      .map((o) => `${o.from}:${o.line} loads ${o.argument}, which cannot be followed by reading the code`)
      .join('\n')
    expect(written).toBe('')
  })

  it('guards at least one file that really exists', () => {
    // Stops the rules rotting into a list of names that match nothing, which would
    // pass forever while protecting nothing.
    const guardedNow = BOUNDARIES.flatMap((b) => filesMatching(project.files, b.guards))
    expect(guardedNow.length).toBeGreaterThan(0)
  })

  for (const boundary of BOUNDARIES) {
    describe(boundary.name, () => {
      const guarded = filesMatching(project.files, boundary.guards)

      if (boundary.notBuiltYet !== undefined) {
        it('is not built yet, and the rule says so out loud', () => {
          // A note that expires by itself. The day this module is written, this
          // fails and stays failing until the line is deleted and the rule below
          // starts doing real work. Nobody has to remember.
          expect(
            guarded,
            `${boundary.name} is marked "not built yet", but these files now exist: ` +
              `${guarded.join(', ')}. Delete notBuiltYet in src/boundary/policy.ts ` +
              `and fill in mayReach, so the rule is enforced from here on.`,
          ).toEqual([])
        })
        return
      }

      it('cannot be reached by anything the model can trigger', () => {
        const handlers = filesMatching(project.files, AGENT_REACHABLE)
        const routes: string[] = []
        for (const handler of handlers) {
          for (const target of guarded) {
            const chain = chainBetween(project, handler, target)
            if (chain !== null) {
              routes.push(`${handler} can reach ${target}:\n${describeChain(chain)}`)
            }
          }
        }
        expect(routes.join('\n\n')).toBe('')
      })

      it('is reached only by the files written down as allowed to', () => {
        const reachers = reachersOf(project, guarded)
        const unexpected = [...reachers]
          .filter((file) => !matches(file, boundary.guards) && !matches(file, boundary.mayReach))
          .sort()

        const routes = unexpected.map((file) => {
          const target = guarded.find((g) => chainBetween(project, file, g) !== null) ?? guarded[0] ?? ''
          return `${file} can reach ${boundary.name}:\n${describeChain(chainBetween(project, file, target) ?? [])}`
        })

        expect(
          routes.join('\n\n'),
          `Files not written down as allowed to reach ${boundary.name}. ` +
            `Either remove the import, or add them to mayReach in ` +
            `src/boundary/policy.ts with a reason. Permission is granted on ` +
            `purpose and in the open, never picked up by accident.`,
        ).toBe('')
      })

      it('has no stale permissions on its list', () => {
        // A name left on the list after the import went away is a standing
        // permission nobody meant to leave open.
        const reachers = reachersOf(project, guarded)
        const stale = boundary.mayReach.filter((pattern) => {
          const files = filesMatching(project.files, [pattern])
          return files.length === 0 || !files.some((file) => reachers.has(file))
        })
        expect(
          stale,
          `These are written down as allowed to reach ${boundary.name}, but no ` +
            `longer do — or no longer exist. Remove them from src/boundary/policy.ts.`,
        ).toEqual([])
      })
    })
  }

  it('has agent-reachable code for the reach check to walk', () => {
    // Until the tool registry existed, the reach check above walked an empty set
    // and passed for the wrong reason. It no longer can: this fails the moment
    // `src/tools/` and `src/agent/` stop holding anything, which is the only way
    // that check could quietly go back to proving nothing.
    const handlers = filesMatching(project.files, AGENT_REACHABLE)
    expect(
      handlers.length,
      `Nothing matches ${AGENT_REACHABLE.join(' or ')}, so the check that nothing the ` +
        `model can trigger reaches a guarded module is walking an empty set and ` +
        `passing for the wrong reason.`,
    ).toBeGreaterThan(0)
  })

  it('names every file the model can trigger, so the list can be read and argued with', () => {
    // Printed rather than counted. Somebody deciding whether to trust the boundary
    // should be able to see exactly which files it considers agent-reachable, and
    // say so if the list looks wrong to them.
    const handlers = filesMatching(project.files, AGENT_REACHABLE)
    expect(handlers).toContain('src/tools/registry.ts')
    expect(handlers).toContain('src/agent/loop.ts')
    for (const file of handlers) expect(file.startsWith('src/')).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Vendor versions that must not be built against
// ─────────────────────────────────────────────────────────────────────────────

describe('the registrar version', () => {
  /**
   * name.com has two versions of their service, and the one every search engine
   * points at is the old one.
   *
   * `www.name.com/api-docs` is now titled "[Deprecated] name.com v4 API
   * Documentation", and their own overview says it "will sunset at a
   * predetermined time in 2026" — the same year this is being built. The current
   * service is CORE v1, at `docs.name.com`, path `/core/v1/`.
   *
   * This is enforced rather than remembered because of who reads it. The person
   * judging this integration is name.com's Head of Product Engineering, whose
   * team built CORE v1. Code posting to `/v4/` would say, in the first file she
   * opened, that we never read past a search result — and nothing written
   * afterwards recovers that.
   *
   * It costs nothing today and arms itself the moment the registrar client is
   * written, which is the same shape as the boundary rules above.
   */
  it('is never the deprecated one', () => {
    const offences: string[] = []
    for (const [file, source] of readSourceTree(ROOT, ['src'])) {
      source.split('\n').forEach((line, index) => {
        // The path form and the host form of the old service. Written so that
        // this file's own explanation does not match itself.
        if (!/\/v4\/|name\.com\/api-docs/.test(line)) return

        // A comment saying NOT to use it is the opposite of using it, and the
        // registrar client explains this at the top for exactly the reason this
        // check exists. A rule that fires on its own warning is a rule people
        // learn to switch off.
        //
        // Narrow on purpose: the line has to BE a comment AND has to say plainly
        // that the old one is not the one. Anything that puts /v4/ into an
        // address still fails, comment or not.
        const isComment = /^\s*(\/\/|\*|\/\*)/.test(line)
        const denies = /\bnot\b|\bnever\b|deprecated|older|old one|sunset/i.test(line)
        if (isComment && denies) return

        offences.push(`${file}:${index + 1}  ${line.trim()}`)
      })
    }
    expect(
      offences.join('\n'),
      'This looks like the deprecated name.com v4 service. Use CORE v1 — base ' +
        'https://api.dev.name.com for the test environment, path /core/v1/. See ' +
        'docs/integrations/name-com.md.',
    ).toBe('')
  })
})
