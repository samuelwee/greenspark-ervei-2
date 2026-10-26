// Long-term heat for each postcode (data/climate/heat-by-postcode.v1.json, written by scripts/build-climate-heat.mts):
// very hot days a year now, from SILO, and around 2050, from Climate Change in Australia's CMIP6 projections.
// Read once at start; without the file there is no long-term heat.
import { existsSync, readFileSync } from "node:fs";

export interface PostcodeHeat { hot: number; veryHot: number; summerMax: number; hot2050: number | null; veryHot2050: number | null; town: string | null }
export interface ClimateHeat {
  id: string;
  thresholds: { hot: number; veryHot: number };
  baseline: { source: string; years: [number, number]; licence: string };
  projection: { source: string; scenario: string; period: string; models: string[]; method: string; licence: string };
  postcodes: Record<string, PostcodeHeat>;
}

export function loadClimate(path: string): ClimateHeat | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as ClimateHeat;
}

/** Very hot days a year per decade, observed and projected (data/climate/heat-decades.v1.json, from scripts/build-climate-decades.mts). */
export interface ClimateDecades {
  id: string;
  thresholds: { hot: number; veryHot: number };
  observedDecades: string[]; projectedDecades: string[];
  observed: { source: string; years: [number, number]; licence: string };
  projected: { source: string; scenario: string; models: string[]; coverage: string; sampled: string; method: string; licence: string };
  postcodes: Record<string, { town: string | null; observed: Record<string, { hot: number; veryHot: number }>; projected: Record<string, { hot: number; veryHot: number }> }>;
}

export function loadDecades(path: string): ClimateDecades | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as ClimateDecades;
}
