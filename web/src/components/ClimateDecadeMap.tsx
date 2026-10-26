// The decade-by-decade heat as a map: each forecast town is a circle coloured by its hot days a year in the chosen
// decade, observed up to 2020-25 then projected. The slider steps through the decades.
import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { ClimateDecades } from "../data/api";
import { addBaseTiles } from "./mapTiles";

const WA_BOUNDS: L.LatLngBoundsExpression = [[-35.2, 112.9], [-13.7, 129.1]];
type Ready = Extract<ClimateDecades, { available: true }>;

/** Pale to deep red for a count of days a year, as a share of the busiest town-decade. */
function colorFor(n: number | null, max: number): string {
  if (n === null) return "#c9ced6";
  const t = Math.min(1, n / Math.max(1, max));
  return t >= 0.75 ? "#ae2e24" : t >= 0.5 ? "#e2683c" : t >= 0.3 ? "#f29d52" : t >= 0.15 ? "#f8c88a" : t >= 0.05 ? "#fbe6c2" : "#fff1d6";
}

export function ClimateDecadeMap({ data, threshold, max }: { data: Ready; threshold: "hot" | "veryHot"; max: number }) {
  const decades = useMemo(() => [...data.observedDecades.map((d) => ({ id: d, projected: false })), ...data.projectedDecades.map((d) => ({ id: d, projected: true }))], [data]);
  const [index, setIndex] = useState(Math.max(0, data.observedDecades.length - 1));
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const current = decades[index]!;
  const label = current.id.replace("-", "–");

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = (map.current = L.map(el.current, { scrollWheelZoom: false }).fitBounds(WA_BOUNDS, { padding: [22, 22] }));
    addBaseTiles(m);
    layer.current = L.layerGroup().addTo(m);
    return () => { m.remove(); map.current = null; };
  }, []);
  useEffect(() => {
    const g = layer.current;
    if (!g) return;
    g.clearLayers();
    const towns = data.towns.filter((t) => t.lat !== undefined && t.lng !== undefined);
    for (const t of towns) {
      const v = (current.projected ? t.projected : t.observed)[current.id]?.[threshold] ?? null;
      const marker = L.circleMarker([t.lat!, t.lng!], { radius: 12, weight: 1.5, color: "#ffffff", fillColor: colorFor(v, max), fillOpacity: 0.95 });
      marker.bindTooltip(`${t.name}: ${v === null ? "no data" : `${Math.round(v)} days a year`}`);
      marker.addTo(g);
      const text = L.marker([t.lat!, t.lng!], { interactive: false, icon: L.divIcon({ className: "decade-map-n", html: v === null ? "–" : String(Math.round(v)), iconSize: [24, 24] }) });
      text.addTo(g);
    }
  }, [data, current, threshold, max]);

  return (
    <div className="decade-map">
      <div className="decade-map-bar">
        <label htmlFor="decade-slider"><strong>{label}</strong> <span className="sub">{current.projected ? "projected" : "observed"} · days a year at {data.thresholds[threshold]}°C or more</span></label>
        <input id="decade-slider" type="range" min={0} max={decades.length - 1} step={1} value={index} onChange={(e) => setIndex(Number(e.target.value))} aria-valuetext={`${label}, ${current.projected ? "projected" : "observed"}`} />
        <span className="decade-map-ends sub"><span>{decades[0]!.id}</span><span>{decades[decades.length - 1]!.id}</span></span>
      </div>
      <div ref={el} className="decade-map-canvas" role="region" aria-label={`Map of hot days a year in ${label}`} />
    </div>
  );
}
