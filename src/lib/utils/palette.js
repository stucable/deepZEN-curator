// Categorical colour palette for distinguishing species on the map.
//
// This is the one deliberate, scoped exception to the app's "emerald is the single
// accent colour" rule: these colours encode *data* (which species a point belongs
// to), not UI chrome. They appear only on map points and the map legend.
//
// Built from the Okabe-Ito colour-blind-safe set, extended with Paul Tol's "muted"
// qualitative palette, de-duplicated to 16 reasonably distinguishable hues. When a
// dataset shows more species than this at once the map falls back to a single
// colour (the caller decides), since a legend past ~16 entries isn't legible anyway.

export const SPECIES_PALETTE = [
	'#E69F00', // orange
	'#56B4E9', // sky blue
	'#009E73', // bluish green
	'#0072B2', // blue
	'#D55E00', // vermillion
	'#CC79A7', // reddish purple
	'#332288', // indigo
	'#117733', // dark green
	'#882255', // wine
	'#88CCEE', // pale blue
	'#999933', // olive
	'#AA4499', // purple
	'#661100', // brown
	'#6699CC', // steel blue
	'#DDCC77', // sand
	'#44AA99'  // teal
];

/** Number of distinct colours before the palette repeats. */
export const PALETTE_SIZE = SPECIES_PALETTE.length;

/** Colour for the i-th category, cycling if the index exceeds the palette. */
export function colourForIndex(i) {
	return SPECIES_PALETTE[((i % PALETTE_SIZE) + PALETTE_SIZE) % PALETTE_SIZE];
}
