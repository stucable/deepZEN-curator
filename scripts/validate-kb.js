#!/usr/bin/env node
/**
 * scripts/validate-kb.js
 *
 * Validates the seven knowledge-base CSV files in kb-draft/ (or a
 * directory passed as argv[2]) against the schema invariants in
 * kb-draft/SCHEMAS.md §5.
 *
 * Approach: load each CSV with PapaParse, coerce empty cells to null
 * and typed cells to JS numbers, bulk-insert into an in-memory SQLite
 * database (STRICT mode) with foreign keys disabled, then enable FKs
 * and run
 *   (a) SQLite's built-in `PRAGMA foreign_key_check`, and
 *   (b) a battery of polymorphic-FK and semantic-invariant queries
 *       that SQL constraints cannot express.
 *
 * Exits 0 on a clean run, 1 if any check fails. Prints a tidy report
 * with up to five example violations per failing check so failures are
 * easy to track down.
 *
 * Usage:   node scripts/validate-kb.js [kb-dir]
 * Requires: npm i -D better-sqlite3 papaparse
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import Papa from 'papaparse';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KB_DIR = process.argv[2] ?? join(__dirname, '..', 'kb-draft');

// ───── Schema ──────────────────────────────────────────────────────────
// Mirrors kb-draft/SCHEMAS.md §3. STRICT tables (SQLite ≥3.37) so type
// coercion errors fail loudly at INSERT time rather than silently
// storing strings in REAL columns. Foreign keys are enforced post-load
// to sidestep self-FK ordering on locality and concept.

const DDL = `
CREATE TABLE locality (
  locality_id        TEXT NOT NULL PRIMARY KEY,
  level              TEXT NOT NULL CHECK (level IN (
    'country','region','district','commune','fokontany',
    'park','forest','site','unknown')),
  name               TEXT NOT NULL,
  parent_locality_id TEXT REFERENCES locality(locality_id),
  lat                REAL,
  lon                REAL,
  notes              TEXT
) STRICT;

CREATE TABLE evidence (
  source_id   TEXT NOT NULL PRIMARY KEY,
  source_type TEXT NOT NULL CHECK (source_type IN (
    'literature','herbarium_voucher','field_observation','interview',
    'guide_book','online_db','expert_review')),
  citation    TEXT NOT NULL,
  author      TEXT,
  year        INTEGER,
  title       TEXT,
  voucher_id  TEXT,
  locality_id TEXT REFERENCES locality(locality_id),
  collector   TEXT,
  date        TEXT,
  url         TEXT,
  notes       TEXT
) STRICT;

CREATE TABLE concept (
  concept_id        TEXT NOT NULL PRIMARY KEY,
  rank              TEXT NOT NULL CHECK (rank IN (
    'family','genus','species','subspecies','variety','form')),
  parent_concept_id TEXT REFERENCES concept(concept_id),
  sec_source        TEXT NOT NULL,
  sec_version       TEXT NOT NULL,
  wcvp_id           TEXT,
  accepted_name     TEXT NOT NULL,
  notes             TEXT
) STRICT;

CREATE TABLE ethno_category (
  ethno_id    TEXT NOT NULL PRIMARY KEY,
  label       TEXT NOT NULL,
  language    TEXT NOT NULL,
  description TEXT NOT NULL,
  notes       TEXT
) STRICT;

CREATE TABLE name_usage (
  usage_id      TEXT NOT NULL PRIMARY KEY,
  concept_id    TEXT NOT NULL REFERENCES concept(concept_id),
  name_string   TEXT NOT NULL,
  authorship    TEXT,
  rank          TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN (
    'accepted','homotypic_synonym','heterotypic_synonym',
    'basionym','misapplied','orthographic_variant','unresolved')),
  source_id     TEXT NOT NULL REFERENCES evidence(source_id),
  date_recorded TEXT,
  notes         TEXT
) STRICT;

CREATE TABLE vernacular_usage (
  usage_id        TEXT NOT NULL PRIMARY KEY,
  name_string     TEXT NOT NULL,
  applies_to_type TEXT NOT NULL CHECK (applies_to_type IN (
    'concept','ethno_category','unresolved')),
  applies_to_id   TEXT NOT NULL,
  language        TEXT NOT NULL,
  locality_id     TEXT NOT NULL REFERENCES locality(locality_id),
  source_id       TEXT NOT NULL REFERENCES evidence(source_id),
  scope           TEXT NOT NULL CHECK (scope IN ('species','genus','family','group')),
  confidence      REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  date_recorded   TEXT,
  notes           TEXT
) STRICT;

CREATE TABLE trait_assertion (
  assertion_id TEXT NOT NULL PRIMARY KEY,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('concept','ethno')),
  subject_id   TEXT NOT NULL,
  character    TEXT NOT NULL,
  state        TEXT NOT NULL,
  source_id    TEXT NOT NULL REFERENCES evidence(source_id),
  scope        TEXT NOT NULL CHECK (scope IN ('default','override')),
  confidence   REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  notes        TEXT
) STRICT;
`;

// Columns that need numeric coercion at load time. Everything else is
// passed as a string (or null if empty) and STRICT mode rejects bad
// values at INSERT time.
const TYPED = {
  locality:         { lat: 'REAL', lon: 'REAL' },
  evidence:         { year: 'INTEGER' },
  vernacular_usage: { confidence: 'REAL' },
  trait_assertion:  { confidence: 'REAL' },
};

// Load order respects the foreign-key DAG: locality → evidence →
// concept / ethno_category → name_usage → vernacular_usage → trait_assertion.
const LOAD_ORDER = [
  'locality', 'evidence', 'concept', 'ethno_category',
  'name_usage', 'vernacular_usage', 'trait_assertion',
];

// ───── CSV → typed rows ────────────────────────────────────────────────

/** Read and parse one CSV; throws with line numbers on parse errors. */
function loadCsv(table) {
  const path = join(KB_DIR, `${table}.csv`);
  const text = readFileSync(path, 'utf8');
  const result = Papa.parse(text, { header: true, skipEmptyLines: true });
  if (result.errors.length) {
    throw new Error(
      `Parse errors in ${table}.csv:\n` +
      result.errors.map((e) => `  row ${e.row}: ${e.message}`).join('\n'),
    );
  }
  return result.data;
}

