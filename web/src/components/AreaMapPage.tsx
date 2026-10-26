// A large map of every postcode customers live in, coloured by how disadvantaged the area is (ABS SEIFA 2021,
// Index of Relative Socio-economic Disadvantage), with the customers covered by the weather outlook sized on top.
// It describes areas, never people.
import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { AREA_DECILE_LIMIT, IRSD, POSTCODE_LOCATION } from "@greenspark/shared";
import type { ApiClient, Outlook } from "../data/api";
import { addBaseTiles } from "./mapTiles";

const WA_BOUNDS: L.LatLngBoundsExpression = [[-35.2, 112.9], [-13.7, 129.1]];
/** Decile 1 (most disadvantaged) deep red to decile 10 pale yellow. */
const DECILE_COLOR = ["#7f1d1d", "#b3361f", "#d9623a", "#ee8c4f", "#f6b26b", "#f9cf8f", "#fbe3b4", "#fff0cf", "#fff8e6", "#fffcf2"];
const colorFor = (decile: number) => DECILE_COLOR[Math.min(10, Math.max(1, decile)) - 1]!;

interface Place { postcode: string; suburb: string; lat: number; lng: number; score: number; decileAus: number; decileWA: number; customers: number; act: number; watch: number }

export function AreaMapPage({ client }: { client: Pick<ApiClient, "outlook"> }) {
  const [outlook, setOutlook] = useState<Outlook | null>(null);
  const [scale, setScale] = useState<"wa" | "aus">("wa");
  const [sized, setSized] = useState(true);
  const [focus, setFocus] = useState<"all" | "disadvantaged">("all");
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  useEffect(() => { document.title = "Area map · ERVEI"; }, []);
  useEffect(() => {
    let live = true;
    client.outlook?.().then((o) => { if (live) setOutlook(o); }, () => undefined);
    return () => { live = false; };
  }, [client]);

  const places = useMemo<Place[]>(() => {
    const byPostcode = new Map<string, { suburb: string; customers: number; act: number; watch: number }>();
    if (outlook?.available) for (const c of outlook.customers) {
      if (!c.postcode) continue;
      const p = byPostcode.get(c.postcode) ?? { suburb: c.suburb, customers: 0, act: 0, watch: 0 };
      p.customers++; if (c.tier === "act") p.act++; else if (c.tier === "watch") p.watch++;
      byPostcode.set(c.postcode, p);
    }
    return Object.entries(IRSD).flatMap(([postcode, [score, decileAus, decileWA]]) => {
      const loc = POSTCODE_LOCATION[postcode];
      if (!loc) return [];
      const c = byPostcode.get(postcode);
      return [{ postcode, suburb: c?.suburb ?? "", lat: loc[0], lng: loc[1], score, decileAus, decileWA, customers: c?.customers ?? 0, act: c?.act ?? 0, watch: c?.watch ?? 0 }];
    });
  }, [outlook]);
  const decileOf = (p: Place) => (scale === "wa" ? p.decileWA : p.decileAus);
  const shown = useMemo(() => places.filter((p) => focus === "all" || p.decileWA <= AREA_DECILE_LIMIT), [places, focus]);
  const inMost = places.filter((p) => p.decileWA <= AREA_DECILE_LIMIT);
  const total = places.reduce((n, p) => n + p.customers, 0), inMostCustomers = inMost.reduce((n, p) => n + p.customers, 0);

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = (map.current = L.map(el.current, { scrollWheelZoom: true }).fitBounds(WA_BOUNDS, { padding: [22, 22] }));
    addBaseTiles(m);
    layer.current = L.layerGroup().addTo(m);
    return () => { m.remove(); map.current = null; };
  }, []);
  useEffect(() => {
    const g = layer.current;
    if (!g) return;
    g.clearLayers();
    // Least disadvantaged first, so the most disadvantaged areas draw on top.
    for (const p of [...shown].sort((a, b) => decileOf(b) - decileOf(a))) {
      const radius = sized ? 7 + Math.sqrt(p.customers) * 2.2 : 10;
      const marker = L.circleMarker([p.lat, p.lng], { radius, weight: 1.5, color: "#ffffff", fillColor: colorFor(decileOf(p)), fillOpacity: 0.9 });
      const pop = document.createElement("div");
      const h = document.createElement("strong"); h.textContent = `${p.postcode}${p.suburb ? ` ${p.suburb}` : ""}`;
      const l1 = document.createElement("div"); l1.textContent = `Disadvantage: decile ${p.decileWA} in WA, ${p.decileAus} in Australia (1 is most disadvantaged)`;
      const l2 = document.createElement("div"); l2.textContent = `SEIFA IRSD score ${p.score}`;
      const l3 = document.createElement("div"); l3.textContent = `${p.customers} customers covered · ${p.act} act now · ${p.watch} watch`;
      pop.append(h, l1, l2, l3);
      marker.bindPopup(pop).bindTooltip(`${p.postcode}${p.suburb ? ` ${p.suburb}` : ""} · decile ${decileOf(p)}`);
      marker.addTo(g);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, sized, scale]);

  return (
    <main id="queue" className="outlook area-page" tabIndex={-1}>
      <div className="page-head">
        <div>
          <p className="eyebrow">Area map · socio-economic indicator</p>
          <h1>Where disadvantage and customers overlap</h1>
          <p className="hint">Each circle is a postcode, coloured by the ABS SEIFA 2021 disadvantage index and sized by customers covered by the weather outlook. It describes areas, never people.</p>
        </div>
      </div>
      <section className="panel area-panel" aria-label="Area map">
        <div className="area-controls">
          <label><span className="sub">Colour by</span>
            <select value={scale} onChange={(e) => setScale(e.target.value as "wa" | "aus")}>
              <option value="wa">Disadvantage decile in WA</option>
              <option value="aus">Disadvantage decile in Australia</option>
            </select>
          </label>
          <label><span className="sub">Show</span>
            <select value={focus} onChange={(e) => setFocus(e.target.value as "all" | "disadvantaged")}>
              <option value="all">All postcodes</option>
              <option value="disadvantaged">Most disadvantaged 20% in WA</option>
            </select>
          </label>
          <label className="area-check switch"><input type="checkbox" role="switch" checked={sized} onChange={(e) => setSized(e.target.checked)} /> Size by customers</label>
          <p className="area-stat">{outlook?.available ? <><strong>{inMostCustomers.toLocaleString("en-AU")}</strong> of {total.toLocaleString("en-AU")} covered customers live in the most disadvantaged 20% of WA postcodes</> : "Loading customers…"}</p>
        </div>
        <div className="area-map-wrap">
          <div ref={el} className="area-map" role="region" aria-label="Map of postcodes by disadvantage" />
          <div className="area-legend" aria-label="Legend">
            <span className="sub">More disadvantaged</span>
            <span className="area-ramp">{DECILE_COLOR.map((c, i) => <i key={c} style={{ background: c }} title={`Decile ${i + 1}`} />)}</span>
            <span className="sub">Less disadvantaged</span>
          </div>
        </div>
      </section>
    </main>
  );
}
