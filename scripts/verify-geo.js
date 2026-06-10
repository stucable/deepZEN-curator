// Verifies the pure geo helpers used by the map (curation step D):
// ray-casting point-in-polygon and the project/unproject round-trip.
// Run: node scripts/verify-geo.js   (wired as `npm run check:geo`)

import {
	pointInRing,
	projectLngLat,
	unprojectXY,
	inBbox,
	MADAGASCAR_BBOX
} from '../src/lib/utils/geo.js';

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

console.log('');
if (failures === 0) {
	console.log('✅ all geo checks passed\n');
	process.exit(0);
} else {
	console.log(`❌ ${failures} geo check(s) failed\n`);
	process.exit(1);
}
