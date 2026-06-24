#!/usr/bin/env node
// Regenerate the offline SVG-map data modules from source GeoJSON:
//   src/lib/data/madagascar.js         — coastline outline ({ rings })
//   src/lib/data/madagascar-biomes.js  — broad vegetation zones ([{ id,label,colour,rings }])
//   src/lib/data/wio.js                — WIO + Africa coastline ({ rings }): sub-Saharan &
//                                        Southern Africa + Mascarenes + Comoros + Seychelles +
//                                        Madagascar. No biomes.
//   src/lib/data/wio-borders.js        — African mainland country borders within the WIO frame
//                                        ({ lines }), drawn as thin dashed political boundaries.
//   src/lib/data/world.js              — coarse whole-world coastline ({ rings }) for
//                                        far-flung (Africa/Asia/Americas) outgroups. No biomes.
//
// This is a one-off DEV tool (like generate-thumbnails.js) — NOT part of the
// SvelteKit build. The herbarium has no internet, so the generated modules are
// committed and bundled; nothing is fetched at runtime. Re-run only when you want
// to re-derive the basemap from fresh sources.
//
// Usage:
//   1. Download the sources into scripts/geo-src/ (gitignored):
//        ne_10m_admin_0_countries.geojson   (coastline detail — Madagascar + WIO)
//          https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson
//          (Natural Earth, public domain)
//        ne_50m_admin_0_countries.geojson   (coarse source for the world coastline)
//          https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson
//          (Natural Earth, public domain)
//        Ecoregions2017.zip
//          https://storage.googleapis.com/teow2016/Ecoregions2017.zip
//          (RESOLVE Ecoregions 2017 / WWF TEOW, CC-BY 4.0 — cite Dinerstein et al. 2017)
//   2. npm run prep-basemap
//
// Coordinates are simplified (mapshaper) and quantized: 3 dp (~110 m) for the
// region maps, 2 dp (~1.1 km) for the world locator — keeping the bundled+gzipped
// payload tiny. The WIO/world coastlines dissolve country borders (-dissolve2) so
// only shorelines remain; their inland edges sit on the map frame. The WIO map then
// re-adds mainland political borders as a separate line layer (-innerlines → wio-borders.js).

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
// WIO coastline keeps fine detail (12% / 3 dp) so the small islands — the 3 Comoros, Mayotte,
// Seychelles — survive `keep-shapes` over the much larger Africa frame. The political-border
// layer doesn't need island fidelity, so it's coarser (8% / 2 dp) to keep the bundle small.
const WIO_SIMPLIFY = '12%';
const WIO_BORDER_SIMPLIFY = '8%';
const WORLD_SIMPLIFY = '6%';
const PRECISION = 3; // decimal places for the Madagascar map
const WIO_PRECISION = 3; // WIO coastline — fine enough to keep the small islands
const WIO_BORDER_PRECISION = 2; // WIO borders — coarser (~1.1 km), they don't need island detail
const WORLD_PRECISION = 2; // coarser for the world locator

// Clip rectangles "minLng,minLat,maxLng,maxLat" for the wider coastlines.
//   WIO: sub-Saharan & Southern Africa (Sahara/Mediterranean trimmed at 18°N) + Mascarenes
//        (Rodrigues ~63.4°E) + Comoros + Seychelles. West to ~Senegal (-17.5°E), south past
//        Cape Agulhas (-34.8°S). Wide enough that continental-African outgroups plot here.
//        Mirrors WIO_BBOX in geo.js. Coarser simplify/precision than Madagascar to stay tiny.
//   WORLD: whole globe with Antarctica's bulk and the high Arctic trimmed.
const WIO_CLIP = '-19,-36,65,18';
const WORLD_CLIP = '-180,-58,180,75';

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

const round = (n, p) => Math.round(n * 10 ** p) / 10 ** p;
const quantizeRing = (ring, p = PRECISION) => ring.map(([x, y]) => [round(x, p), round(y, p)]);

/** Flatten a GeoJSON (Multi)Polygon geometry into a flat array of rings. */
function geometryToRings(geo, p = PRECISION) {
	if (!geo) return [];
	const polys = geo.type === 'MultiPolygon' ? geo.coordinates : [geo.coordinates];
	const rings = [];
	for (const poly of polys) for (const ring of poly) rings.push(quantizeRing(ring, p));
	return rings;
}

/**
 * Flatten any parsed GeoJSON to rings. `-filter` keeps attributes (→ FeatureCollection)
 * but `-dissolve2` drops them (→ GeometryCollection), so handle both shapes.
 */
