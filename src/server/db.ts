import fs from 'node:fs';
import path from 'node:path';

// Persistence for the playable build.
//
// DEVIATION FROM ARCHITECTURE.md (§2, §5): the design specifies Postgres and Supabase. Neither Docker
// nor Postgres is available in the build environment, so this build uses Node's built-in SQLite.
// The game rules do NOT change: one atomic transaction per operation (BEGIN IMMEDIATE serializes
// writers, which plays the role of the per-question cohort lock), unique constraints for
// idempotency, and an append-only submission history. Moving to Postgres means reimplementing this
// small interface and the SQL dialect. It is not free, and it has not been done or tested.

type Param = string | number | bigint | null;

export interface Db {
  exec(sql: string): void;
  run(sql: string, ...params: Param[]): { changes: number };
  get<T>(sql: string, ...params: Param[]): T | undefined;
  all<T>(sql: string, ...params: Param[]): T[];
  /** Runs `fn` in one atomic transaction. Nested calls join the outer transaction. */
  tx<T>(fn: () => T): T;
}

interface Statement {
  run(...params: Param[]): { changes: number | bigint };
  get(...params: Param[]): unknown;
  all(...params: Param[]): unknown[];
}
interface NativeDb {
  exec(sql: string): void;
  prepare(sql: string): Statement;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,
  question_ids TEXT NOT NULL,
  scoring_config_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  mode TEXT NOT NULL CHECK (mode IN ('daily','practice')),
  challenge_id TEXT REFERENCES challenges(id),
  challenge_date TEXT,
  question_ids TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('lobby','active','challenge_complete','abandoned')),
  created_at INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_session_daily ON sessions(player_id, challenge_id) WHERE challenge_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_session_player ON sessions(player_id, created_at);
CREATE TABLE IF NOT EXISTS rounds (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  question_index INTEGER NOT NULL CHECK (question_index BETWEEN 1 AND 7),
  question_id TEXT NOT NULL,
  cohort_key TEXT,
  is_ranked INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('question_active','question_closing','reveal')),
  served_at INTEGER NOT NULL,
  -- served_at + 60 s until the player answers. The first accepted answer locks the round and sets
  -- closes_at to the moment it was accepted (and answered_at to the same value).
  closes_at INTEGER NOT NULL,
  answered_at INTEGER,
  finalized_at INTEGER,
  cohort_sequence INTEGER,
  UNIQUE (session_id, question_index),
  CHECK (closes_at BETWEEN served_at AND served_at + 60000),
  CHECK (answered_at IS NULL OR answered_at = closes_at)
);
CREATE INDEX IF NOT EXISTS ix_round_cohort ON rounds(cohort_key, closes_at, id);
CREATE INDEX IF NOT EXISTS ix_round_due ON rounds(closes_at, id) WHERE state != 'reveal';
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES rounds(id),
  session_id TEXT NOT NULL REFERENCES sessions(id),
  request_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  raw_text TEXT,
  canonical_id TEXT,
  normalization_version INTEGER NOT NULL,
  matched_via TEXT,
  rejection TEXT,
  response_json TEXT NOT NULL,
  submitted_at INTEGER NOT NULL,
  UNIQUE (session_id, request_id)
);
CREATE INDEX IF NOT EXISTS ix_submission_round ON submissions(round_id, submitted_at);
-- The ONE locked answer of a round. Written once, never revised.
CREATE TABLE IF NOT EXISTS candidates (
  round_id TEXT PRIMARY KEY REFERENCES rounds(id),
  canonical_id TEXT NOT NULL,
  normalization_version INTEGER NOT NULL,
  matched_via TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cohort_counters (
  cohort_key TEXT PRIMARY KEY,
  next_sequence INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS final_answers (
  round_id TEXT PRIMARY KEY REFERENCES rounds(id),
  cohort_key TEXT NOT NULL,
  player_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  challenge_date TEXT NOT NULL,
  canonical_id TEXT,
  in_cohort INTEGER NOT NULL,
  cohort_sequence INTEGER NOT NULL,
  closes_at INTEGER NOT NULL,
  UNIQUE (cohort_key, cohort_sequence),
  UNIQUE (cohort_key, player_id)
);
CREATE INDEX IF NOT EXISTS ix_final_cohort ON final_answers(cohort_key, cohort_sequence);
CREATE INDEX IF NOT EXISTS ix_final_question ON final_answers(question_id, challenge_date);
CREATE TABLE IF NOT EXISTS scores (
  round_id TEXT PRIMARY KEY REFERENCES rounds(id),
  session_id TEXT NOT NULL REFERENCES sessions(id),
  question_id TEXT NOT NULL,
  question_version INTEGER NOT NULL,
  scoring_config_version INTEGER NOT NULL,
  alpha INTEGER NOT NULL,
  canonical_id TEXT,
  prior_ppm INTEGER,
  c_prior INTEGER NOT NULL,
  n_prior INTEGER NOT NULL,
  p_numerator TEXT,
  p_denominator TEXT,
  tier INTEGER,
  points INTEGER NOT NULL,
  depth_m INTEGER NOT NULL,
  popularity_json TEXT,
  normalization_version INTEGER,
  cohort_sequence INTEGER,
  finalized_at INTEGER NOT NULL,
  CHECK (depth_m = points * 10)
);
`;

/**
 * Loads Node's built-in SQLite. `process.getBuiltinModule` (Node 22.3+) is used because the two
 * obvious alternatives both fail here: Next's bundler rewrites `createRequire`/`require` and cannot
 * resolve the new `node:sqlite` builtin, and Vitest cannot import it with a plain `import`. Neither
 * bundler touches this call. Requires Node 22.5+ (node:sqlite).
 */
function loadSqlite(): new (location: string) => NativeDb {
  const getBuiltin = (process as unknown as { getBuiltinModule?: (id: string) => unknown })
    .getBuiltinModule;
  if (typeof getBuiltin !== 'function') {
    throw new Error('Stratos needs Node 22.5 or newer (process.getBuiltinModule and node:sqlite).');
  }
  const mod = getBuiltin.call(process, 'node:sqlite') as
    | { DatabaseSync?: new (location: string) => NativeDb }
    | undefined;
  if (!mod?.DatabaseSync) throw new Error('node:sqlite is not available in this Node build.');
  return mod.DatabaseSync;
}

export function openDb(file: string): Db {
  const DatabaseSync = loadSqlite();
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const native = new DatabaseSync(file);
  native.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (file !== ':memory:') native.exec('PRAGMA journal_mode = WAL;');
  native.exec(SCHEMA);

  const cache = new Map<string, Statement>();
  const prepare = (sql: string): Statement => {
    let statement = cache.get(sql);
    if (!statement) {
      statement = native.prepare(sql);
      cache.set(sql, statement);
    }
    return statement;
  };

  let depth = 0;
  return {
    exec: (sql) => native.exec(sql),
    run: (sql, ...params) => ({ changes: Number(prepare(sql).run(...params).changes) }),
    get: <T>(sql: string, ...params: Param[]) => prepare(sql).get(...params) as T | undefined,
    all: <T>(sql: string, ...params: Param[]) => prepare(sql).all(...params) as T[],
    tx<T>(fn: () => T): T {
      if (depth > 0) return fn();
      native.exec('BEGIN IMMEDIATE');
      depth = 1;
      try {
        const result = fn();
        native.exec('COMMIT');
        return result;
      } catch (error) {
        try {
          native.exec('ROLLBACK');
        } catch {
          // The transaction may already be gone. The original error is the one that matters.
        }
        throw error;
      } finally {
        depth = 0;
      }
    },
  };
}