/** Empty → null; coerce typed columns to JS numbers. */
function coerce(row, typed = {}) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === '' || v === undefined || v === null) {
      out[k] = null;
    } else if (typed[k] === 'INTEGER') {
      const n = parseInt(v, 10);
      out[k] = Number.isFinite(n) ? n : null;
    } else if (typed[k] === 'REAL') {
      const n = parseFloat(v);
      out[k] = Number.isFinite(n) ? n : null;
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Bulk-insert via a single prepared statement inside one transaction. */
function bulkInsert(db, table, rows) {
  if (rows.length === 0) return;
  const cols = Object.keys(rows[0]);
  const stmt = db.prepare(
    `INSERT INTO ${table} (${cols.join(', ')}) ` +
    `VALUES (${cols.map((c) => `@${c}`).join(', ')})`,
  );
  const tx = db.transaction((rs) => { for (const r of rs) stmt.run(r); });
  tx(rows);
}

// ───── Invariant checks beyond FKs and CHECKs ──────────────────────────
// Each entry runs a SQL query that *should return zero rows*. Any rows
// returned are violations.

const CHECKS = [
  {
    name: 'Polymorphic FK: vernacular_usage.applies_to_id resolves',
    sql: `
      SELECT vu.usage_id, vu.applies_to_type, vu.applies_to_id
      FROM vernacular_usage vu
      WHERE (vu.applies_to_type = 'concept' AND NOT EXISTS (
              SELECT 1 FROM concept c WHERE c.concept_id = vu.applies_to_id))
         OR (vu.applies_to_type = 'ethno_category' AND NOT EXISTS (
              SELECT 1 FROM ethno_category e WHERE e.ethno_id = vu.applies_to_id))
    `,
  },
  {
    name: 'Polymorphic FK: trait_assertion.subject_id resolves',
    sql: `
      SELECT ta.assertion_id, ta.subject_type, ta.subject_id
      FROM trait_assertion ta
      WHERE (ta.subject_type = 'concept' AND NOT EXISTS (
              SELECT 1 FROM concept c WHERE c.concept_id = ta.subject_id))
         OR (ta.subject_type = 'ethno' AND NOT EXISTS (
              SELECT 1 FROM ethno_category e WHERE e.ethno_id = ta.subject_id))
    `,
  },
  {
    name: 'Exactly one accepted name_usage per concept',
    sql: `
      SELECT concept_id, COUNT(*) AS n
      FROM name_usage WHERE status = 'accepted'
      GROUP BY concept_id HAVING n != 1
    `,
  },
  {
    name: 'Every concept has an accepted name_usage',
    sql: `
      SELECT c.concept_id FROM concept c
      WHERE NOT EXISTS (
        SELECT 1 FROM name_usage nu
        WHERE nu.concept_id = c.concept_id AND nu.status = 'accepted'
      )
    `,
  },
  {
    name: 'concept.accepted_name matches the accepted name_usage row',
    sql: `
      SELECT c.concept_id, c.accepted_name, nu.name_string
      FROM concept c
      JOIN name_usage nu ON nu.concept_id = c.concept_id AND nu.status = 'accepted'
      WHERE nu.name_string != c.accepted_name
    `,
  },
  {
    name: 'Accepted name_usage.rank matches concept.rank',
    sql: `
      SELECT nu.usage_id, nu.rank AS nu_rank, c.rank AS c_rank
      FROM name_usage nu JOIN concept c ON c.concept_id = nu.concept_id
      WHERE nu.status = 'accepted' AND nu.rank != c.rank
    `,
  },
  {
    name: 'Rank hierarchy: species child of genus, genus child of family',
    sql: `
      SELECT c.concept_id, c.rank, p.rank AS parent_rank
      FROM concept c JOIN concept p ON p.concept_id = c.parent_concept_id
      WHERE (c.rank = 'species' AND p.rank != 'genus')
         OR (c.rank = 'genus'   AND p.rank != 'family')
    `,
  },
  {
    name: 'No cycles in concept.parent_concept_id',
    sql: `
      WITH RECURSIVE walk(start_id, current_id, depth) AS (
        SELECT concept_id, parent_concept_id, 1
        FROM concept WHERE parent_concept_id IS NOT NULL
        UNION ALL
        SELECT w.start_id, c.parent_concept_id, w.depth + 1
        FROM walk w JOIN concept c ON c.concept_id = w.current_id
        WHERE c.parent_concept_id IS NOT NULL AND w.depth < 50
      )
      SELECT DISTINCT start_id FROM walk WHERE start_id = current_id
    `,
  },
  {
    name: 'No cycles in locality.parent_locality_id',
    sql: `
      WITH RECURSIVE walk(start_id, current_id, depth) AS (
        SELECT locality_id, parent_locality_id, 1
        FROM locality WHERE parent_locality_id IS NOT NULL
        UNION ALL
        SELECT w.start_id, l.parent_locality_id, w.depth + 1
        FROM walk w JOIN locality l ON l.locality_id = w.current_id
        WHERE l.parent_locality_id IS NOT NULL AND w.depth < 50
      )
      SELECT DISTINCT start_id FROM walk WHERE start_id = current_id
    `,
  },
  {
    name: 'Unresolved name_usage rows point at an unresolved-placeholder concept',
    sql: `
      SELECT usage_id, concept_id FROM name_usage
      WHERE status = 'unresolved' AND concept_id NOT LIKE 'ur_%'
    `,
  },
];

// ───── Main ────────────────────────────────────────────────────────────

function main() {
  console.log(`KB validator — loading from ${KB_DIR}`);

  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  db.exec(DDL);

  let total = 0;
  for (const table of LOAD_ORDER) {
    let raw;
    try {
      raw = loadCsv(table);
    } catch (err) {
      console.error(`✗ ${err.message}`);
      process.exit(1);
    }
    const rows = raw.map((r) => coerce(r, TYPED[table] ?? {}));
    try {
      bulkInsert(db, table, rows);
    } catch (err) {
      // STRICT mode and CHECK constraints fire here.
      console.error(`✗ Insert failed for ${table}: ${err.message}`);
      process.exit(1);
    }
    console.log(`  loaded ${String(rows.length).padStart(5)} rows  ${table}`);
    total += rows.length;
  }

  // Built-in FK check first — catches the simple dangling-reference
  // cases the polymorphic checks below don't cover.
  db.pragma('foreign_keys = ON');
  const fkViolations = db.pragma('foreign_key_check');
  if (fkViolations.length > 0) {
    console.error(`\n✗ Foreign key violations (${fkViolations.length}):`);
    for (const v of fkViolations.slice(0, 20)) {
      console.error(`   ${JSON.stringify(v)}`);
    }
    if (fkViolations.length > 20) {
      console.error(`   … and ${fkViolations.length - 20} more`);
    }
    process.exit(1);
  }

  console.log(`\nRunning ${CHECKS.length} invariant checks…`);
  let failures = 0;
  for (const check of CHECKS) {
    const rows = db.prepare(check.sql).all();
    if (rows.length > 0) {
      failures++;
      console.error(`✗ ${check.name} — ${rows.length} violation(s)`);
      for (const row of rows.slice(0, 5)) {
        console.error(`   ${JSON.stringify(row)}`);
      }
      if (rows.length > 5) {
        console.error(`   … and ${rows.length - 5} more`);
      }
    } else {
      console.log(`✓ ${check.name}`);
    }
  }

  console.log(`\n${total} rows loaded across ${LOAD_ORDER.length} tables.`);
  if (failures > 0) {
    console.error(`${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log(`All checks passed.`);
}

main();
