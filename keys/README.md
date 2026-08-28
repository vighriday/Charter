# Keys

**What lives here.** The **public** half of Charter's attestation keypair, and
nothing else. It is committed to this public repository on purpose.

**Why that is safe, and why it matters.** Charter keeps a record of every step it
takes, where each entry is fingerprinted together with the fingerprint of the
entry before it — so altering anything in the middle breaks every link after it.
The final fingerprint is signed with the private half of this keypair, which lives
only in a local environment file and is never committed.

Publishing the public half means **anyone can verify our record without asking us
for anything.** Clone the repository, download a Formation Pack, run the verifier,
and it checks the record against the key that was here all along.

A verifier that loaded its key from the file it was checking would prove nothing
at all. That is why the key lives here and not in the pack.

**A word we are careful about.** This is an **attestation** — the system vouching
for its own conduct. It is not a signature. In Charter, the word *signature* is
reserved for something a person does, with intent, to bind themselves. A machine
may seal and attest. Only a human signs.

**To generate a keypair:** `npm run keys:generate`
It writes the public half here and prints the private half for you to paste into
your local `.env`.
