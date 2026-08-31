/**
 * One page a person can open, built from the record and nothing else.
 *
 * WHAT THIS IS
 *
 * A single HTML file. No server, no build step, no framework, no network. It is
 * written at the end of a run and opened by double-clicking it, and everything on
 * it is read out of the append-only record that run produced.
 *
 * WHY A FILE AND NOT AN APPLICATION
 *
 * Everything this project argues rests on a stranger being able to check its work
 * without asking us for anything. An application would put the most persuasive
 * view of that work behind a server somebody has to run, a port somebody has to
 * free, and a build somebody has to trust. A file has none of those and survives
 * being emailed.
 *
 * It also cannot cheat. There is no live data source behind it: every number on
 * the page was read out of the record at the moment it was written, and the same
 * record is handed over beside it. Anybody can check one against the other.
 *
 * THE FOUR THINGS ON IT
 *
 *   1. **What Texas law does if you write nothing down.** Every line is a statute
 *      or a decided case. It appears first because it is the reason any of this
 *      exists.
 *   2. **Everything that happened**, in order, with who caused each entry. Four
 *      actors, and the ones caused by a person are the ones the software could not
 *      do for itself.
 *   3. **What Charter was asked to do and would not** — every refusal in the run,
 *      with its reason.
 *   4. **What can be checked, and by whom.** Including the things that cannot.
 *
 * WHAT IT MUST NEVER SAY
 *
 * It is legal information, never legal advice. Every line says what a statute does
 * or what a court held. Nothing says which split to choose, what either owner
 * should want, or what they ought to do.
 *
 * And it never says a spoken agreement is worthless. It is not: Texas makes an
 * oral or implied agreement a company agreement. What the cases show is that a
 * deal you have to PROVE is a deal you can lose entirely — which is worse than the
 * wrong version and simpler to say.
 */

/** One entry of the record, as this page needs it. */
export interface FeedEntry {
  readonly seq: string
  readonly kind: string
  readonly actor: string
  readonly stage: string | null
  readonly at: string
  /** The one-line description a person reads. */
  readonly detail: string
}

export interface ReportContents {
  readonly caseId: string
  readonly businessName: string
  readonly state: string
  readonly owners: readonly string[]
  readonly entries: readonly FeedEntry[]
  /** The sealed pack, if the run got that far. */
  readonly pack?: { readonly fingerprint: string; readonly sizeBytes: string }
  /** Whether an outside authority stamped the end of the record, and what that means. */
  readonly anchor: string
  /** Which of the outside services were real in this run, and which stood in. */
  readonly services: readonly string[]
  readonly generatedAt: string
}

/**
 * What Texas law does when nothing is written down.
 *
 * Every line is a statute or a decided case, quoted or cited. Nothing here says
 * what anybody should do, which is the line between information and advice.
 *
 * Written as data rather than as a block of text so that each claim carries its
 * own source, and so a claim with no source cannot be added without it being
 * obvious. A test fails the build if any line here has an empty source.
 */
export const WHAT_THE_LAW_DOES: readonly {
  readonly says: string
  readonly detail: string
  readonly source: string
}[] = [
  {
    says: 'You cannot leave, and you cannot remove each other.',
    detail:
      '"A member of a limited liability company may not withdraw or be expelled from ' +
      'the company." That is the complete text of the section.',
    source: 'Texas Business Organizations Code § 101.107',
  },
  {
    says: 'You cannot make the business pay you.',
    detail:
      'No owner can demand a distribution until the governing authority declares one.',
    source: 'Texas Business Organizations Code § 101.203',
  },
  {
    says: 'And no Texas court will invent a way out.',
    detail:
      'There is no oppression claim and no court-ordered buy-out in Texas. The only ' +
      'door is asking a court to close the company.',
    source: 'Ritchie v. Rupe, 443 S.W.3d 856 (Tex. 2014)',
  },
  {
    says: 'What you agreed is real — but only while you can prove it.',
    detail:
      'Texas makes an oral or implied agreement a company agreement, and a company ' +
      'agreement can displace almost every default in the title. So writing nothing ' +
      'down does not hand the decision to the state. It turns your deal into ' +
      'something you would have to prove.',
    source:
      'Texas Business Organizations Code §§ 101.001(1) and 101.052(c)',
  },
  {
    says: 'People lose doing that, and they lose everything rather than a slice.',
    detail:
      'Nothing, of a claimed one third, because there were no written records. And ' +
      'nothing, of a claimed one third, thrown out on the statute of frauds without ' +
      'the court ever deciding whether the deal existed at all.',
    source: 'Sohani v. Sunesara (Tex. App. 2018); Chase v. Hodge (5th Cir. 2024)',
  },
]

