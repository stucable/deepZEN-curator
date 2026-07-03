// Verifies the pure geo helpers used by the map (curation step D):
// ray-casting point-in-polygon and the project/unproject round-trip.
// Run: node scripts/verify-geo.js   (wired as `npm run check:geo`)

import {
	pointInRing,
	projectLngLat,
	unprojectXY,
	inBbox,
	resolveIslandAnchor,
	resolveMapCoords,
	isOffMadagascarAnchor,
	groupColocated,
	burstRing,
	MADAGASCAR_BBOX,
	WIO_BBOX,
	WORLD_BBOX
} from '../src/lib/utils/geo.js';
import { MADAGASCAR_OUTLINE } from '../src/lib/data/madagascar.js';
import { MADAGASCAR_BIOMES } from '../src/lib/data/madagascar-biomes.js';
import { WIO_OUTLINE } from '../src/lib/data/wio.js';
import { WIO_BORDERS } from '../src/lib/data/wio-borders.js';
import { WORLD_OUTLINE } from '../src/lib/data/world.js';
import { ISLAND_ANCHORS } from '../src/lib/data/island-anchors.js';

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
// Rodrigues (~63.4°E) must survive the `-explode` regeneration so island-anchored
// Rodrigues sheets have land beneath them — it sits east of Mauritius (57.5°E).
const hasRodrigues = WIO_OUTLINE.rings.some((r) => r.some(([lng]) => lng > 63 && lng < 63.8));
check('WIO coastline includes a Rodrigues ring (~63.4°E)', hasRodrigues);

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

console.log('\n7. island anchors — gazetteer + resolveIslandAnchor + resolveMapCoords');
// Every anchor sits inside the WIO extent (so it plots on the WIO map and auto-selects it).
// Anchoring is NAME-gated, never bbox-gated, so a Malagasy specimen is never centroided —
// see the Country=Madagascar → null checks below. Mayotte's true centroid (~45.2°E, -12.8°)
// lies NW of Madagascar at a shared latitude, so it overlaps the rectangular MADAGASCAR_BBOX;
// that's geographic fact, handled by hiding anchored sheets on the Madagascar extent (see the
// isOffMadagascarAnchor checks below) so the Madagascar view shows only real Madagascar records.
check(`all ${ISLAND_ANCHORS.length} anchors are inside WIO_BBOX`, ISLAND_ANCHORS.every((a) => inBbox(a.lng, a.lat, WIO_BBOX)));
check('only Mayotte may overlap the Madagascar bbox (the rest sit clear of it)',
	ISLAND_ANCHORS.filter((a) => inBbox(a.lng, a.lat, MADAGASCAR_BBOX)).every((a) => a.id === 'mayotte'));
check('Country=Mauritius → mauritius', resolveIslandAnchor({ country: 'Mauritius' }, ISLAND_ANCHORS)?.id === 'mauritius');
check('synonym Country=Maurice → mauritius', resolveIslandAnchor({ country: 'Maurice' }, ISLAND_ANCHORS)?.id === 'mauritius');
check('diacritic-folded Country=Réunion → reunion', resolveIslandAnchor({ country: 'Réunion' }, ISLAND_ANCHORS)?.id === 'reunion');
check('Country=Rodrigues → rodrigues (separate from Mauritius)', resolveIslandAnchor({ country: 'Rodrigues' }, ISLAND_ANCHORS)?.id === 'rodrigues');
check('Locality substring "St Denis, Réunion" → reunion', resolveIslandAnchor({ locality: 'St Denis, Réunion' }, ISLAND_ANCHORS)?.id === 'reunion');
check('Country=Madagascar → null (never anchored)', resolveIslandAnchor({ country: 'Madagascar', locality: 'Antananarivo' }, ISLAND_ANCHORS) === null);
check('all-blank fields → null', resolveIslandAnchor({ island: '', country: '', locality: '' }, ISLAND_ANCHORS) === null);
check('partial name in Locality ("maur") → null', resolveIslandAnchor({ locality: 'maur' }, ISLAND_ANCHORS) === null);
check('Country=Seychelles → seychelles', resolveIslandAnchor({ country: 'Seychelles' }, ISLAND_ANCHORS)?.id === 'seychelles');
check('Country=Comoros → comoros', resolveIslandAnchor({ country: 'Comoros' }, ISLAND_ANCHORS)?.id === 'comoros');
check('synonym Country=Comores → comoros', resolveIslandAnchor({ country: 'Comores' }, ISLAND_ANCHORS)?.id === 'comoros');
check('Country=Mayotte → mayotte (separate from Comoros)', resolveIslandAnchor({ country: 'Mayotte' }, ISLAND_ANCHORS)?.id === 'mayotte');
// Every anchor must have land beneath it on the WIO basemap (a coastline vertex nearby),
// so an anchored dot sits on its island, not in open sea (cf. the Rodrigues check above).
const wioVerts = WIO_OUTLINE.rings.flat();
const hasLandNear = (a, tol = 0.7) => wioVerts.some(([lng, lat]) => Math.hypot(lng - a.lng, lat - a.lat) < tol);
check('every island anchor has WIO coastline within 0.7° (land beneath it)', ISLAND_ANCHORS.every((a) => hasLandNear(a)));
// Anchored sheets are hidden on the Madagascar extent (Mayotte's anchor sits inside MADAGASCAR_BBOX
// but isn't drawn there); they still show on WIO/Global. Real-GPS sheets are unaffected.
check('isOffMadagascarAnchor: approximate sheet hidden on Madagascar extent', isOffMadagascarAnchor({ approximate: true }, 'madagascar') === true);
check('isOffMadagascarAnchor: approximate sheet shown on WIO extent', isOffMadagascarAnchor({ approximate: true }, 'wio') === false);
check('isOffMadagascarAnchor: real-GPS sheet shown on Madagascar extent', isOffMadagascarAnchor({ approximate: false }, 'madagascar') === false);
const mayotteAnchor = resolveMapCoords({ lat: null, lng: null, country: 'Mayotte' }, ISLAND_ANCHORS);
check('a coordinate-less Mayotte sheet anchors but is hidden on the Madagascar extent',
	mayotteAnchor.approximate === true && isOffMadagascarAnchor(mayotteAnchor, 'madagascar') === true && isOffMadagascarAnchor(mayotteAnchor, 'wio') === false);

