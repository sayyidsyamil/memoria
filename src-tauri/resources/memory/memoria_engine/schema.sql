CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

CREATE TABLE sources (
  source_id   TEXT PRIMARY KEY,           -- sha256 of the raw chunk; the text itself lives in Git
  meeting_id  TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,           -- chunk start, microseconds since epoch (UTC)
  uri         TEXT,
  git_commit  TEXT                        -- commit that stored the raw chunk, never one containing a fact row
);

CREATE TABLE entities (
  entity_id      TEXT PRIMARY KEY,
  kind           TEXT NOT NULL,
  canonical_name TEXT NOT NULL
);

CREATE TABLE entity_aliases (
  alias_norm TEXT PRIMARY KEY,
  entity_id  TEXT NOT NULL REFERENCES entities(entity_id),
  lang       TEXT
);

CREATE TABLE attribute_defs (
  attribute   TEXT PRIMARY KEY,
  cardinality TEXT NOT NULL CHECK (cardinality IN ('one', 'many'))
);

CREATE TABLE objects (
  object_id TEXT PRIMARY KEY,
  kind      TEXT NOT NULL CHECK (kind IN ('issue', 'decision', 'commitment')),
  issue_id  TEXT REFERENCES objects(object_id),
  label     TEXT
);

-- WHAT was claimed. Immutable. The claim holds from claim_from until claim_to (NULL = forever).
CREATE TABLE facts (
  fact_id            INTEGER PRIMARY KEY,
  object_id          TEXT NOT NULL REFERENCES objects(object_id),
  attribute          TEXT NOT NULL REFERENCES attribute_defs(attribute),
  discriminator      TEXT NOT NULL DEFAULT '',
  value_json         TEXT NOT NULL,
  claim_from         INTEGER NOT NULL,
  claim_to           INTEGER,
  decided_at         INTEGER NOT NULL,    -- when it was said (meeting time); orders competing claims
  rank_seq           INTEGER NOT NULL,    -- tie-break within the same decided_at: later ingestion wins
  change_type        TEXT NOT NULL CHECK (change_type IN
                       ('INITIAL', 'CONFIRM', 'REVISE', 'REVERSE', 'CANCEL', 'COMPLETE', 'CORRECT')),
  claim_from_basis   TEXT NOT NULL CHECK (claim_from_basis IN ('stated', 'meeting_time')),
  supersedes_fact_id INTEGER REFERENCES facts(fact_id),
  confirms_fact_id   INTEGER REFERENCES facts(fact_id),
  corrects_fact_id   INTEGER REFERENCES facts(fact_id),
  recorded_tx        INTEGER NOT NULL,
  CHECK (claim_to IS NULL OR claim_to > claim_from)
);
CREATE INDEX facts_slot ON facts(object_id, attribute, discriminator);

CREATE TABLE evidence (
  evidence_id     INTEGER PRIMARY KEY,
  fact_id         INTEGER NOT NULL REFERENCES facts(fact_id),
  source_id       TEXT NOT NULL REFERENCES sources(source_id),
  span_text       TEXT NOT NULL CHECK (length(span_text) > 0),
  speaker_id      TEXT,
  char_start      INTEGER,
  char_end        INTEGER,
  audio_start     REAL,
  audio_end       REAL,
  asr_model       TEXT,
  extractor_model TEXT,
  confidence      REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  recorded_tx     INTEGER NOT NULL,
  CHECK (char_end IS NULL OR char_start IS NULL OR char_end >= char_start),
  CHECK (audio_end IS NULL OR audio_start IS NULL OR audio_end >= audio_start)
);
CREATE INDEX evidence_fact ON evidence(fact_id);

-- "That fact was wrong": removes a fact from consideration in transaction time; the row stays.
CREATE TABLE retractions (
  fact_id  INTEGER PRIMARY KEY REFERENCES facts(fact_id),
  tx       INTEGER NOT NULL,
  reviewer TEXT NOT NULL,
  reason   TEXT NOT NULL
);

-- WHEN each fact was believed to be in force, and WHEN we believed it. Derived from facts; a row is
-- only ever inserted or expired (tx_end set), never edited or deleted.
CREATE TABLE validity (
  validity_id   INTEGER PRIMARY KEY,
  fact_id       INTEGER NOT NULL REFERENCES facts(fact_id),
  object_id     TEXT NOT NULL,
  attribute     TEXT NOT NULL,
  discriminator TEXT NOT NULL,
  valid_from    INTEGER NOT NULL,
  valid_to      INTEGER,                  -- NULL = still true
  tx_start      INTEGER NOT NULL,
  tx_end        INTEGER,                  -- NULL = still believed
  CHECK (valid_to IS NULL OR valid_to > valid_from),
  CHECK (tx_end IS NULL OR tx_end > tx_start)
);
CREATE INDEX validity_current ON validity(object_id, attribute, discriminator) WHERE tx_end IS NULL;
CREATE INDEX validity_asof ON validity(object_id, attribute, discriminator, tx_start, tx_end);
CREATE UNIQUE INDEX one_open_belief ON validity(object_id, attribute, discriminator)
  WHERE tx_end IS NULL AND valid_to IS NULL;

CREATE TRIGGER validity_no_overlap BEFORE INSERT ON validity
WHEN NEW.tx_end IS NULL AND EXISTS (
  SELECT 1 FROM validity v
  WHERE v.object_id = NEW.object_id AND v.attribute = NEW.attribute AND v.discriminator = NEW.discriminator
    AND v.tx_end IS NULL
    AND v.valid_from < COALESCE(NEW.valid_to, 9223372036854775807)
    AND NEW.valid_from < COALESCE(v.valid_to, 9223372036854775807))
BEGIN SELECT RAISE(ABORT, 'overlapping current belief in slot'); END;

CREATE TRIGGER validity_expire_only BEFORE UPDATE ON validity
WHEN NOT (OLD.tx_end IS NULL AND NEW.tx_end IS NOT NULL
  AND NEW.validity_id = OLD.validity_id AND NEW.fact_id = OLD.fact_id
  AND NEW.object_id = OLD.object_id AND NEW.attribute = OLD.attribute AND NEW.discriminator = OLD.discriminator
  AND NEW.valid_from = OLD.valid_from AND NEW.valid_to IS OLD.valid_to AND NEW.tx_start = OLD.tx_start)
BEGIN SELECT RAISE(ABORT, 'validity rows may only be expired, never edited'); END;

CREATE TRIGGER validity_no_delete BEFORE DELETE ON validity
BEGIN SELECT RAISE(ABORT, 'validity is append-only'); END;

-- Human-confirm staging: a proposal changes no belief until a reviewer accepts it.
CREATE TABLE proposals (
  proposal_id  INTEGER PRIMARY KEY,
  created_tx   INTEGER NOT NULL,
  payload_json TEXT NOT NULL,             -- the assert_fact arguments, verbatim
  base_fact_id INTEGER REFERENCES facts(fact_id),  -- the fact it would supersede or confirm
  confidence   REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  reason       TEXT
);

CREATE TABLE reviews (
  review_id         INTEGER PRIMARY KEY,
  proposal_id       INTEGER NOT NULL UNIQUE REFERENCES proposals(proposal_id),
  reviewer          TEXT NOT NULL,
  outcome           TEXT NOT NULL CHECK (outcome IN ('accepted', 'accepted_edited', 'rejected')),
  note              TEXT,
  resulting_fact_id INTEGER REFERENCES facts(fact_id),
  tx                INTEGER NOT NULL
);
