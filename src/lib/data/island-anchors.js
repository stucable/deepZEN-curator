// Bundled gazetteer of small-island reference coordinates ("anchors") for the
// Western Indian Ocean. When a specimen has NO recorded GPS but names a recognised
// small island (in its Country — or Locality), the app maps it to that island's
// centroid and flags it APPROXIMATE (a hollow dot). The anchor is a DISPLAY position
// only — it is never written back to the CSV (see resolveMapCoords in geo.js and the
// serializer in csv.js).
//
// HARD SCOPE: small WIO islands ONLY — the Mascarenes (Réunion, Mauritius, Rodrigues)
// plus Seychelles, Comoros and Mayotte. Madagascar and the African mainland are
// deliberately ABSENT so they can never match — their specimens map by real GPS or stay
// in the map's "Without coordinates" list, exactly as before. To widen scope later, add
// a row of the same shape. Each island is its own anchor (e.g. Rodrigues is separate from
// Mauritius, so a `Country = Rodrigues` sheet pins east of Mauritius); every anchor must
// also be drawn on the WIO basemap — see scripts/generate-basemap.js.
//
// `lat`/`lng` are island centroids in decimal degrees, all inside WIO_BBOX (so an
// anchored sheet auto-selects the WIO extent via detectExtent). `names` are match
// synonyms; matching diacritic-folds both sides (see resolveIslandAnchor), so the
// accented and unaccented spellings of "Réunion" both hit without enumerating them.

/** @type {{ id: string, label: string, names: string[], lat: number, lng: number }[]} */
export const ISLAND_ANCHORS = [
	{
		id: 'reunion',
		label: 'Réunion',
		names: ['reunion', 'la reunion', 'ile de la reunion'],
		lat: -21.115,
		lng: 55.536
	},
	{
		id: 'mauritius',
		label: 'Mauritius',
		names: ['mauritius', 'maurice', 'ile maurice'],
		lat: -20.285,
		lng: 57.56
	},
	{
		id: 'rodrigues',
		label: 'Rodrigues',
		names: ['rodrigues', 'rodriguez', 'ile rodrigues'],
		lat: -19.717,
		lng: 63.412
	},
	{
		id: 'seychelles',
		label: 'Seychelles',
		names: ['seychelles', 'mahe'],
		lat: -4.68,
		lng: 55.48
	},
	{
		id: 'comoros',
		label: 'Comoros',
		names: ['comoros', 'comores', 'grande comore', 'ngazidja', 'anjouan', 'moheli'],
		lat: -11.7,
		lng: 43.26
	},
	{
		id: 'mayotte',
		label: 'Mayotte',
		names: ['mayotte', 'maore'],
		lat: -12.83,
		lng: 45.17
	}
];
