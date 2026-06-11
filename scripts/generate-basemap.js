#!/usr/bin/env node
// Regenerate the offline SVG-map data modules from source GeoJSON:
//   src/lib/data/madagascar.js         — coastline outline ({ rings })
//   src/lib/data/madagascar-biomes.js  — broad vegetation zones ([{ id,label,colour,rings }])
//
// This is a one-off DEV tool (like generate-thumbnails.js) — NOT part of the
// SvelteKit build. The herbarium has no internet, so the generated modules are
// committed and bundled; nothing is fetched at runtime. Re-run only when you want
// to re-derive the basemap from fresh sources.
//
// Usage:
//   1. Download the two sources into scripts/geo-src/ (gitignored):
//        ne_10m_admin_0_countries.geojson
//          https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson
//          (Natural Earth, public domain)
//        Ecoregions2017.zip
//          https://storage.googleapis.com/teow2016/Ecoregions2017.zip
//          (RESOLVE Ecoregions 2017 / WWF TEOW, CC-BY 4.0 — cite Dinerstein et al. 2017)
//   2. npm run prep-basemap
//
// Coordinates are simplified (mapshaper) and quantized to 3 dp (~110 m) — ample for
// a country-scale reference map, and keeps the bundled+gzipped payload tiny.

import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import mapshaper from 'mapshaper';

const SCRIPT_DIR = import.meta.dirname;
const SRC_DIR = join(SCRIPT_DIR, 'geo-src');
const OUT_DIR = join(SCRIPT_DIR, '..', 'src', 'lib', 'data');

// Simplification strength (mapshaper Visvalingam %, "retain this share of detail").
const COAST_SIMPLIFY = '20%';
const BIOME_SIMPLIFY = '2%';
const PRECISION = 3; // decimal places to quantize coordinates to

// Per-ecoregion presentation. Keyed by RESOLVE/WWF ECO_NAME. `order` drives both the
// draw order (first = drawn first, under later ones) and the legend order. Colours are
// muted, natural vegetation tones — rendered at low opacity so species points stay legible.
const BIOME_META = {
	'Madagascar humid forests':          { id: 'humid',     label: 'Humid forest (east)',          colour: '#2f7d4f', order: 1 },
	'Madagascar subhumid forests':       { id: 'subhumid',  label: 'Subhumid forest (highlands)',  colour: '#7ba05b', order: 2 },
	'Madagascar dry deciduous forests':  { id: 'dry',        label: 'Dry deciduous forest (west)',  colour: '#cdb45e', order: 3 },
	'Madagascar succulent woodlands':    { id: 'succulent',  label: 'Succulent woodland (sw)',      colour: '#c8794a', order: 4 },
	'Madagascar spiny thickets':         { id: 'spiny',      label: 'Spiny thicket (south)',        colour: '#dca36b', order: 5 },
	'Madagascar ericoid thickets':       { id: 'ericoid',    label: 'Ericoid thicket (montane)',    colour: '#9b8bbf', order: 6 },
	'Madagascar mangroves':              { id: 'mangrove',   label: 'Mangroves',                    colour: '#3f9e8f', order: 7 }
};

const round = (n) => Math.round(n * 10 ** PRECISION) / 10 ** PRECISION;
const quantizeRing = (ring) => ring.map(([x, y]) => [round(x), round(y)]);

/** Flatten a GeoJSON (Multi)Polygon geometry into a flat array of rings. */
function geometryToRings(geo) {
	if (!geo) return [];
	const polys = geo.type === 'MultiPolygon' ? geo.coordinates : [geo.coordinates];
	const rings = [];
	for (const poly of polys) for (const ring of poly) rings.push(quantizeRing(ring));
	return rings;
}

const countVerts = (rings) => rings.reduce((n, r) => n + r.length, 0);

/** Run a mapshaper pipeline and return the parsed GeoJSON FeatureCollection. */
async function runToGeojson(commands, outName, tmp) {
	const outPath = join(tmp, outName);
	await mapshaper.runCommands(`${commands} -o format=geojson "${outPath}"`);
	return JSON.parse(await readFile(outPath, 'utf8'));
}

