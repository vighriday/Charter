/**
 * Which file can reach which.
 *
 * WHAT THIS IS
 *
 * A reader that opens every TypeScript file in this project, writes down every
 * other file each one pulls in, and then answers one question on demand: starting
 * at file A and following those links in any number of steps, can you arrive at
 * file B?
 *
 * WHY CHARTER NEEDS IT
 *
 * Charter's central promise is that the software never signs anything on a
 * person's behalf. The module that carries a finished document to a human for
 * their signature must therefore be out of the agent's reach — not "we were
 * careful", but genuinely unable to be called by any code the model can trigger.
 *
 * "Unable to be called" has an exact meaning in a program: there is no chain of
 * imports leading from the agent's code to that module. If no such chain exists,
 * the code physically cannot run it, whatever the model asks for. This file is
 * what checks that, and `tests/boundary.test.ts` is what fails the build when it
 * stops being true.
 *
 * The same check guards a second thing: the module holding the private key that
 * signs the head of our own record. If a tool the model can call could reach that
 * key, the model could write our record and then vouch for what it wrote. The
 * record would prove nothing.
 *
 * WHY IT READS THE CODE PROPERLY INSTEAD OF SEARCHING THE TEXT
 *
 * The obvious version searches each file for the word "import" and takes what
 * follows. That version is wrong in a way that matters here, because it cannot
 * tell code from writing about code. Every file in this project has a long comment
 * at the top, and those comments name other files constantly — the paragraph you
 * are reading names two. A text search would report links that do not exist, the
 * check would cry wolf, and a check people learn to ignore is worse than no check.
 *
 * It would also miss the links that actually matter. A file can pull in another
 * one four different ways, and only one of them looks like the word "import" at
 * the start of a line.
 *
 * So this uses the TypeScript compiler's own reader. It sees exactly what the
 * compiler sees: real code, never comments, never text inside quotes.
 *
 * THE FOUR WAYS ONE FILE PULLS IN ANOTHER
 *
 *   import { thing } from './other.js'      the ordinary way
 *   export { thing } from './other.js'      passing something straight through
 *   await import('./other.js')              deciding at the moment it is needed
 *   require('./other.js')                   the older way, still legal here
 *
 * All four are followed.
 *
 * THE ONE KIND OF LINK THAT IS NOT A LINK
 *
 *   import type { Shape } from './other.js'
 *
 * This asks only for the *description* of something — what shape the data has —
 * and it disappears completely when the code is built. Nothing is loaded and
 * nothing can be called through it. Counting it as reachability would report a
 * danger that cannot happen.
 *
 * These are still recorded, marked as the kind that vanishes, because the boundary
 * check treats a description-only mention of a guarded module as suspicious in its
 * own right, even though it is harmless on its own.
 *
 * THE HONEST LIMIT, STATED OUT LOUD
 *
 * This can only follow a link whose destination is written down in the code. A
 * program can also load a file whose name it works out while running:
 *
 *   await import(whateverThisTurnsOutToBe)
 *
 * Nothing reading the code can know where that goes. That is not a flaw we can fix
 * — it is a real hole in every check of this kind, in every language. So rather
 * than quietly skipping those, this reports each one, and the boundary test fails
 * the build if any exists anywhere in the project. The check refuses to be blind
 * rather than pretending it can see.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join, posix, sep } from 'node:path'
import ts from 'typescript'

// ─────────────────────────────────────────────────────────────────────────────
// What one file asks for
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Whether following this link can actually make code run.
 *
 *   value   Real. The other file is loaded and its code can be called.
 *   type    Description only. Gone once the code is built. Nothing can run.
 */
export type LinkKind = 'value' | 'type'

/** How the link was written, so a failure message can quote it back. */
export type LinkForm = 'import' | 'export from' | 'import()' | 'require()' | 'import() type'

/** One request by one file for another, before we work out where it points. */
export interface ImportRef {
  /** Exactly as written in the code, for example `'./canonical.js'`. */
  readonly specifier: string
  readonly kind: LinkKind
  readonly form: LinkForm
  /** Line number in the file, counting from 1, so a person can go and look. */
  readonly line: number
}

/**
 * A load whose destination is decided while the program runs, so no reader of the
 * code can know where it goes. Reported rather than skipped — see the note at the
 * top of this file about refusing to be blind.
 */
export interface OpaqueLoad {
  readonly form: 'import()' | 'require()'
  /** The code that decides the destination, quoted so a person can go and read it. */
  readonly argument: string
  readonly line: number
}

