-- The record, and the rules the database itself enforces.
--
-- WHY THE RULES LIVE HERE AND NOT IN OUR CODE
--
-- Charter's whole claim is that its record can be trusted. Code that is careful
-- not to change past entries is worth very little: the next person to touch it may
-- be less careful, a migration script bypasses it entirely, and anybody with the
-- connection string ignores it completely.
--
-- A rule enforced by the database is not bypassed by any of those. Not by our own
-- code, not by a future change to it, not by a migration script, and not by the
-- language model — which never gets near a connection in the first place, but the
-- guarantee should not depend on that.
--
-- So: UPDATE and DELETE on the events table are refused by a trigger.
--
-- WHAT THIS DOES NOT DO, MEASURED RATHER THAN ASSUMED
--
-- It does not stop somebody who holds the connection string and decides to switch
-- the rule off. That was tested rather than reasoned about, and two routes were
-- found:
--
--   SET session_replication_role = 'replica'   -- skips ordinary triggers
--   ALTER TABLE events DISABLE TRIGGER ALL     -- needs only table ownership
--
-- The first is closed below, by creating the triggers with ENABLE ALWAYS so they
-- run in that mode too. The second cannot be closed: whoever owns a table can
-- always disable its triggers, and the role that runs this migration owns this
-- table by definition.
--
-- So the honest claim is not prevention. It is this: nobody gets around this by
-- accident, by carelessness, or through any ordinary code path — and somebody who
-- does it deliberately still cannot hide it, because every entry carries the
-- fingerprint of the one before it and the attestation covers the end of the
-- chain. A test proves that: it disables the triggers, changes a past entry, and
-- shows the checker naming the exact entry that moved.
--
-- Charter detects modification. It does not prevent it. Saying otherwise would be
-- a claim this code cannot back.

-- ─────────────────────────────────────────────────────────────────────────────
-- events — one row per thing that happened. Only ever added to.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
  -- Which formation run this belongs to.
  run_id        TEXT   NOT NULL,

  -- Position within this run, counting from 1.
  --
  -- Stored as a number here because a database column has a real integer type and
  -- cannot silently lose digits the way JavaScript can. It is converted to text
  -- before it is fingerprinted, which is where the danger actually lives.
  seq           BIGINT NOT NULL CHECK (seq >= 1),

  -- When it happened, exactly as it was fingerprinted: ISO 8601, milliseconds, Z.
  -- Text, not a timestamp column. A timestamp column would be re-formatted on the
  -- way out according to the server's settings, and the fingerprint would stop
  -- matching for a reason nobody would ever find.
  ts            TEXT   NOT NULL,

  kind          TEXT   NOT NULL,
  actor         TEXT   NOT NULL CHECK (actor IN ('system', 'model', 'human', 'vendor')),
  stage         TEXT,

  -- The fingerprint of the detail. The detail itself lives in event_payloads and
  -- may be deleted later; this stays, and every link still holds.
  payload_hash  TEXT   NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),

  prev_hash     TEXT   NOT NULL CHECK (prev_hash ~ '^[0-9a-f]{64}$'),
  hash          TEXT   NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),

  -- When our server wrote the row. Never fingerprinted, never part of the chain.
  -- It exists for operations — "when did this actually land?" — and deliberately
  -- has nothing to do with what the record says.
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (run_id, seq)
);

-- No two entries anywhere may share a fingerprint. Also the thing that makes two
-- writers racing for the same position fail loudly instead of quietly forking the
-- chain.
CREATE UNIQUE INDEX IF NOT EXISTS events_hash_unique ON events (hash);

CREATE INDEX IF NOT EXISTS events_run_seq ON events (run_id, seq);
CREATE INDEX IF NOT EXISTS events_kind ON events (kind);