async function main() {
	const tmp = await mkdtemp(join(tmpdir(), 'basemap-'));
	try {
		// --- Coastline ---------------------------------------------------------
		const coastSrc = join(SRC_DIR, 'ne_10m_admin_0_countries.geojson');
		const coast = await runToGeojson(
			`-i "${coastSrc}" -filter 'ADMIN === "Madagascar"' -simplify ${COAST_SIMPLIFY} keep-shapes`,
			'coast.geojson',
			tmp
		);
		const rings = coast.features.flatMap((f) => geometryToRings(f.geometry));

		// --- Biomes ------------------------------------------------------------
		const biomeSrc = join(SRC_DIR, 'Ecoregions2017.zip');
		const eco = await runToGeojson(
			`-i "${biomeSrc}" -filter 'ECO_NAME.indexOf("Madagascar") > -1' -simplify ${BIOME_SIMPLIFY} keep-shapes -clean`,
			'biomes.geojson',
			tmp
		);
		const biomes = eco.features
			.map((f) => {
				const meta = BIOME_META[f.properties.ECO_NAME];
				if (!meta) {
					console.warn(`  (skipping unmapped ecoregion: ${f.properties.ECO_NAME})`);
					return null;
				}
				return { ...meta, rings: geometryToRings(f.geometry) };
			})
			.filter(Boolean)
			.sort((a, b) => a.order - b.order)
			.map(({ order, ...rest }) => rest); // drop the sort key from the shipped data

		// Render both modules before writing either, so a render error can't leave
		// the bundled pair half-updated.
		const outlineJs = renderOutline(rings);
		const biomesJs = renderBiomes(biomes);
		await writeFile(join(OUT_DIR, 'madagascar.js'), outlineJs);
		await writeFile(join(OUT_DIR, 'madagascar-biomes.js'), biomesJs);

		console.log(`madagascar.js: ${rings.length} rings, ${countVerts(rings)} verts`);
		const totalVerts = biomes.reduce((n, b) => n + countVerts(b.rings), 0);
		console.log(`madagascar-biomes.js: ${biomes.length} classes, ${totalVerts} verts`);
	} finally {
		await rm(tmp, { recursive: true, force: true });
	}
}

// ---- Module rendering (one ring per line for legibility) --------------------

function ringsLiteral(rings, indent) {
	return rings.map((r) => `${indent}${JSON.stringify(r)}`).join(',\n');
}

function renderOutline(rings) {
	return `// Madagascar coastline outline for the offline SVG basemap (curation step D).
// GENERATED by scripts/generate-basemap.js — do not hand-edit; re-run \`npm run prep-basemap\`.
// Source: Natural Earth 10m admin-0 (public domain), filtered to Madagascar, simplified
// (mapshaper ${COAST_SIMPLIFY}) and quantized to ${PRECISION} dp. Main island + main satellite
// islands as separate rings. Coordinates are [longitude, latitude]. Bundled, never fetched.

/** @type {{ rings: number[][][] }} */
export const MADAGASCAR_OUTLINE = {
\trings: [
${ringsLiteral(rings, '\t\t')}
\t]
};
`;
}

function renderBiomes(biomes) {
	const entries = biomes
		.map(
			(b) => `\t{
\t\tid: ${JSON.stringify(b.id)},
\t\tlabel: ${JSON.stringify(b.label)},
\t\tcolour: ${JSON.stringify(b.colour)},
\t\trings: [
${ringsLiteral(b.rings, '\t\t\t')}
\t\t]
\t}`
		)
		.join(',\n');
	return `// Broad vegetation zones (biomes) of Madagascar for the offline map's habitat layer.
// GENERATED by scripts/generate-basemap.js — do not hand-edit; re-run \`npm run prep-basemap\`.
// Source: RESOLVE Ecoregions 2017 / WWF TEOW (CC-BY 4.0, Dinerstein et al. 2017), the seven
// "Madagascar …" ecoregions, simplified (mapshaper ${BIOME_SIMPLIFY}) and quantized to ${PRECISION} dp.
// \`colour\` is map data-encoding (the documented exception to the emerald-only rule); rendered
// at low opacity under the specimen points and clipped to the coastline. Coordinates are
// [longitude, latitude]. Bundled, never fetched.

/** @type {{ id: string, label: string, colour: string, rings: number[][][] }[]} */
export const MADAGASCAR_BIOMES = [
${entries}
];
`;
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