const gps = resolveMapCoords({ lat: -18, lng: 47, island: 'Mauritius' }, ISLAND_ANCHORS);
check('real GPS wins over a named island (source gps, not approximate, uses real coord)',
	gps.coordinateSource === 'gps' && gps.approximate === false && gps.mapLat === -18 && gps.mapLng === 47);
const anchored = resolveMapCoords({ lat: null, lng: null, country: 'Mauritius' }, ISLAND_ANCHORS);
check('coordinate-less Mauritius → island anchor (approximate, mapLat=-20.285)',
	anchored.coordinateSource === 'island' && anchored.approximate === true && anchored.mapLat === -20.285 && anchored.anchorLabel === 'Mauritius');
const none = resolveMapCoords({ lat: null, lng: null, country: 'Madagascar' }, ISLAND_ANCHORS);
check('coordinate-less Madagascar → no location (mapLat null, source null, not approximate)',
	none.mapLat === null && none.mapLng === null && none.coordinateSource === null && none.approximate === false);

console.log('\n8. co-located point grouping — groupColocated + burstRing');
// Distinct points never collide → all singles, no stacks. This guards the diffuse-spread
// regression: genuinely-distinct GPS points must NOT be grouped/fanned (the old bug fanned
// them into the sea when zoomed out).
const distinct = groupColocated([
	{ x: 0, y: 0, specimen: {} },
	{ x: 1, y: 2, specimen: {} },
	{ x: 3, y: 4, specimen: {} }
]);
check('distinct points → all singles, no stacks', distinct.singles.length === 3 && distinct.stacks.length === 0);

// N exact-coincident points (an island anchor) → one stack of N, zero singles.
const five = groupColocated(Array.from({ length: 5 }, () => ({ x: 10, y: 10, specimen: {} })));
check('five identical points → one stack of 5, zero singles',
	five.singles.length === 0 && five.stacks.length === 1 && five.stacks[0].members.length === 5);
check('stack carries the shared centre', five.stacks[0].x === 10 && five.stacks[0].y === 10);

// A lone point beside an identical pair → 1 single + 1 stack(2); input order preserved.
const mix = groupColocated([
	{ x: 0, y: 0, specimen: { id: 'lone' } },
	{ x: 9, y: 9, specimen: { id: 'a' } },
	{ x: 9, y: 9, specimen: { id: 'b' } }
]);
check('lone point + identical pair → 1 single + 1 stack(2)',
	mix.singles.length === 1 && mix.singles[0].specimen.id === 'lone' &&
	mix.stacks.length === 1 && mix.stacks[0].members.length === 2);

// Empty / null / single inputs are handled.
const empty = groupColocated([]);
check('empty input → no singles, no stacks', empty.singles.length === 0 && empty.stacks.length === 0);
const nul = groupColocated(null);
check('null input → no singles, no stacks', nul.singles.length === 0 && nul.stacks.length === 0);
const lone = groupColocated([{ x: 7, y: 7, specimen: {} }]);
check('one point → one single, no stack', lone.singles.length === 1 && lone.stacks.length === 0);

// burstRing(n, r): n offsets, each at radius ≈ r, evenly spaced (distinct angles), deterministic.
const ring = burstRing(6, 4);
check('burstRing(n, r) returns n offsets', ring.length === 6);
check('every burst offset is at radius ≈ r', ring.every((o) => Math.abs(Math.hypot(o.dx, o.dy) - 4) < 1e-9));
const burstAngles = new Set(ring.map((o) => Math.atan2(o.dy, o.dx).toFixed(6)));
check('burst offsets are evenly spaced (6 distinct angles)', burstAngles.size === 6);
const ring2 = burstRing(6, 4);
check('burstRing is deterministic', ring.every((o, i) => o.dx === ring2[i].dx && o.dy === ring2[i].dy));
check('burstRing(0, r) is empty', burstRing(0, 4).length === 0);

console.log('');
if (failures === 0) {
	console.log('✅ all geo checks passed\n');
	process.exit(0);
} else {
	console.log(`❌ ${failures} geo check(s) failed\n`);
	process.exit(1);
}
