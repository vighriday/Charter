# Charter

**From idea to legally alive.**

You describe your business in plain English. Charter prepares everything around the
government filing — it researches the name, secures a web address, drafts the
ownership agreement, checks each owner's identity documents, assembles one signable
pack, and puts a live website online.

Then it stops, and hands the pack to the owners to sign **themselves**.

Built for businesses with **more than one owner**. Forming a business alone is
already solved and already free. Everything hard lives in the second owner — because
the difficulty was never the paperwork, it is writing down an agreement between
people who trust each other completely today and might not in three years.

---

## Try it in thirty seconds

No account. No key. No database to install. No network.

```bash
npm install
npm run record:demo
```

That runs a real PostgreSQL engine inside the Node process and shows five things:

1. A record being written — five entries, each carrying the fingerprint of the one
   before it.
2. Somebody altering entry three. The checker names exactly which entry changed,
   and shows the fingerprint it expected against the one it found.
3. The database refusing the alteration outright. Not our code being careful — a
   rule inside PostgreSQL, which returns `restrict_violation` and has no setting to
   turn it off.
4. **The one thing the chain cannot catch on its own.** Drop the last two entries
   and the chain still verifies perfectly, because a shortened chain is a valid
   chain. The attestation catches it. We show this rather than hiding it.
5. The same question asked twice, reaching the network once.

Everything else:

```bash
npm test          # 201 tests
npm run typecheck
npm run git:check # proves nothing secret is publishable, before every commit
```

`npm install` is the whole setup. There is no container to build, no database to
start, no port to free and no password to set. The append-only rules are installed
and enforced identically whether this runs on your laptop or against a hosted
PostgreSQL.

---

## The line this software will not cross

**Charter never signs anything on a human's behalf.**

Not as a setting. Not as a policy that could be changed. As a property of how it is
built.

The law here is more subtle than the usual slogan, and getting it right matters. The
Uniform Electronic Transactions Act, section 14, **does** let a contract be formed
by electronic agents with no person aware of it. So the honest claim is not "a
machine may not act." It is this:

> The law lets an agent **form** a contract, with the result attributed to the
> person to be bound. But it defines a **signature** as a process executed or
> adopted *by a person, with the intent to sign*. Formation may be delegated. The
> signature is the act of a person, and a machine has no intent to lend it.

Charter is built along that line, not across it.

**Part of that is already checkable, on your machine, right now.**

The module that carries a document to a person and asks them to sign it must be out
of the agent's reach — not "we were careful", but genuinely unable to be called by
anything the model can trigger. In a program that has an exact meaning: there is no
chain of imports leading from the agent's code to that module. Code that cannot be
reached cannot be run, whatever the model asks for.

So it is a test rather than a promise. `npm test` reads every file in `src/`,
follows every import, and fails if anything the model can trigger can arrive at the
signing module — or at the private key that vouches for Charter's own record, which
is guarded for the same reason. The rules it enforces sit in one short file,
[src/boundary/policy.ts](src/boundary/policy.ts), written to be read without reading
any code.

Half of that test exists to prove the check works. It runs the same rules against
small invented projects where the guarded module *is* reachable — directly, four
steps away, and loaded only at the moment it is needed — and requires every one to
be caught. A check that has only ever seen clean code has never been shown to catch
anything, and would pass just as happily if it were broken.

One limit, said out loud: nothing that reads code can follow a file loaded by a name
the program works out while running. Rather than skipping those, the check reports
every one and fails the build if a single one exists. It refuses to be blind rather
than assuming the best.

**And the honest state today.** The signing module itself is not written yet — that
comes later in the build. Its rule is already in place and already armed: the moment
that folder exists, the build fails until the rule is switched from "not built yet"
to enforcing, so it cannot be quietly skipped. The same check is doing real work
right now on the attestation key, where the only two files allowed to reach it are
both commands a person types into a terminal.

---

## Three words, and their meanings never move

| Word | What it means here |
| --- | --- |
| **Seal** | What the machine puts on a document it made |
| **Attestation** | What the machine puts over its own record, vouching for its own conduct |
| **Signature** | What a **person** does. The word is never used for anything a machine does |

Anywhere the code, the screens or the writing breaks that, it is a bug.

Two words are never used: *immutable* and *tamper-proof*. The record is
**append-only** and **tamper-evident**. Charter detects modification; it does not
prevent it. Claiming prevention would be a claim the code cannot back.

---

## What is built, and what is not

Honest, because the demonstration above is checkable and this table should be too.

| Part | State |
| --- | --- |
| Canonical text form, so a fingerprint reproduces on any machine (RFC 8785) | **built, 26 tests** |
| The chained record, and the checker that names the first broken link | **built, 25 tests** |
| Attestation over the head of the record (Ed25519, Node's own cryptography) | **built, 22 tests** |
| Append-only rules enforced inside PostgreSQL, not by our code | **built, 21 tests** |
| Record-and-replay, so the whole thing runs with no credentials | **built, 19 tests** |
| Model adapter — two verbs, never combined; replies kept exactly as they arrived | **built, 88 tests** |
| The rule that a person's details may only reach a service that keeps nothing | **built, with a test proving the ineligible service is never called** |
| The consent boundary as a code boundary — nothing the model can trigger can reach the signing module or the attestation key | **built, 49 tests**, armed before the module it guards exists |
| The eight stages, and the agent that moves through them | not yet |
| The verifier a stranger runs against a finished pack | not yet |
| The outside services — documents, identity, registrar, search, signing | not yet |

The demonstration only shows what exists. Nothing in it is staged.

---

## Licence

No licence file, which means all rights are reserved. Design notes, decisions and
research for this project are not published.

---

*Built for the DevNetwork [API + Cloud + AI] Hackathon 2026.*
