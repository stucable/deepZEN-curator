#!/usr/bin/env node

/**
 * Package a per-project edition from one application build.
 *
 *   npm run build
 *   npm run package -- --datasets=sarcolaenaceae
 *   npm run package -- --datasets=macaranga,sarcolaenaceae --default=sarcolaenaceae
 *
 * The app build is dataset-agnostic — the registry is the runtime manifest
 * `build/data/datasets.json` — so an edition is just the common build plus the CSVs it
 * ships and a manifest listing exactly those. That is why a Sarcolaenaceae curator can
 * be given an install with no Ankarafantsika in the selector without rebuilding.
 *
 * Output mirrors the hand-assembled dist/ layout: <out>/<name>/{build,README.txt,
 * start.bat.txt,start.sh,start.command} plus <out>/<name>.zip.
 *
 * Flags:
 *   --datasets=a,b   required; dataset ids from static/data/datasets.json
 *   --default=<id>   opening dataset (default: the first selected)
 *   --out=<dir>      output directory (default: dist)
 *   --name=<folder>  edition folder name (default: deepZEN-curator-<version>-<slug>)
 *   --no-zip         stage the folder only
 */

import { cp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadManifest, MANIFEST_PATH } from './manifest.js';
import { MANIFEST_VERSION } from '../src/lib/datasets.js';
import { VERSION } from '../src/lib/version.js';

const BUILD_DIR = 'build';
/** Launcher + docs shipped beside build/. `start.bat` is renamed to dodge email scanners. */
const EXTRA_FILES = [
	{ from: 'start.bat', to: 'start.bat.txt' },
	{ from: 'start.sh', to: 'start.sh' },
	{ from: 'start.command', to: 'start.command' },
	{ from: 'README.txt', to: 'README.txt' }
];

function parseArgs(argv) {
	const args = {};
	for (const arg of argv) {
		const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
		if (!match) die(`Unrecognised argument "${arg}"`);
		args[match[1]] = match[2] ?? true;
	}
	return args;
}

function die(message) {
	console.error(`package: ${message}`);
	process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
const outDir = typeof args.out === 'string' ? args.out : 'dist';

if (!args.datasets || args.datasets === true) {
	die('--datasets=<id>[,<id>] is required (ids come from ' + MANIFEST_PATH + ')');
}

const manifest = await loadManifest();
const requestedIds = String(args.datasets).split(',').map((id) => id.trim()).filter(Boolean);
if (requestedIds.length === 0) die('--datasets listed no ids');

const duplicates = requestedIds.filter((id, i) => requestedIds.indexOf(id) !== i);
if (duplicates.length) die(`--datasets repeats ${[...new Set(duplicates)].join(', ')}`);

const selected = requestedIds.map((id) => {
	const ds = manifest.datasets.find((d) => d.id === id);
	if (!ds) die(`unknown dataset "${id}". Available: ${manifest.datasets.map((d) => d.id).join(', ')}`);
	return ds;
});

const defaultDatasetId = typeof args.default === 'string' ? args.default : selected[0].id;
if (!selected.some((d) => d.id === defaultDatasetId)) {
	die(`--default="${defaultDatasetId}" is not among the selected datasets (${selected.map((d) => d.id).join(', ')})`);
}

if (!existsSync(join(BUILD_DIR, 'index.html'))) {
	die(`no ${BUILD_DIR}/index.html — run "npm run build" first`);
}

const slug = selected.length === manifest.datasets.length ? 'full' : selected.map((d) => d.id).join('-');
const name = typeof args.name === 'string' ? args.name : `deepZEN-curator-${VERSION}-${slug}`;
const editionDir = join(outDir, name);
const editionBuild = join(editionDir, BUILD_DIR);

// Stage: fresh directory, whole build, then prune the data folder to this edition.
await rm(editionDir, { recursive: true, force: true });
await mkdir(editionDir, { recursive: true });
await cp(BUILD_DIR, editionBuild, { recursive: true });

const dataDir = join(editionBuild, 'data');
const keep = new Set(selected.map((d) => d.csvPath.replace(/^\/data\//, '')));
let dropped = 0;
for (const entry of await readdir(dataDir)) {
	if (!entry.toLowerCase().endsWith('.csv') || keep.has(entry)) continue;
	await rm(join(dataDir, entry));
	dropped++;
}

// The edition manifest: the selected entries verbatim (kind, defaults, allowBarcodeLess
// all preserved) with a default that exists in this edition.
const editionManifest = {
	manifestVersion: MANIFEST_VERSION,
	defaultDatasetId,
	datasets: selected
};
await writeFile(join(dataDir, 'datasets.json'), `${JSON.stringify(editionManifest, null, '\t')}\n`, 'utf8');

for (const { from, to } of EXTRA_FILES) {
	if (!existsSync(from)) {
		console.warn(`package: warning — ${from} not found, skipping`);
		continue;
	}
	await cp(from, join(editionDir, to));
}

// Verify the staged edition rather than trusting the copy: every listed CSV present,
// nothing unlisted left behind.
for (const ds of selected) {
	const file = join(dataDir, ds.csvPath.replace(/^\/data\//, ''));
	if (!existsSync(file)) die(`staged edition is missing ${file} — is the CSV in static/data/ and the build current?`);
}
const strays = (await readdir(dataDir)).filter((e) => e.toLowerCase().endsWith('.csv') && !keep.has(e));
if (strays.length) die(`staged edition still contains unlisted CSV(s): ${strays.join(', ')}`);

let zipPath = null;
if (!args['no-zip']) {
	try {
		execFileSync('python3', [
			'-c',
			'import shutil,sys; shutil.make_archive(sys.argv[1], "zip", sys.argv[2], sys.argv[3])',
			editionDir,
			outDir,
			name
		], { stdio: 'inherit' });
		zipPath = `${editionDir}.zip`;
	} catch (err) {
		console.warn(`package: warning — could not create the zip (${err.message.split('\n')[0]}). The folder is staged; zip it manually.`);
	}
}

const { size } = await stat(zipPath ?? editionDir).catch(() => ({ size: 0 }));
console.log(`\nPackaged ${name}`);
console.log(`  datasets: ${selected.map((d) => `${d.label} (${d.kind})`).join(', ')}`);
console.log(`  opens on: ${defaultDatasetId}`);
console.log(`  folder:   ${editionDir}${dropped ? ` (dropped ${dropped} unlisted CSV${dropped === 1 ? '' : 's'})` : ''}`);
if (zipPath) console.log(`  zip:      ${zipPath} (${(size / 1024 / 1024).toFixed(2)} MB)`);
