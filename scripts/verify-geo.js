// Verifies the pure geo helpers used by the map (curation step D):
// ray-casting point-in-polygon and the project/unproject round-trip.
// Run: node scripts/verify-geo.js   (wired as `npm run check:geo`)

import {
	pointInRing,
	projectLngLat,
	unprojectXY,
	inBbox,
	MADAGASCAR_BBOX,
	WIO_BBOX,
	WORLD_BBOX
} from '../src/lib/utils/geo.js';
import { MADAGASCAR_OUTLINE } from '../src/lib/data/madagascar.js';
import { MADAGASCAR_BIOMES } from '../src/lib/data/madagascar-biomes.js';
import { WIO_OUTLINE } from '../src/lib/data/wio.js';
import { WIO_BORDERS } from '../src/lib/data/wio-borders.js';
import { WORLD_OUTLINE } from '../src/lib/data/world.js';

let failures = 0;
function check(label, cond) {
	if (cond) {
		console.log(`  ✓ ${label}`);
	} else {
		console.log(`  ✗ ${label}`);
		failures++;
	}
}

console.log('\n1. pointInRing — convex square (lng 0..10, lat 0..10)');
const square = [
	[0, 0],
	[10, 0],
	[10, 10],
	[0, 10]
];
check('centre is inside', pointInRing(5, 5, square) === true);
check('far outside is outside', pointInRing(20, 20, square) === false);
check('just outside an edge is outside', pointInRing(-0.001, 5, square) === false);
check('degenerate ring (<3 pts) is never inside', pointInRing(5, 5, [[0, 0], [1, 1]]) === false);

console.log('\n2. pointInRing — concave "C" shape (notch on the right)');
// A blocky C: the notch around (8,5) must read as OUTSIDE.
const cShape = [
	[0, 0],
	[10, 0],
	[10, 3],
	[4, 3],
	[4, 7],
	[10, 7],
	[10, 10],
	[0, 10]
];
check('point in the left bar is inside', pointInRing(2, 5, cShape) === true);
check('point in the notch is outside', pointInRing(8, 5, cShape) === false);
check('point in the top arm is inside', pointInRing(7, 1.5, cShape) === true);

console.log('\n3. projectLngLat ↔ unprojectXY round-trip (Madagascar bbox)');
const samples = [
	[47.193, -18.119], // Antananarivo-ish
	[49.757, -14.434],
	[43.5, -25.0],
	[50.4, -12.1]
];
let maxErr = 0;
for (const [lng, lat] of samples) {
	const { x, y } = projectLngLat(lng, lat);
	const back = unprojectXY(x, y);
	maxErr = Math.max(maxErr, Math.abs(back.lng - lng), Math.abs(back.lat - lat));
}
check(`round-trip error < 1e-9 (max ${maxErr.toExponential(2)})`, maxErr < 1e-9);

console.log('\n4. projection orientation & bbox guard');
const top = projectLngLat(MADAGASCAR_BBOX.lngMin, MADAGASCAR_BBOX.latMax);
const bottom = projectLngLat(MADAGASCAR_BBOX.lngMin, MADAGASCAR_BBOX.latMin);
check('north maps above south (y increases downward)', top.y < bottom.y);
check('a Madagascar coordinate is in-bbox', inBbox(47.5, -18.9) === true);
check('a sign-flipped latitude (+24.67) is off-map', inBbox(46.8, 24.666667) === false);

console.log('\n5. bundled basemap data — coastline + biome rings');
// A ring is well-formed if it has ≥3 vertices, is closed (first === last), and every
// vertex sits inside the Madagascar bbox (the same guard the map uses to drop bad data).
function ringWellFormed(ring, bbox) {
	if (!Array.isArray(ring) || ring.length < 4) return false; // ≥3 distinct + closing point
	const [fx, fy] = ring[0];
	const [lx, ly] = ring[ring.length - 1];
	if (fx !== lx || fy !== ly) return false;
	return ring.every(([lng, lat]) => inBbox(lng, lat, bbox));
}
const coastOk = MADAGASCAR_OUTLINE.rings.every((r) => ringWellFormed(r, MADAGASCAR_BBOX));
check(`coastline has rings, all closed & in-bbox (${MADAGASCAR_OUTLINE.rings.length} rings)`, MADAGASCAR_OUTLINE.rings.length > 0 && coastOk);

check('biome layer is a non-empty array', Array.isArray(MADAGASCAR_BIOMES) && MADAGASCAR_BIOMES.length > 0);
const ids = new Set();
let biomeFields = true;
let biomeRingsOk = true;
for (const b of MADAGASCAR_BIOMES) {
	if (!b.id || !b.label || !/^#[0-9a-fA-F]{6}$/.test(b.colour ?? '')) biomeFields = false;
	ids.add(b.id);
	if (!Array.isArray(b.rings) || b.rings.length === 0 || !b.rings.every((r) => ringWellFormed(r, MADAGASCAR_BBOX))) biomeRingsOk = false;
}
check('every biome has id, label, and a #rrggbb colour', biomeFields);
check('biome ids are unique', ids.size === MADAGASCAR_BIOMES.length);
check('every biome ring is closed & in-bbox', biomeRingsOk);

console.log('\n6. wider basemaps — WIO + world coastlines');
const wioOk = WIO_OUTLINE.rings.every((r) => ringWellFormed(r, WIO_BBOX));
check(
	`WIO coastline has rings, all closed & in-bbox (${WIO_OUTLINE.rings.length} rings)`,
	WIO_OUTLINE.rings.length > 0 && wioOk
);
// WIO country borders are OPEN polylines (not closed rings): need ≥2 points, all in-bbox.
const lineWellFormed = (line) =>
	Array.isArray(line) && line.length >= 2 && line.every(([lng, lat]) => inBbox(lng, lat, WIO_BBOX));
const wioBordersOk = WIO_BORDERS.lines.every(lineWellFormed);
check(
	`WIO borders are non-empty polylines, all in-bbox (${WIO_BORDERS.lines.length} lines)`,
	WIO_BORDERS.lines.length > 0 && wioBordersOk
);
const worldOk = WORLD_OUTLINE.rings.every((r) => ringWellFormed(r, WORLD_BBOX));
check(
	`world coastline has rings, all closed & in-bbox (${WORLD_OUTLINE.rings.length} rings)`,
	WORLD_OUTLINE.rings.length > 0 && worldOk
);

// The world extent uses the plain-equirectangular (cos 0) branch in lngScale; lock the
// project/unproject round-trip there too.
let worldErr = 0;
for (const [lng, lat] of [
	[-58.4, -34.6], // Buenos Aires
	[101.7, 3.1], // Kuala Lumpur
	[37.6, 0.5], // East Africa
	[-122.3, 47.6] // Seattle
]) {
	const { x, y } = projectLngLat(lng, lat, WORLD_BBOX);
	const back = unprojectXY(x, y, WORLD_BBOX);
	worldErr = Math.max(worldErr, Math.abs(back.lng - lng), Math.abs(back.lat - lat));
}
check(`world round-trip error < 1e-9 (max ${worldErr.toExponential(2)})`, worldErr < 1e-9);

console.log('');
if (failures === 0) {
	console.log('✅ all geo checks passed\n');
	process.exit(0);
} else {
	console.log(`❌ ${failures} geo check(s) failed\n`);
	process.exit(1);
}
