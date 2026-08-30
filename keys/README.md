# Keys

**What lives here.** The **public** half of Charter's attestation keypair, and
nothing else. It is committed to this public repository on purpose.

---

## Why publishing it is safe, and why it matters

Charter keeps a record of every step it takes. Each entry is fingerprinted
together with the fingerprint of the entry before it, so altering anything in the
middle breaks every link after it and a checker names the exact entry that moved.

There is one thing that chain cannot catch on its own: entries removed from the
**end**, because a shortened chain is still a valid chain. So the end of each
record is vouched for separately, using the private half of this keypair. That
statement is an **attestation**.

Publishing the public half means **anybody can check our record without asking us
for anything.**

```bash
npm run verify -- pack.pdf record.jsonl attestation.json
```

That reads the key from this folder, never from the pack. **A checker that took
its key out of the thing it was checking would prove nothing at all** — anybody
could invent a key, vouch for anything with it, and ship both together. The key
has to come from somewhere else, and this is that somewhere.

The public half only *checks* statements. It cannot make them, so publishing it
gives nothing away.

---

## A word we are careful about

This is an **attestation** — the machine vouching for its own conduct. It is not a
signature.

In Charter the word *signature* is reserved for something a person does, with
intent, to bind themselves. A machine may **seal** a document and **attest** over
its own record. Only a person signs.

The underlying operation is a digital signature in the ordinary cryptographic
sense, and pretending otherwise would be silly. The point is narrower: nothing in
this project's code, screens or writing calls a machine act a signature, because
the whole argument rests on that word meaning one thing. `npm run words:check`
fails the build if anything breaks it.

---

## Making your own keypair

```bash
npm run keys:generate
```

It writes the public half here, and the private half **straight into `.env`**,
which is never committed.

**It does not print the private half, and that is deliberate.** An earlier version
printed it and asked you to paste it. That puts a private key into terminal
scrollback, into the shell's saved history if it is ever echoed, and into any
recording of the session. Writing it directly means it exists in exactly one
place — the place already excluded from this repository.

`.env` holds real credentials, so the edit is deliberately narrow: exactly one
line changes, and the program checks that afterwards and refuses to save if any
other line would have moved.

---

## The key name

The readme publishes the **name** of the key committed here — the fingerprint of
the key itself, not the key.

That name is what somebody compares against a pack they were handed. A test
derives it from this file with the project's own code and fails the build if the
readme and this folder ever disagree, so the two cannot drift apart.
