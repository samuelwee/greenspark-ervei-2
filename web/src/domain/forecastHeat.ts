import type { OutlookTown } from "../data/api";

export interface ForecastTemperature { id: string; name: string; lat: number; lng: number; max: number }

/** An empty date means each town's peak daily maximum over the displayed forecast week. */
export function forecastTemperatures(towns: OutlookTown[], date: string): ForecastTemperature[] {
  return towns.flatMap((town) => {
    const values = town.days.filter((day) => !date || day.date === date).map((day) => day.max).filter((max): max is number => max !== null && Number.isFinite(max));
    return values.length && Number.isFinite(town.lat) && Number.isFinite(town.lng)
      ? [{ id: town.id, name: town.name, lat: town.lat, lng: town.lng, max: Math.max(...values) }] : [];
  });
}

export const MAX_INTERPOLATION_KM = 120;

/** Inverse-distance estimate from up to four nearby towns. Never invent values in large forecast gaps. */
export function estimateTemperature(points: ForecastTemperature[], lat: number, lng: number): { max: number; distanceKm: number } | null {
  const nearby = points.map((point) => {
    const dy = (point.lat - lat) * 111.2, dx = (point.lng - lng) * 111.2 * Math.cos(lat * Math.PI / 180);
    return { point, d2: dx * dx + dy * dy };
  }).filter((item) => item.d2 <= MAX_INTERPOLATION_KM ** 2).sort((a, b) => a.d2 - b.d2).slice(0, 4);
  if (!nearby.length) return null;
  if (nearby[0]!.d2 < 0.01) return { max: nearby[0]!.point.max, distanceKm: Math.sqrt(nearby[0]!.d2) };
  let sum = 0, weight = 0;
  for (const item of nearby) { const w = 1 / item.d2; sum += item.point.max * w; weight += w; }
  return { max: sum / weight, distanceKm: Math.sqrt(nearby[0]!.d2) };
}

const STOPS = [
  { max: 28, rgba: [255, 235, 196, 0] },
  { max: 32, rgba: [255, 228, 171, 8] },
  { max: 35, rgba: [255, 204, 153, 28] },
  { max: 38, rgba: [255, 157, 132, 64] },
  { max: 41, rgba: [248, 91, 104, 130] },
  { max: 44, rgba: [202, 37, 79, 178] },
];

/** Fixed °C scale across dates/regions; colours never stretch to make a mild day look extreme. */
export function temperatureColor(max: number): [number, number, number, number] {
  if (max <= STOPS[0]!.max) return [...STOPS[0]!.rgba] as [number, number, number, number];
  for (let index = 1; index < STOPS.length; index++) {
    const low = STOPS[index - 1]!, high = STOPS[index]!;
    if (max <= high.max) {
      const t = (max - low.max) / (high.max - low.max);
      return low.rgba.map((value, channel) => Math.round(value + (high.rgba[channel]! - value) * t)) as [number, number, number, number];
    }
  }
  return [...STOPS.at(-1)!.rgba] as [number, number, number, number];
}