/** What the checker can establish, and what it deliberately cannot. */
export const WHAT_CAN_BE_CHECKED: readonly { readonly can: boolean; readonly what: string }[] = [
  { can: true, what: 'That the pack has not changed by one byte since it was sealed.' },
  { can: true, what: 'That the seal allows only filling in and signing, and nothing else.' },
  { can: true, what: 'That the record has not been altered anywhere in the middle.' },
  {
    can: true,
    what:
      'That nothing has been removed from the END of the record, which the chain ' +
      'cannot show on its own because a shortened chain is still a valid chain.',
  },
  {
    can: false,
    what:
      'Who sealed it. The certificate is issued by Charter to Charter, so no outside ' +
      'authority has checked that Charter is who it says it is. A PDF reader will say ' +
      'the same thing.',
  },
  {
    can: false,
    what:
      'Whether the agreement is right for these people. Nothing here is a review of ' +
      'the document and nothing here is legal advice.',
  },
]

/** Turn text into something safe to put inside a page. */
export function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** How each actor is described, in plain words, for somebody reading the feed. */
export const ACTOR_MEANING: Readonly<Record<string, string>> = {
  human: 'a person did this, and the software could not',
  model: 'the model chose this, and every choice was checked before it ran',
  system: 'ordinary code, following a rule nobody can talk out of it',
  vendor: 'an outside service answered',
}

/** Whether an entry is a refusal, so it can be pulled into its own list. */
export function isRefusal(kind: string): boolean {
  return kind.includes('refused') || kind.includes('rejected') || kind.includes('abandoned')
}

const STYLE = `
  :root {
    --ink: #16161a; --quiet: #6b6b76; --line: #e3e3e8;
    --page: #ffffff; --panel: #f7f7f9;
    --human: #b3541e; --model: #3b5bdb; --system: #2f6f4f; --vendor: #6b4c9a;
    --no: #b3241e;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ink: #ececf1; --quiet: #9a9aa6; --line: #2a2a31;
      --page: #131317; --panel: #1a1a20;
      --human: #e08a4e; --model: #7c9aff; --system: #6fbf8f; --vendor: #b08ae0;
      --no: #ef6b63;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0 1.25rem 5rem;
    background: var(--page); color: var(--ink);
    font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  main { max-width: 52rem; margin: 0 auto; }
  h1 { font-size: 1.6rem; margin: 2.5rem 0 0.25rem; letter-spacing: -0.01em; }
  h2 {
    font-size: 1.05rem; margin: 3rem 0 0.75rem; padding-bottom: 0.4rem;
    border-bottom: 1px solid var(--line);
  }
  p { margin: 0 0 0.75rem; }
  .quiet { color: var(--quiet); }
  .lede { font-size: 1.05rem; }
  dl { margin: 0; }
  dt { font-weight: 600; margin-top: 1.1rem; }
  dd { margin: 0.15rem 0 0; }
  .source { color: var(--quiet); font-size: 0.85rem; margin-top: 0.2rem; }
  table { border-collapse: collapse; width: 100%; font-size: 0.86rem; }
  th, td { text-align: left; padding: 0.35rem 0.6rem 0.35rem 0; vertical-align: top; }
  th { color: var(--quiet); font-weight: 600; border-bottom: 1px solid var(--line); }
  tbody tr { border-bottom: 1px solid var(--line); }
  td.who { white-space: nowrap; font-weight: 600; }
  .human { color: var(--human); } .model { color: var(--model); }
  .system { color: var(--system); } .vendor { color: var(--vendor); }
  .scroll { overflow-x: auto; }
  .panel {
    background: var(--panel); border: 1px solid var(--line);
    border-radius: 10px; padding: 1rem 1.15rem; margin: 0 0 1rem;
  }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.85em; }
  .fingerprint { word-break: break-all; }
  ul { margin: 0 0 0.75rem; padding-left: 1.1rem; }
  li { margin: 0.3rem 0; }
  .no { color: var(--no); }
  .counts { display: flex; flex-wrap: wrap; gap: 1.5rem; margin: 0.5rem 0 1rem; }
  .counts div { min-width: 6rem; }
  .counts strong { display: block; font-size: 1.5rem; line-height: 1.2; }
`

/**
 * Write the whole page.
 *
 * One string, no dependencies, nothing loaded from anywhere. A page that fetched a
 * stylesheet or a font would stop looking right the moment it was opened without a
 * network, which is exactly the situation this project promises to work in.
 */
export function renderReport(contents: ReportContents): string {
  const counts = new Map<string, number>()
  for (const entry of contents.entries) {
    counts.set(entry.actor, (counts.get(entry.actor) ?? 0) + 1)
  }

  const refusals = contents.entries.filter((one) => isRefusal(one.kind))
  const byPeople = contents.entries.filter((one) => one.actor === 'human')

  const rows = contents.entries
    .map(
      (entry) =>
        `<tr>` +
        `<td class="quiet">${escape(entry.seq)}</td>` +
        `<td class="who ${escape(entry.actor)}">${escape(entry.actor)}</td>` +
        `<td class="quiet">${escape(entry.stage ?? '—')}</td>` +
        `<td><code>${escape(entry.kind)}</code></td>` +
        `<td>${escape(entry.detail)}</td>` +
        `</tr>`,
    )
    .join('\n')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(contents.businessName)} — what Charter did, and what it would not</title>