function ringsFromGeojson(j, p = PRECISION) {
	if (!j) return [];
	if (j.type === 'GeometryCollection') return j.geometries.flatMap((g) => geometryToRings(g, p));
	if (j.type === 'FeatureCollection') return j.features.flatMap((f) => geometryToRings(f.geometry, p));
	if (j.type === 'Feature') return geometryToRings(j.geometry, p);
	return geometryToRings(j, p); // bare geometry
}

/** Flatten a GeoJSON (Multi)LineString geometry into a flat array of open polylines. */
function geometryToLines(geo, p = PRECISION) {
	if (!geo) return [];
	const lines = geo.type === 'MultiLineString' ? geo.coordinates : [geo.coordinates];
	return lines.map((line) => quantizeRing(line, p)); // quantizeRing just rounds each [x,y]
}

/** Flatten any parsed GeoJSON of line features (e.g. mapshaper `-innerlines`) to polylines. */
function linesFromGeojson(j, p = PRECISION) {
	if (!j) return [];
	if (j.type === 'GeometryCollection') return j.geometries.flatMap((g) => geometryToLines(g, p));
	if (j.type === 'FeatureCollection') return j.features.flatMap((f) => geometryToLines(f.geometry, p));
	if (j.type === 'Feature') return geometryToLines(j.geometry, p);
	return geometryToLines(j, p); // bare geometry
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
		const coastSrc = join(SRC_DIR, 'ne_10m_admin_0_countries.geojson');
		const worldSrc = join(SRC_DIR, 'ne_50m_admin_0_countries.geojson');

		// --- Madagascar coastline ----------------------------------------------
		const coast = await runToGeojson(
			`-i "${coastSrc}" -filter 'ADMIN === "Madagascar"' -simplify ${COAST_SIMPLIFY} keep-shapes`,
			'coast.geojson',
			tmp
		);
		const rings = ringsFromGeojson(coast);

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

		// --- WIO coastline (sub-Saharan + Southern Africa + W. Indian Ocean islands) ---
		// Clip the 10m countries to the WIO/Africa rectangle, then dissolve country borders so
		// only shorelines remain (inland clip edges sit on the map frame). Simplify BEFORE
		// dissolving: `keep-shapes` protects each small island feature during simplification,
		// but once `-dissolve2` merges every country into one feature it can't, so the tiny
		// islands (Seychelles, Aldabra) get cleaned away. Simplify-then-dissolve keeps them.
		const wio = await runToGeojson(
			`-i "${coastSrc}" -clip bbox=${WIO_CLIP} -simplify ${WIO_SIMPLIFY} keep-shapes -clean -dissolve2`,
			'wio.geojson',
			tmp
		);
		const wioRings = ringsFromGeojson(wio, WIO_PRECISION);

		// --- WIO country borders (political boundaries within the WIO/Africa frame) ----
		// `-innerlines` extracts only the boundaries shared between adjacent countries, as
		// open polylines — so we get the African mainland borders with no coastline
		// duplication and no island clutter (islands border nobody). Drawn as thin dashed
		// lines on the WIO map; absent on the Madagascar/world extents.
		const wioBorders = await runToGeojson(
			`-i "${coastSrc}" -clip bbox=${WIO_CLIP} -simplify ${WIO_BORDER_SIMPLIFY} keep-shapes -clean -innerlines`,
			'wio-borders.geojson',
			tmp
		);
		const wioBorderLines = linesFromGeojson(wioBorders, WIO_BORDER_PRECISION);

		// --- World coastline (coarse locator for far-flung outgroups) -----------
		const world = await runToGeojson(
			`-i "${worldSrc}" -clip bbox=${WORLD_CLIP} -dissolve2 -simplify ${WORLD_SIMPLIFY} keep-shapes -clean`,
			'world.geojson',
			tmp
		);
		const worldRings = ringsFromGeojson(world, WORLD_PRECISION);

		// Render every module before writing any, so a render error can't leave the
		// bundled set half-updated.
		const outlineJs = renderOutline('MADAGASCAR_OUTLINE', rings, MADAGASCAR_HEADER);
		const biomesJs = renderBiomes(biomes);
		const wioJs = renderOutline('WIO_OUTLINE', wioRings, WIO_HEADER);
		const wioBordersJs = renderLines('WIO_BORDERS', wioBorderLines, WIO_BORDERS_HEADER);
		const worldJs = renderOutline('WORLD_OUTLINE', worldRings, WORLD_HEADER);
		await writeFile(join(OUT_DIR, 'madagascar.js'), outlineJs);
		await writeFile(join(OUT_DIR, 'madagascar-biomes.js'), biomesJs);
		await writeFile(join(OUT_DIR, 'wio.js'), wioJs);
		await writeFile(join(OUT_DIR, 'wio-borders.js'), wioBordersJs);
		await writeFile(join(OUT_DIR, 'world.js'), worldJs);

		console.log(`madagascar.js: ${rings.length} rings, ${countVerts(rings)} verts`);
		const totalVerts = biomes.reduce((n, b) => n + countVerts(b.rings), 0);
		console.log(`madagascar-biomes.js: ${biomes.length} classes, ${totalVerts} verts`);
		console.log(`wio.js: ${wioRings.length} rings, ${countVerts(wioRings)} verts`);
		console.log(`wio-borders.js: ${wioBorderLines.length} lines, ${countVerts(wioBorderLines)} verts`);
		console.log(`world.js: ${worldRings.length} rings, ${countVerts(worldRings)} verts`);
	} finally {
		await rm(tmp, { recursive: true, force: true });
	}
}

