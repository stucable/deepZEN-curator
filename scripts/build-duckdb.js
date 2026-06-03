#!/usr/bin/env node
/**
 * scripts/build-duckdb.js
 *
 * Builds a fresh DuckDB snapshot of the validated KB CSVs for ad-hoc
 * curator querying via DuckDB UI, Beekeeper Studio, DBeaver, or
 * Harlequin. Run *after* validate-kb.js passes — this script does no
 * integrity checking of its own; it just stitches the seven CSVs
 * together and adds a handful of helper views.
 *
 * Usage:    node scripts/build-duckdb.js [kb-dir] [out-path]
 * Defaults: kb-dir   = ../kb-draft
 *           out-path = ../kb-draft/kb.duckdb
 * Requires: npm i -D duckdb
 */

import { existsSync, unlinkSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import duckdb from 'duckdb';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KB_DIR   = resolve(process.argv[2] ?? join(__dirname, '..', 'kb-draft'));
const OUT_PATH = resolve(process.argv[3] ?? join(KB_DIR, 'kb.duckdb'));

// Always start from a clean file so the script is idempotent.
if (existsSync(OUT_PATH)) unlinkSync(OUT_PATH);

const db  = new duckdb.Database(OUT_PATH);
const con = db.connect();

// Promisify the callback-based run() so main() reads linearly.
const run = (sql) => new Promise((res, rej) =>
  con.run(sql, (err) => (err ? rej(err) : res())),
);

const TABLES = [
  'locality', 'evidence', 'concept', 'ethno_category',
  'name_usage', 'vernacular_usage', 'trait_assertion',
];

// DuckDB accepts forward slashes inside SQL string literals on every
// platform, so normalise the Windows backslashes once here.
const csvPath = (t) => join(KB_DIR, `${t}.csv`).replace(/\\/g, '/');

async function main() {
  // 1 ── Load each CSV directly. DuckDB infers column types from the
  //      first ~16 KiB by default; we re-trust that here only because
  //      validate-kb.js has already enforced types against the stricter
  //      SQLite schema.
  for (const t of TABLES) {
    await run(
      `CREATE TABLE ${t} AS ` +
      `SELECT * FROM read_csv_auto('${csvPath(t)}', header=true);`,
    );
    console.log(`  loaded  ${t}`);
  }

  // 2 ── Indexes on the join keys we'll hit most often during curation.
  const indexes = [
    `CREATE INDEX idx_name_usage_concept   ON name_usage(concept_id)`,
    `CREATE INDEX idx_name_usage_name      ON name_usage(name_string)`,
    `CREATE INDEX idx_vernacular_name      ON vernacular_usage(name_string)`,
    `CREATE INDEX idx_vernacular_applies   ON vernacular_usage(applies_to_id)`,
    `CREATE INDEX idx_vernacular_locality  ON vernacular_usage(locality_id)`,
    `CREATE INDEX idx_concept_parent       ON concept(parent_concept_id)`,
    `CREATE INDEX idx_trait_subject        ON trait_assertion(subject_id)`,
    `CREATE INDEX idx_locality_parent      ON locality(parent_locality_id)`,
  ];
  for (const sql of indexes) await run(sql);

  // 3 ── Views that make the common curator queries one-liners.

  // Every vernacular usage with its target concept or ethno-category,
  // locality, and source citation pre-joined. Starting point for most
  // browsing queries:
  //   SELECT * FROM v_vernacular_resolved WHERE name_string ILIKE 'hazo%';
  await run(`
    CREATE VIEW v_vernacular_resolved AS
    SELECT
      vu.usage_id,
      vu.name_string,
      vu.language,
      vu.scope,
      vu.confidence,
      vu.applies_to_type,
      vu.applies_to_id,
      CASE vu.applies_to_type
        WHEN 'concept'        THEN c.accepted_name
        WHEN 'ethno_category' THEN e.label
        ELSE '(unresolved)'
      END AS resolved_label,
      l.name      AS locality_name,
      ev.citation AS source_citation,
      vu.notes
    FROM vernacular_usage vu
    LEFT JOIN concept        c  ON vu.applies_to_type = 'concept'
                                AND vu.applies_to_id = c.concept_id
    LEFT JOIN ethno_category e  ON vu.applies_to_type = 'ethno_category'
                                AND vu.applies_to_id = e.ethno_id
    LEFT JOIN locality       l  ON vu.locality_id = l.locality_id
    LEFT JOIN evidence       ev ON vu.source_id   = ev.source_id
  `);

  // Recursive ancestor walk: every (concept, ancestor) pair including
  // (concept, concept) at depth 0. Backbone for any trait-inheritance
  // query. Costs ~O(concepts × tree-depth) — trivial at our scale.
  await run(`
    CREATE VIEW v_concept_ancestors AS
    WITH RECURSIVE walk(concept_id, ancestor_id, depth) AS (
      SELECT concept_id, concept_id, 0 FROM concept
      UNION ALL
      SELECT w.concept_id, c.parent_concept_id, w.depth + 1
      FROM walk w
      JOIN concept c ON c.concept_id = w.ancestor_id
      WHERE c.parent_concept_id IS NOT NULL
    )
    SELECT * FROM walk
  `);

  // Every trait assertion that applies to a concept, either directly or
  // by inheritance. Ordered "winners first": overrides before defaults,
  // closer ancestors before farther ones. A resolver picks the first
  // row per (concept_id, character).
  await run(`
    CREATE VIEW v_concept_traits AS
    SELECT
      a.concept_id,
      ta.character,
      ta.state,
      ta.scope,
      ta.confidence,
      ta.source_id,
      a.depth,
      ta.subject_id AS asserted_on
    FROM v_concept_ancestors a
    JOIN trait_assertion ta
      ON ta.subject_type = 'concept' AND ta.subject_id = a.ancestor_id
    ORDER BY a.concept_id,
             ta.character,
             CASE ta.scope WHEN 'override' THEN 0 ELSE 1 END,
             a.depth
  `);

  // The unresolved reconciliation queue. Pre-joined to locality and
  // evidence so the curator UI (or an ad-hoc query) doesn't have to.
  await run(`
    CREATE VIEW v_unresolved_vernaculars AS
    SELECT
      vu.usage_id, vu.name_string, vu.language, vu.scope, vu.confidence,
      l.name      AS locality_name,
      ev.citation AS source_citation,
      vu.date_recorded, vu.notes
    FROM vernacular_usage vu
    LEFT JOIN locality l  ON vu.locality_id = l.locality_id
    LEFT JOIN evidence ev ON vu.source_id   = ev.source_id
    WHERE vu.applies_to_type = 'unresolved'
  `);

  con.close();
  await new Promise((res) => db.close(res));

  console.log(`\nSnapshot built: ${OUT_PATH}`);
  console.log(`Open with one of:`);
  console.log(`  duckdb ${OUT_PATH} -c "CALL start_ui();"   # built-in web UI`);
  console.log(`  harlequin ${OUT_PATH}                       # terminal UI`);
  console.log(`  (or open the file in Beekeeper Studio / DBeaver)`);
}

main().catch((err) => { console.error(err); process.exit(1); });
