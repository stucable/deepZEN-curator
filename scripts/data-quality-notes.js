/**
 * Known source-data issues retained pending verification against the specimen
 * record. validate-data.js reports these on every run so they stay visible but
 * does not guess corrections into the shipped CSV.
 */
export const KNOWN_COORDINATE_ISSUES = {
	sarcolaenaceae: {
		K006972715: 'Positive latitude for a Madagascar record; likely missing a minus sign.',
		K000300466: 'Positive latitude for a Madagascar record; likely missing a minus sign.',
		K000580476: 'Positive latitude for a Madagascar record; likely missing a minus sign.',
		K005508178: 'Negative longitude places the record in South America; likely a sign error.',
		K000240308: 'Latitude/longitude are outside Madagascar and appear to contain sign or digit transpositions.',
		K000300416: 'Positive latitude for a Madagascar record; likely missing a minus sign.',
		K005508292: 'Longitude 5.04778 is outside Madagascar and may have a missing digit or decimal shift.',
		K000300456: 'Positive latitude for a Madagascar record; likely missing a minus sign.',
		K000300455: 'Positive latitude for a Madagascar record; likely missing a minus sign.'
	}
};