-- ─────────────────────────────────────────────────────────────────────────────
-- event_payloads — the detail, kept apart on purpose so it can be forgotten
-- ─────────────────────────────────────────────────────────────────────────────
--
-- This is what makes "delete my personal data" possible without breaking a record
-- that only ever grows. The detail can go; its fingerprint stays in the chain, so
-- every link still holds and the deletion itself is recorded as a new entry.
--
-- A record that could not forget anything would be unusable for a product that
-- reads identity documents.
CREATE TABLE IF NOT EXISTS event_payloads (
  run_id      TEXT   NOT NULL,
  seq         BIGINT NOT NULL,
  payload     JSONB,
  redacted_at TIMESTAMPTZ,
  PRIMARY KEY (run_id, seq),
  FOREIGN KEY (run_id, seq) REFERENCES events (run_id, seq)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- The rules
-- ─────────────────────────────────────────────────────────────────────────────

-- Nothing changes or removes an entry in ordinary use. If a value must be
-- forgotten, its payload is cleared in the other table and the clearing is itself
-- recorded as a new entry.
CREATE OR REPLACE FUNCTION events_are_append_only() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'the record is append-only: entries can be added but never % (run %, entry %)',
    lower(TG_OP), OLD.run_id, OLD.seq
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS events_no_update ON events;
CREATE TRIGGER events_no_update BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION events_are_append_only();

DROP TRIGGER IF EXISTS events_no_delete ON events;
CREATE TRIGGER events_no_delete BEFORE DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION events_are_append_only();

-- ENABLE ALWAYS, and the reason is a route somebody actually found.
--
-- A trigger created the ordinary way is skipped when the session sets
-- `session_replication_role = 'replica'` — a documented, supported setting meant
-- for replication tools. In that mode an UPDATE on a past entry succeeded
-- silently. ALWAYS makes the trigger run in that mode too, which closes it.
--
-- It does not close `ALTER TABLE ... DISABLE TRIGGER`, and nothing can: the owner
-- of a table may always disable its triggers. That is stated in the note at the
-- top of this file rather than left for somebody to discover.
ALTER TABLE events ENABLE ALWAYS TRIGGER events_no_update;
ALTER TABLE events ENABLE ALWAYS TRIGGER events_no_delete;

-- An entry must follow on from the one before it.
--
-- Our own code computes the fingerprints, because the canonical text form is
-- defined by a standard the database does not implement. What the database checks
-- is the part it can check without any of that: that positions run 1, 2, 3 with no
-- gaps, and that each entry names the previous entry's fingerprint as its own
-- prev_hash.
--
-- That is the structural half of the guarantee, and it holds even against someone
-- writing rows by hand with a database client.
CREATE OR REPLACE FUNCTION events_must_follow_on() RETURNS TRIGGER AS $$
DECLARE
  last_seq  BIGINT;
  last_hash TEXT;
BEGIN
  SELECT e.seq, e.hash INTO last_seq, last_hash
  FROM events e
  WHERE e.run_id = NEW.run_id
  ORDER BY e.seq DESC
  LIMIT 1;

  IF last_seq IS NULL THEN
    IF NEW.seq <> 1 THEN
      RAISE EXCEPTION
        'the first entry of run % must be entry 1, not entry %', NEW.run_id, NEW.seq
        USING ERRCODE = 'restrict_violation';
    END IF;
    -- Where a run's chain begins is decided by our code, which derives it from the
    -- run itself. The database cannot recompute that, so it does not pretend to.
  ELSE
    IF NEW.seq <> last_seq + 1 THEN
      RAISE EXCEPTION
        'entries must run in order with no gaps: run % is at entry %, so the next must be %, not %',
        NEW.run_id, last_seq, last_seq + 1, NEW.seq
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.prev_hash <> last_hash THEN
      RAISE EXCEPTION
        'entry % of run % does not follow on from entry %', NEW.seq, NEW.run_id, last_seq
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS events_follow_on ON events;
CREATE TRIGGER events_follow_on BEFORE INSERT ON events
  FOR EACH ROW EXECUTE FUNCTION events_must_follow_on();

-- A payload may be cleared, but never changed into something else, and never
-- removed as a row. Clearing is how forgetting works; substitution would be
-- rewriting history through the one door left open.
CREATE OR REPLACE FUNCTION payloads_may_only_be_cleared() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'a payload row is never removed. To forget its contents, clear them instead (run %, entry %)',
      OLD.run_id, OLD.seq
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.payload IS NOT NULL THEN
    RAISE EXCEPTION
      'a payload may only be cleared, never replaced (run %, entry %)', OLD.run_id, OLD.seq
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.payload IS NULL THEN
    RAISE EXCEPTION
      'this payload has already been cleared (run %, entry %)', OLD.run_id, OLD.seq
      USING ERRCODE = 'restrict_violation';
  END IF;

  NEW.redacted_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payloads_clear_only ON event_payloads;
CREATE TRIGGER payloads_clear_only BEFORE UPDATE OR DELETE ON event_payloads
  FOR EACH ROW EXECUTE FUNCTION payloads_may_only_be_cleared();
