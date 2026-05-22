/**
 * Geo-Targeting Validation Logic for Phase 1.6
 * Computes geo-match between creator and brand audiences
 */

export type GeoMatchType = 'exact' | 'regional' | 'cultural' | 'none';

export interface GeoMatchResult {
  geoMatch: GeoMatchType;
  matchStrength: number; // 0-100
  reasoning: string;
}

const REGION_GROUPS: Record<string, string[]> = {
  'North America': [
    'Toronto', 'New York', 'NYC', 'Los Angeles', 'LA', 'Chicago', 'Miami',
    'Houston', 'Atlanta', 'Montreal', 'Vancouver', 'Calgary', 'Ottawa',
    'Edmonton', 'Winnipeg', 'Quebec', 'Halifax', 'Cleveland', 'Brooklyn',
    'Nashville', 'Austin', 'Seattle', 'Denver', 'Boston', 'Philadelphia',
  ],
  'Europe': [
    'London', 'Paris', 'Berlin', 'Amsterdam', 'Madrid', 'Rome', 'Dublin',
    'Stockholm', 'Copenhagen', 'Vienna', 'Prague', 'Warsaw', 'Budapest', 'Lisbon',
  ],
  'Middle East': [
    'Dubai', 'Abu Dhabi', 'Riyadh', 'Doha', 'Kuwait', 'Bahrain', 'Amman',
    'Beirut', 'Tel Aviv', 'Istanbul',
  ],
  'Asia Pacific': [
    'Sydney', 'Melbourne', 'Singapore', 'Hong Kong', 'Tokyo', 'Bangkok',
    'Manila', 'Jakarta', 'Seoul', 'Mumbai', 'Delhi', 'Bangalore', 'Auckland',
  ],
};

/**
 * Validates geographic match between creator and brand audiences
 * Returns match type (exact/regional/cultural/none) and strength score
 */
export function validateGeoMatch(
  creatorRegion: string | null | undefined,
  brandRegion: string | null | undefined,
  creatorLanguage: string = 'English',
  brandLanguage: string = 'English'
): GeoMatchResult {
  // If either is missing, default to cultural alignment
  if (!creatorRegion || !brandRegion) {
    return {
      geoMatch: 'cultural',
      matchStrength: creatorLanguage === brandLanguage ? 60 : 40,
      reasoning: 'Language alignment used as proxy for cultural match',
    };
  }

  // Exact match
  if (creatorRegion.toLowerCase() === brandRegion.toLowerCase()) {
    return {
      geoMatch: 'exact',
      matchStrength: 100,
      reasoning: `Creator and brand both target ${creatorRegion}`,
    };
  }

  // Regional match
  for (const [region, cities] of Object.entries(REGION_GROUPS)) {
    const creatorInRegion = cities.some(city =>
      creatorRegion.toLowerCase().includes(city.toLowerCase())
    );
    const brandInRegion = cities.some(city =>
      brandRegion.toLowerCase().includes(city.toLowerCase())
    );

    if (creatorInRegion && brandInRegion) {
      return {
        geoMatch: 'regional',
        matchStrength: 75,
        reasoning: `Both operate in ${region}`,
      };
    }
  }

  // Cultural/language alignment
  if (creatorLanguage === brandLanguage) {
    return {
      geoMatch: 'cultural',
      matchStrength: 50,
      reasoning: `Language alignment (${creatorLanguage}) suggests cultural compatibility`,
    };
  }

  // No match
  return {
    geoMatch: 'none',
    matchStrength: 20,
    reasoning: `Geographic and cultural mismatch — creator targets ${creatorRegion}, brand targets ${brandRegion}`,
  };
}
