// How much hotter each forecast town gets (hot days a year in the last projected decade minus the latest observed
// decade) over a layer of how disadvantaged each postcode is (ABS SEIFA 2021, IRSD). Either layer can be switched off.
// The SEIFA layer describes areas, never people.
import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { IRSD, POSTCODE_LOCATION } from "@greenspark/shared";
import type { ClimateDecades } from "../data/api";
import { addBaseTiles } from "./mapTiles";

const WA_BOUNDS: L.LatLngBoundsExpression = [[-35.2, 112.9], [-13.7, 129.1]];
type Ready = Extract<ClimateDecades, { available: true }>;

/** Increase in hot days a year: pale to deep red, as a share of the biggest increase. */
const INCREASE_COLOR = ["#fff1d6", "#fbe6c2", "#f8c88a", "#f29d52", "#e2683c", "#ae2e24"];
function increaseColor(n: number, max: number): string {
  const t = Math.max(0, n) / Math.max(1, max);
  return INCREASE_COLOR[Math.min(INCREASE_COLOR.length - 1, Math.floor(t * INCREASE_COLOR.length))]!;
}
/** SEIFA decile 1 (most disadvantaged) deep purple to decile 10 pale lilac, a different hue from the heat. */
const SEIFA_COLOR = ["#3b1a6b", "#53288f", "#6c3fb0", "#8660c4", "#a183d3", "#baa3de", "#d0c1e8", "#e1d8f0", "#eee8f6", "#f7f4fb"];

export function ClimateIncreaseMap({ data, threshold }: { data: Ready; threshold: "hot" | "veryHot" }) {
  const [showIncrease, setShowIncrease] = useState(true);
  const [showSeifa, setShowSeifa] = useState(true);
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const seifaLayer = useRef<L.LayerGroup | null>(null);
  const heatLayer = useRef<L.LayerGroup | null>(null);
  const lastObserved = data.observedDecades.at(-1)!, lastProjected = data.projectedDecades.at(-1)!;

  const towns = useMemo(() => data.towns.flatMap((t) => {
    const now = t.observed[lastObserved]?.[threshold] ?? null, then = t.projected[lastProjected]?.[threshold] ?? null;
    return t.lat === undefined || t.lng === undefined || now === null || then === null ? [] : [{ ...t, lat: t.lat, lng: t.lng, increase: then - now }];
  }), [data, threshold, lastObserved, lastProjected]);
  const max = useMemo(() => Math.max(1, ...towns.map((t) => t.increase)), [towns]);

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = (map.current = L.map(el.current, { scrollWheelZoom: false }).fitBounds(WA_BOUNDS, { padding: [22, 22] }));
    addBaseTiles(m);
    m.createPane("seifa").style.zIndex = "420";
    m.createPane("increase").style.zIndex = "450";
    seifaLayer.current = L.layerGroup().addTo(m);
    heatLayer.current = L.layerGroup().addTo(m);
    return () => { m.remove(); map.current = null; };
  }, []);

  // The postcodes are small dots underneath, so the town circles stay easy to read and click.
  useEffect(() => {
    const g = seifaLayer.current;
    if (!g) return;
    g.clearLayers();
    if (!showSeifa) return;
    for (const [postcode, [score, decileAus, decileWA]] of Object.entries(IRSD)) {
      const loc = POSTCODE_LOCATION[postcode];
      if (!loc) continue;
      L.circleMarker(loc, { pane: "seifa", radius: 5, weight: 1, color: "#ffffff", fillColor: SEIFA_COLOR[decileWA - 1]!, fillOpacity: 0.95 })
        .bindTooltip(`${postcode} · disadvantage decile ${decileWA} in WA, ${decileAus} in Australia (1 is most disadvantaged) · IRSD ${score}`)
        .addTo(g);
    }
  }, [showSeifa]);
  useEffect(() => {
    const g = heatLayer.current;
    if (!g) return;
    g.clearLayers();
    if (!showIncrease) return;
    for (const t of towns) {
      const marker = L.circleMarker([t.lat, t.lng], { pane: "increase", radius: 16, weight: 2, color: "#ffffff", fillColor: increaseColor(t.increase, max), fillOpacity: showSeifa ? 0.8 : 0.95 });
      marker.bindTooltip(`${t.name}: ${t.increase >= 0 ? "+" : "−"}${Math.abs(Math.round(t.increase))} days a year at ${data.thresholds[threshold]}°C or more`);
      marker.addTo(g);
      L.marker([t.lat, t.lng], { pane: "increase", interactive: false, icon: L.divIcon({ className: "decade-map-n", html: `+${Math.round(t.increase)}`, iconSize: [32, 24] }) }).addTo(g);
    }
  }, [towns, max, showIncrease, showSeifa, data.thresholds, threshold]);

  return (
    <div className="decade-map">
      <div className="decade-map-bar">
        <p className="decade-map-title"><strong>Increase in days a year at {data.thresholds[threshold]}°C or more</strong> <span className="sub">{lastObserved.replace("-", "–")} to {lastProjected.replace("-", "–")}, over disadvantage by postcode</span></p>
        <div className="decade-map-layers" role="group" aria-label="Map layers">
          <label><input type="checkbox" checked={showIncrease} onChange={(e) => setShowIncrease(e.target.checked)} /> Increase in hot days (towns)</label>
          <label><input type="checkbox" checked={showSeifa} onChange={(e) => setShowSeifa(e.target.checked)} /> SEIFA disadvantage (postcodes)</label>
        </div>
      </div>
      <div className="decade-map-wrap">
        <div ref={el} className="decade-map-canvas" role="region" aria-label="Map of the increase in hot days against SEIFA disadvantage" />
        <div className="decade-map-legend">
          {showIncrease ? <div><span className="sub">Fewer extra days</span><span className="area-ramp">{INCREASE_COLOR.map((c) => <i key={c} style={{ background: c }} />)}</span><span className="sub">{Math.round(max)} more</span></div> : null}
          {showSeifa ? <div><span className="sub">More disadvantaged</span><span className="area-ramp">{SEIFA_COLOR.map((c, i) => <i key={c} style={{ background: c }} title={`Decile ${i + 1}`} />)}</span><span className="sub">Less</span></div> : null}
        </div>
      </div>
    </div>
  );
}
