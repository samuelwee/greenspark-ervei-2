import { describe, expect, it } from "vitest";
import type { OutlookTown } from "../data/api";
import { estimateTemperature, forecastTemperatures, temperatureColor } from "./forecastHeat";

const town = (patch: Partial<OutlookTown> = {}): OutlookTown => ({ id: "coast", name: "Coast", district: "test", districtName: "Test", lat: -32, lng: 115.75,
  days: [{ date: "2026-10-25", max: 30, min: 18, precis: "Sunny" }, { date: "2026-10-26", max: 38, min: 24, precis: "Hot" }],
  climate: null, hazards: [], customers: 0, exposed: 0, act: 0, watch: 0, ...patch });

describe("forecast temperature surface", () => {
  it("uses the selected day's maximum or each town's weekly peak, and excludes missing values", () => {
    expect(forecastTemperatures([town()], "2026-10-25")[0]!.max).toBe(30);
    expect(forecastTemperatures([town()], "")[0]!.max).toBe(38);
    expect(forecastTemperatures([town()], "2026-11-01")).toEqual([]);
    expect(forecastTemperatures([town({ days: [{ date: "2026-10-25", max: null, min: 20, precis: "" }] })], "")).toEqual([]);
  });
  it("preserves the actual coast/inland readings, estimates only in range, and leaves distant gaps blank", () => {
    const points = [{ id: "coast", name: "Coast", lat: -32, lng: 115.75, max: 36 }, { id: "inland", name: "Inland", lat: -32, lng: 116.15, max: 43 }];
    expect(estimateTemperature(points, -32, 115.75)?.max).toBe(36);
    expect(estimateTemperature(points, -32, 116.15)?.max).toBe(43);
    expect(estimateTemperature(points, -32, 115.95)?.max).toBeCloseTo(39.5, 1);
    expect(estimateTemperature(points, -20, 120)).toBeNull();
    expect(estimateTemperature([], -32, 116)).toBeNull();
  });
  it("keeps mild values clear and hotter values visibly stronger on the same fixed scale", () => {
    expect(temperatureColor(27)[3]).toBe(0);
    expect(temperatureColor(43)[3]).toBeGreaterThan(temperatureColor(36)[3]);
    expect(temperatureColor(36)[3]).toBeGreaterThan(temperatureColor(30)[3]);
    expect(temperatureColor(43)).not.toEqual(temperatureColor(36));
  });
});