export interface FileImports {
  readonly imports: readonly ImportRef[]
  readonly opaque: readonly OpaqueLoad[]
}

/**
 * Read one file's source text and list everything it pulls in.
 *
 * `fileName` is only used for error positions, so any name works when testing.
 */
export function readImports(source: string, fileName = 'file.ts'): FileImports {
  const tree = ts.createSourceFile(fileName, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS)

  const imports: ImportRef[] = []
  const opaque: OpaqueLoad[] = []

  const lineOf = (node: ts.Node): number =>
    tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1

  /**
   * `require` is not a keyword — it is an ordinary name, and in a modern module it
   * has to be made first:
   *
   *   const require = createRequire(import.meta.url)
   *
   * It can be given any name at all. So before looking at calls, collect the names
   * that were made this way, and treat calls to any of them as loading a file.
   * `src/record/canonical.ts` does exactly this, and missing it would leave a real
   * link out of the graph.
   */
  const requireNames = new Set<string>(['require'])
  const findRequireMakers = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      node.initializer.expression.text === 'createRequire'
    ) {
      requireNames.add(node.name.text)
    }
    ts.forEachChild(node, findRequireMakers)
  }
  ts.forEachChild(tree, findRequireMakers)

  const readCallArgument = (node: ts.CallExpression, form: 'import()' | 'require()'): void => {
    const first = node.arguments[0]
    if (first !== undefined && ts.isStringLiteralLike(first)) {
      imports.push({ specifier: first.text, kind: 'value', form, line: lineOf(node) })
      return
    }
    opaque.push({
      form,
      argument: first === undefined ? '(nothing)' : first.getText(tree),
      line: lineOf(node),
    })
  }

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      imports.push({
        specifier: node.moduleSpecifier.text,
        kind: importClauseKind(node.importClause),
        form: 'import',
        line: lineOf(node),
      })
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      imports.push({
        specifier: node.moduleSpecifier.text,
        kind: exportClauseKind(node),
        form: 'export from',
        line: lineOf(node),
      })
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      readCallArgument(node, 'import()')
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      requireNames.has(node.expression.text)
    ) {
      readCallArgument(node, 'require()')
    } else if (ts.isImportTypeNode(node)) {
      // `type Row = import('./other.js').Row` — a description, so it vanishes.
      const literal = node.argument
      if (ts.isLiteralTypeNode(literal) && ts.isStringLiteralLike(literal.literal)) {
        imports.push({
          specifier: literal.literal.text,
          kind: 'type',
          form: 'import() type',
          line: lineOf(node),
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(tree, visit)

  return { imports, opaque }
}

/**
 * Does an ordinary import load the other file, or only describe it?
 *
 * Anything that brings in a real value loads it. Only a request made entirely of
 * descriptions vanishes.
 */
function importClauseKind(clause: ts.ImportClause | undefined): LinkKind {
  // `import './setup.js'` — asks for nothing, but runs the file for its effects.
  if (clause === undefined) return 'value'
  // `import type { A } from …` — the whole request is descriptions.
  if (clause.isTypeOnly) return 'type'
  // `import thing from …` — a real value.
  if (clause.name !== undefined) return 'value'

  const bindings = clause.namedBindings
  if (bindings === undefined) return 'value'
  // `import * as thing from …` — a real value.
  if (ts.isNamespaceImport(bindings)) return 'value'
  // `import {} from './x.js'` — asks for nothing by name, still loads the file.
  if (bindings.elements.length === 0) return 'value'
  // `import { a, type B } from …` — one real value is enough to load it.
  return bindings.elements.some((element) => !element.isTypeOnly) ? 'value' : 'type'
}

/** The same question for `export { … } from …`, which loads the file the same way. */
function exportClauseKind(node: ts.ExportDeclaration): LinkKind {
  if (node.isTypeOnly) return 'type'
  const clause = node.exportClause
  // `export * from …`
  if (clause === undefined) return 'value'
  // `export * as thing from …`
  if (ts.isNamespaceExport(clause)) return 'value'
  if (clause.elements.length === 0) return 'value'
  return clause.elements.some((element) => !element.isTypeOnly) ? 'value' : 'type'
}

// ─────────────────────────────────────────────────────────────────────────────
// Working out which file a request points at
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What a written destination turned out to be.
 *
 *   inside      Another file in this project. Followed.
 *   outside     A package, or something built into Node. Not followed, because it
 *               cannot lead back into our own code.
 *   missing     Written as a path inside this project, but no such file exists.
 *               Always a problem: it means the reader has gone blind at that
 *               point, and a blind spot is exactly where a boundary breaks.
 */
export type Resolution =
  | { readonly kind: 'inside'; readonly file: string }
  | { readonly kind: 'outside' }
  | { readonly kind: 'missing' }

/**
 * Turn a written destination into a real file in this project.
 *
 * This project is built for Node's newer module rules, which means code refers to
 * a neighbouring file by the name it will have *after* being built:
 *
 *   import { fingerprint } from './canonical.js'      // the file on disk is .ts
 *
 * So `.js` is turned back into `.ts` before looking. That is not a workaround; it
 * is how the compiler itself resolves these.
 */
export function resolveSpecifier(
  fromFile: string,
  specifier: string,
  known: ReadonlySet<string>,
): Resolution {
  // Anything not starting with a dot is a package name or something built into
  // Node. Neither can lead back into this project's own files.
  if (!specifier.startsWith('.')) return { kind: 'outside' }

  const target = posix.normalize(posix.join(posix.dirname(fromFile), specifier))

  const candidates = [
    target.replace(/\.js$/, '.ts'),
    target.replace(/\.mjs$/, '.mts'),
    target.replace(/\.cjs$/, '.cts'),
    target,
    `${target}.ts`,
    `${target}/index.ts`,
  ]
  for (const candidate of candidates) {
    if (known.has(candidate)) return { kind: 'inside', file: candidate }
  }
  return { kind: 'missing' }
}

// ─────────────────────────────────────────────────────────────────────────────
// The graph
// ─────────────────────────────────────────────────────────────────────────────

/** One file pulling in one other file in this project. */
export interface Link {
  readonly from: string
  readonly to: string
  readonly specifier: string
  readonly kind: LinkKind
  readonly form: LinkForm
  readonly line: number
}

/** A destination written as a path inside the project that points at no file. */
export interface MissingLink {
  readonly from: string
  readonly specifier: string
  readonly line: number
}

/** A load whose destination is decided while running, and which file it is in. */
export interface OpaqueLoadAt extends OpaqueLoad {
  readonly from: string
}

export interface Graph {
  /** Every file read, sorted, with `/` separators whatever the operating system. */
  readonly files: readonly string[]
  /** For each file, everything it pulls in from inside the project. */
  readonly links: ReadonlyMap<string, readonly Link[]>
  /** Destinations inside the project that point at no file. Should always be empty. */
  readonly missing: readonly MissingLink[]
  /** Loads no reader can follow. Should always be empty. */
  readonly opaque: readonly OpaqueLoadAt[]
}

/**
 * Build the graph from file contents.
 *
 * Taking the sources as plain text rather than reading the disk is what lets the
 * tests hand it small invented projects and prove the walking is correct — a check
 * that has never been shown to catch anything is a hope, not a check.
 */
export function buildGraph(sources: ReadonlyMap<string, string>): Graph {
  const files = [...sources.keys()].sort()
  const known = new Set(files)

  const links = new Map<string, Link[]>()
  const missing: MissingLink[] = []
  const opaque: OpaqueLoadAt[] = []

  for (const from of files) {
    const source = sources.get(from) ?? ''
    const found = readImports(source, from)
    const out: Link[] = []

    for (const ref of found.imports) {
      const where = resolveSpecifier(from, ref.specifier, known)
      if (where.kind === 'outside') continue
      if (where.kind === 'missing') {
        missing.push({ from, specifier: ref.specifier, line: ref.line })
        continue
      }
      out.push({
        from,
        to: where.file,
        specifier: ref.specifier,
        kind: ref.kind,
        form: ref.form,
        line: ref.line,
      })
    }

    for (const load of found.opaque) opaque.push({ ...load, from })
    links.set(from, out)
  }

  return { files, links, missing, opaque }
}

// ─────────────────────────────────────────────────────────────────────────────
// Asking the graph questions
// ─────────────────────────────────────────────────────────────────────────────

/** Which kinds of link count as "can reach". By default, only real ones. */
const REAL_ONLY: readonly LinkKind[] = ['value']

/**
 * The shortest chain of links from one file to another, or `null` if there is
 * none.
 *
 * Returning the chain rather than a yes-or-no is deliberate. When this check
 * fails, the person reading the failure needs to know *how* the two ended up
 * connected, and "somewhere in your project, something reaches something" is not
 * a thing anyone can act on.
 *
 * A file that pulls in itself, directly or in a loop, is normal in real code. The
 * walk visits each file at most once, so a loop ends the walk instead of hanging.
 */
export function chainBetween(
  graph: Graph,
  from: string,
  to: string,
  follow: readonly LinkKind[] = REAL_ONLY,
): Link[] | null {
  if (from === to) return []

  const arrivedBy = new Map<string, Link>()
  const seen = new Set<string>([from])
  const queue: string[] = [from]

  for (let head = 0; head < queue.length; head++) {
    const here = queue[head]
    if (here === undefined) continue
    for (const link of graph.links.get(here) ?? []) {
      if (!follow.includes(link.kind)) continue
      if (seen.has(link.to)) continue
      seen.add(link.to)
      arrivedBy.set(link.to, link)
      if (link.to === to) {
        const chain: Link[] = []
        let at: string = to
        while (at !== from) {
          const step = arrivedBy.get(at)
          if (step === undefined) break
          chain.unshift(step)
          at = step.from
        }
        return chain
      }
      queue.push(link.to)
    }
  }
  return null
}

/** Every file that can be arrived at from any of these starting points. */
export function reachableFrom(
  graph: Graph,
  starts: Iterable<string>,
  follow: readonly LinkKind[] = REAL_ONLY,
): Set<string> {
  const seen = new Set<string>()
  const queue: string[] = []
  for (const start of starts) {
    if (seen.has(start)) continue
    seen.add(start)
    queue.push(start)
  }
  for (let head = 0; head < queue.length; head++) {
    const here = queue[head]
    if (here === undefined) continue
    for (const link of graph.links.get(here) ?? []) {
      if (!follow.includes(link.kind)) continue
      if (seen.has(link.to)) continue
      seen.add(link.to)
      queue.push(link.to)
    }
  }
  return seen
}

/**
 * Every file that can arrive at any of these targets — the same walk, backwards.
 *
 * This is the question that has teeth. Asking "can the agent reach the signing
 * module" only tests the agent's code. Asking "who, in the whole project, can
 * reach the signing module" tests everything at once, and answers before a tool
 * handler exists to ask about.
 *
 * The targets themselves are included, because a file trivially reaches itself.
 */
export function reachersOf(
  graph: Graph,
  targets: Iterable<string>,
  follow: readonly LinkKind[] = REAL_ONLY,
): Set<string> {
  const backwards = new Map<string, string[]>()
  for (const outgoing of graph.links.values()) {
    for (const link of outgoing) {
      if (!follow.includes(link.kind)) continue
      const list = backwards.get(link.to)
      if (list === undefined) backwards.set(link.to, [link.from])
      else list.push(link.from)
    }
  }

  const seen = new Set<string>()
  const queue: string[] = []
  for (const target of targets) {
    if (seen.has(target)) continue
    seen.add(target)
    queue.push(target)
  }
  for (let head = 0; head < queue.length; head++) {
    const here = queue[head]
    if (here === undefined) continue
    for (const from of backwards.get(here) ?? []) {
      if (seen.has(from)) continue
      seen.add(from)
      queue.push(from)
    }
  }
  return seen
}

/**
 * Write a chain out the way a person reads it, with the line to go and look at.
 *
 *   src/tools/send.ts:12
 *     → src/pack/assemble.ts:4
 *     → src/sign/envelope.ts
 */
export function describeChain(chain: readonly Link[]): string {
  if (chain.length === 0) return '(the same file)'
  const first = chain[0]
  if (first === undefined) return '(the same file)'
  const lines = [`${first.from}:${first.line}`]
  for (const link of chain) lines.push(`  → ${link.to}${link.form === 'import' ? '' : `  (${link.form})`}`)
  return lines.join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading the project off the disk
// ─────────────────────────────────────────────────────────────────────────────

/** Turn a path into the one form used everywhere here: relative, with `/`. */
const asRepoPath = (root: string, absolute: string): string =>
  absolute.slice(root.length + 1).split(sep).join('/')

/**
 * Read every TypeScript file under the given folders.
 *
 * Description-only files (`.d.ts`) are skipped: they contain no code that can run,
 * so they cannot carry reachability, and including them would add links that mean
 * nothing.
 */
export function readSourceTree(root: string, folders: readonly string[]): Map<string, string> {
  const sources = new Map<string, string>()

  const walk = (absolute: string): void => {
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const child = join(absolute, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
        walk(child)
      } else if (/\.(ts|tsx|mts|cts)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        sources.set(asRepoPath(root, child), readFileSync(child, 'utf8'))
      }
    }
  }

  for (const folder of folders) {
    try {
      walk(join(root, folder))
    } catch {
      // A folder that does not exist yet is not an error. `src/tools/` arrives
      // when the tool registry is built, and the boundary policy says out loud
      // that it is not here yet.
    }
  }
  return sources
}
