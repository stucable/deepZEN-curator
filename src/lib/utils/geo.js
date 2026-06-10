// Pure geographic helpers for the offline SVG map (curation step D).
// No DOM, no dependencies — keeps the map testable and replaces any need for
// turf.js (point-in-polygon) or a projection library.

const DEG2RAD = Math.PI / 180;

/**
 * Bounding box of Madagascar, padded a little beyond the coastline so coastal
 * specimens aren't clipped at the very edge. Used to frame the SVG viewBox and
 * to drop obviously-bad coordinates (e.g. a sign-flipped latitude landing in the
 * northern hemisphere) off the plotted map.
 */
export const MADAGASCAR_BBOX = { latMin: -25.7, latMax: -11.9, lngMin: 43.1, lngMax: 50.6 };

/** True if a coordinate falls inside the given bbox (defaults to Madagascar). */
export function inBbox(lng, lat, bbox = MADAGASCAR_BBOX) {
	return lng >= bbox.lngMin && lng <= bbox.lngMax && lat >= bbox.latMin && lat <= bbox.latMax;
}

/**
 * Longitude scale factor at the bbox's mean latitude. One degree of longitude is
 * shorter than one degree of latitude away from the equator; applying cos(meanLat)
 * to x keeps the island from looking horizontally stretched.
 */
function lngScale(bbox) {
	return Math.cos(((bbox.latMin + bbox.latMax) / 2) * DEG2RAD);
}

/**
 * Projected width/height of the bbox in map units (degrees, with x cos-corrected).
 * The map component uses this as its SVG viewBox so that the basemap and points
 * share one projection and the aspect ratio is preserved automatically.
 */
export function projectedExtent(bbox = MADAGASCAR_BBOX) {
	return {
		width: (bbox.lngMax - bbox.lngMin) * lngScale(bbox),
		height: bbox.latMax - bbox.latMin
	};
}

/**
 * Project a geographic coordinate to SVG map space (origin top-left, y down).
 * Equirectangular with cos-latitude correction; the output lives in the same
 * units as projectedExtent so it maps directly into the viewBox.
 */
export function projectLngLat(lng, lat, bbox = MADAGASCAR_BBOX) {
	return {
		x: (lng - bbox.lngMin) * lngScale(bbox),
		y: bbox.latMax - lat
	};
}

/**
 * Inverse of projectLngLat. Converts an SVG-space point (e.g. a polygon vertex the
 * curator clicked) back to geographic coordinates, so a drawn selection is stored
 * in lng/lat and survives zoom/pan.
 */
export function unprojectXY(x, y, bbox = MADAGASCAR_BBOX) {
	return {
		lng: bbox.lngMin + x / lngScale(bbox),
		lat: bbox.latMax - y
	};
}

/**
 * Ray-casting point-in-polygon. `ring` is a closed-or-open list of [lng, lat]
 * vertices; the boundary is treated as a single ring (no holes). Works in raw
 * lng/lat space — the cos correction doesn't change inside/outside topology.
 * @param {number} lng
 * @param {number} lat
 * @param {number[][]} ring - [[lng, lat], …]
 * @returns {boolean}
 */
export function pointInRing(lng, lat, ring) {
	if (!ring || ring.length < 3) return false;
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [xi, yi] = ring[i];
		const [xj, yj] = ring[j];
		const intersects =
			yi > lat !== yj > lat &&
			lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
		if (intersects) inside = !inside;
	}
	return inside;
}