// ---- Module rendering (one ring per line for legibility) --------------------

function ringsLiteral(rings, indent) {
	return rings.map((r) => `${indent}${JSON.stringify(r)}`).join(',\n');
}

const MADAGASCAR_HEADER = `// Madagascar coastline outline for the offline SVG basemap (curation step D).
// GENERATED by scripts/generate-basemap.js — do not hand-edit; re-run \`npm run prep-basemap\`.
// Source: Natural Earth 10m admin-0 (public domain), filtered to Madagascar, simplified
// (mapshaper ${COAST_SIMPLIFY}) and quantized to ${PRECISION} dp. Main island + main satellite
// islands as separate rings. Coordinates are [longitude, latitude]. Bundled, never fetched.`;

const WIO_HEADER = `// WIO + Africa coastline for the offline SVG basemap — sub-Saharan & Southern Africa
// (Sahara/Mediterranean trimmed) + Mascarenes + Comoros + Seychelles + Madagascar. Used when
// a dataset has specimens beyond Madagascar (auto-detected). No biome layer at this extent.
// GENERATED by scripts/generate-basemap.js — do not hand-edit; re-run \`npm run prep-basemap\`.
// Source: Natural Earth 10m admin-0 (public domain), clipped to the WIO bbox, country
// borders dissolved, simplified (mapshaper ${WIO_SIMPLIFY}) and quantized to ${WIO_PRECISION} dp.
// Coordinates are [longitude, latitude]. Bundled, never fetched.`;

const WIO_BORDERS_HEADER = `// African mainland country borders within the WIO map frame (Mozambique, Tanzania, Kenya, …).
// GENERATED by scripts/generate-basemap.js — do not hand-edit; re-run \`npm run prep-basemap\`.
// Source: Natural Earth 10m admin-0 (public domain), clipped to the WIO bbox, simplified
// (mapshaper ${WIO_BORDER_SIMPLIFY}) and reduced to the shared inter-country boundaries (-innerlines),
// quantized to ${WIO_BORDER_PRECISION} dp. OPEN polylines (not closed rings) — coastlines live in wio.js.
// Drawn as thin dashed lines on the WIO extent only. Coordinates are [longitude, latitude].`;

const WORLD_HEADER = `// Coarse whole-world coastline for the offline SVG basemap — a locator for far-flung
// (Africa/Asia/Americas) outgroup specimens. Used when a dataset has specimens beyond the
// WIO extent (auto-detected). No biome layer at this extent.
// GENERATED by scripts/generate-basemap.js — do not hand-edit; re-run \`npm run prep-basemap\`.
// Source: Natural Earth 50m admin-0 (public domain), clipped to drop most of Antarctica
// and the high Arctic, country borders dissolved, simplified (mapshaper ${WORLD_SIMPLIFY}) and
// quantized to ${WORLD_PRECISION} dp. Coordinates are [longitude, latitude]. Bundled, never fetched.`;

function renderOutline(exportName, rings, header) {
	return `${header}

/** @type {{ rings: number[][][] }} */
export const ${exportName} = {
\trings: [
${ringsLiteral(rings, '\t\t')}
\t]
};
`;
}

function renderLines(exportName, lines, header) {
	return `${header}

/** @type {{ lines: number[][][] }} */
export const ${exportName} = {
\tlines: [
${ringsLiteral(lines, '\t\t')}
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