<style>${STYLE}</style>
</head>
<body>
<main>

<h1>${escape(contents.businessName)}</h1>
<p class="quiet">
  ${escape(contents.state)} &middot; ${escape(contents.owners.join(' and '))} &middot;
  case <code>${escape(contents.caseId)}</code>
</p>
<p class="lede">
  Everything on this page was read out of the record of one run. Nothing is fetched
  and nothing is live: the same record is handed over beside this file, so anybody
  can check one against the other.
</p>

<h2>If you never write this down, here is what Texas law does</h2>
<p class="quiet">
  This appears first because it is the reason any of the rest exists. Every line
  below says what a statute does or what a court held.
</p>
<dl>
${WHAT_THE_LAW_DOES.map(
  (one) =>
    `  <dt>${escape(one.says)}</dt>\n` +
    `  <dd>${escape(one.detail)}</dd>\n` +
    `  <dd class="source">${escape(one.source)}</dd>`,
).join('\n')}
</dl>
<p class="quiet">
  This is legal information and it is not legal advice. Nothing here says which
  split to choose, what either owner should want, or what anybody ought to do.
</p>

<h2>Everything that happened, and who caused it</h2>
<div class="counts">
${[...counts.entries()]
  .map(
    ([actor, count]) =>
      `  <div><strong class="${escape(actor)}">${count}</strong>` +
      `<span class="quiet">${escape(actor)}</span></div>`,
  )
  .join('\n')}
</div>
<ul>
${Object.entries(ACTOR_MEANING)
  .filter(([actor]) => counts.has(actor))
  .map(([actor, meaning]) => `  <li><strong class="${escape(actor)}">${escape(actor)}</strong> — ${escape(meaning)}</li>`)
  .join('\n')}
</ul>
<p>
  <strong>${byPeople.length} ${byPeople.length === 1 ? 'entry was' : 'entries were'}
  caused by a person.</strong> Each one is something the software could not do for
  itself, and none of them has a tool: answering a question, granting permission to
  spend, checking a value against the document it was read from, and approving that
  the pack be sent.
</p>
<div class="scroll">
<table>
<thead><tr><th>#</th><th>who</th><th>stage</th><th>what</th><th>detail</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</div>

<h2>What Charter was asked to do, and would not</h2>
${
  refusals.length === 0
    ? `<p class="quiet">Nothing was refused in this run.</p>`
    : `<ul>\n${refusals
        .map(
          (one) =>
            `  <li><code>${escape(one.kind)}</code> — ${escape(one.detail)}</li>`,
        )
        .join('\n')}\n</ul>`
}
<p class="quiet">
  Most software ships a list of what it can do. This is the other one, and it is
  the part that has to be checkable.
</p>

<h2>What is real in this run</h2>
<ul>
${contents.services.map((one) => `  <li>${escape(one)}</li>`).join('\n')}
</ul>

<h2>What can be checked, and what cannot</h2>
${
  contents.pack === undefined
    ? `<p class="quiet">No pack was sealed in this run.</p>`
    : `<div class="panel">
  <p><strong>The sealed pack</strong> — ${escape(contents.pack.sizeBytes)} bytes</p>
  <p class="fingerprint"><code>${escape(contents.pack.fingerprint)}</code></p>
  <p class="quiet">
    That is the fingerprint of exactly the bytes that were sealed. Compare it
    against the file you were handed.
  </p>
</div>`
}
<div class="panel">
  <p><strong>An outside timestamp</strong></p>
  <p class="quiet">${escape(contents.anchor)}</p>
</div>
<ul>
${WHAT_CAN_BE_CHECKED.map(
  (one) =>
    `  <li>${one.can ? '' : '<span class="no">Cannot be shown:</span> '}${escape(one.what)}</li>`,
).join('\n')}
</ul>
<p>Run this against the files beside this page:</p>
<p><code>npm run verify -- out/pack.pdf out/record.jsonl out/attestation.json</code></p>

<h2>The one line this software will not cross</h2>
<p>
  Charter sealed the pack and vouched for its own record of how it was made. It did
  not sign anything, and it is not able to.
</p>
<p class="quiet">
  The law lets software form a contract, with the result attributed to the person to
  be bound. But a signature is a process executed or adopted <em>by a person, with
  the intent to sign</em>. Forming may be delegated. The signature is the act of a
  person, and a machine has no intent to lend it.
</p>

<p class="quiet" style="margin-top:3rem">
  Written ${escape(contents.generatedAt)} from the record of case
  <code>${escape(contents.caseId)}</code>. No part of this page was fetched from
  anywhere.
</p>

</main>
</body>
</html>
`
}
