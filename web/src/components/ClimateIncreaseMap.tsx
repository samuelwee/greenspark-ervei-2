// How much hotter each forecast town gets (hot days a year in the last projected decade minus the latest observed
// decade), as circles sized and coloured by the increase. Towns that would overlap merge into one circle showing the
// range, and split as you zoom in. Clicking a town selects it in the table below. Postcode areas shaded by how
// disadvantaged they are (ABS SEIFA 2021, IRSD; ABS postal area boundaries) can be switched on as a second layer.
// The SEIFA layer describes areas, never people.
import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { IRSD } from "@greenspark/shared";
import type { ClimateDecades } from "../data/api";
import { addBaseTiles } from "./mapTiles";

type Boundaries = import("geojson").FeatureCollection<import("geojson").Geometry, { postcode: string }>;

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

export function ClimateIncreaseMap({ data, threshold, selected, onSelect }: {
  data: Ready; threshold: "hot" | "veryHot"; selected: { id: string; from: "map" | "table" } | null; onSelect: (id: string, from: "map" | "table") => void;
}) {
  const [showIncrease, setShowIncrease] = useState(true);
  const [showSeifa, setShowSeifa] = useState(false);
  const [boundaries, setBoundaries] = useState<Boundaries | null>(null);
  const [zoom, setZoom] = useState(0);
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const seifaLayer = useRef<L.LayerGroup | null>(null);
  const heatLayer = useRef<L.LayerGroup | null>(null);
  const select = useRef(onSelect);
  select.current = onSelect;
  const lastObserved = data.observedDecades.at(-1)!, lastProjected = data.projectedDecades.at(-1)!;

  const towns = useMemo(() => data.towns.flatMap((t) => {
    const now = t.observed[lastObserved]?.[threshold] ?? null, then = t.projected[lastProjected]?.[threshold] ?? null;
    return t.lat === undefined || t.lng === undefined || now === null || then === null ? [] : [{ ...t, lat: t.lat, lng: t.lng, increase: then - now }];
  }), [data, threshold, lastObserved, lastProjected]);
  const max = useMemo(() => Math.max(1, ...towns.map((t) => t.increase)), [towns]);

  // The boundaries are a 180 KB file, loaded when the map opens.
  useEffect(() => {
    let live = true;
    void import("../data/postcode-boundaries.v1.json").then((m) => { if (live) setBoundaries(m.default as unknown as Boundaries); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (!el.current || map.current) return;
    const m = (map.current = L.map(el.current, { scrollWheelZoom: true }).fitBounds(WA_BOUNDS, { padding: [22, 22] }));
    addBaseTiles(m);
    m.createPane("seifa").style.zIndex = "420";
    m.createPane("increase").style.zIndex = "450";
    m.createPane("increaseLabels").style.zIndex = "460";
    m.on("zoomend", () => setZoom(m.getZoom()));
    setZoom(m.getZoom());
    seifaLayer.current = L.layerGroup().addTo(m);
    heatLayer.current = L.layerGroup().addTo(m);
    return () => { m.remove(); map.current = null; };
  }, []);

  // The postcode areas sit underneath, so the town circles stay easy to read and click.
  useEffect(() => {
    const g = seifaLayer.current;
    if (!g) return;
    g.clearLayers();
    if (!showSeifa || !boundaries) return;
    L.geoJSON(boundaries, {
      pane: "seifa",
      style: (f) => {
        const r = IRSD[f?.properties.postcode ?? ""];
        return { weight: 1, color: "#ffffff", fillColor: r ? SEIFA_COLOR[r[2] - 1]! : "#d8dce2", fillOpacity: 0.8 };
      },
      onEachFeature: (f, layer) => {
        const r = IRSD[f.properties.postcode];
        layer.bindTooltip(`${f.properties.postcode}${r ? ` · disadvantage decile ${r[2]} in WA, ${r[1]} in Australia (1 is most disadvantaged) · IRSD ${r[0]}` : ""}`, { sticky: true });
      },
    }).addTo(g);
  }, [showSeifa, boundaries]);
  useEffect(() => {
    const g = heatLayer.current;
    if (!g) return;
    g.clearLayers();
    if (!showIncrease) return;
    const m = map.current;
    if (!m) return;
    const sign = (n: number) => (Math.round(n) > 0 ? `+${Math.round(n)}` : Math.round(n) < 0 ? `\u2212${Math.abs(Math.round(n))}` : "0");
    const unit = `days a year at ${data.thresholds[threshold]}\u00b0C or more`;
    // Circles are sized by the increase. Towns closer than 40 px merge into one circle, biggest increase first.
    const clusters: { seed: L.Point; towns: typeof towns }[] = [];
    for (const t of [...towns].sort((x, y) => y.increase - x.increase)) {
      const at = m.latLngToContainerPoint([t.lat, t.lng]);
      const home = clusters.find((c) => c.seed.distanceTo(at) < 40);
      if (home) home.towns.push(t); else clusters.push({ seed: at, towns: [t] });
    }
    const radiusOf = (n: number) => 7 + 15 * (Math.max(0, n) / max);
    for (const c of clusters) {
      const top = c.towns[0]!, low = c.towns[c.towns.length - 1]!, many = c.towns.length > 1;
      const lat = c.towns.reduce((n, t) => n + t.lat, 0) / c.towns.length, lng = c.towns.reduce((n, t) => n + t.lng, 0) / c.towns.length;
      const chosen = c.towns.some((t) => t.id === selected?.id);
      const marker = L.circleMarker([lat, lng], {
        pane: "increase", radius: many ? Math.max(18, radiusOf(top.increase)) : radiusOf(top.increase),
        weight: chosen ? 4 : 2, color: chosen ? "#1b2a24" : "#ffffff", fillColor: increaseColor(top.increase, max), fillOpacity: showSeifa ? 0.85 : 0.95,
      });
      if (many) {
        marker.bindTooltip(`<span style="color:${top.increase / max >= 0.5 ? "#ffffff" : "#2b1a00"}">${sign(low.increase)}\u2013${sign(top.increase).replace("+", "")}</span>`, { permanent: true, direction: "center", className: "decade-map-label", pane: "increaseLabels", interactive: false });
        marker.on("click", () => m.fitBounds(L.latLngBounds(c.towns.map((t) => [t.lat, t.lng] as [number, number])), { padding: [60, 60], maxZoom: 11 }));
      } else {
        marker.bindTooltip(`${top.name}: ${sign(top.increase)} ${unit}`);
        marker.on("click", () => select.current(top.id, "map"));
      }
      marker.addTo(g);
    }
  }, [towns, max, showIncrease, showSeifa, data.thresholds, threshold, zoom, selected]);
  // Choosing a town in the table brings it into view on the map.
  useEffect(() => {
    if (selected?.from !== "table") return;
    const t = towns.find((x) => x.id === selected.id);
    if (t && map.current) map.current.flyTo([t.lat, t.lng], Math.max(map.current.getZoom(), 9), { duration: 0.8 });
  }, [selected, towns]);

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
