import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { addBaseTiles } from "./mapTiles";
import type { EmergencyAlert, ForecastTown } from "../data/api";
import { forecastTemperatures } from "../domain/forecastHeat";
import { alertPopup, triangle } from "./OutlookMap";
import { alertColor, dayName, tempColor } from "./outlookText";
import { temperatureLayer } from "./temperatureLayer";

/** The customer's suburb and the Emergency WA warnings near it, under the week's forecast shaded across the state: pick a day to see that day's temperatures. Fits the suburb and the warnings, or zooms in on the suburb. */
export function CaseWeatherMap({ location, label, alerts, days, towns }: {
  location: [number, number]; label: string; alerts: EmergencyAlert[];
  days: { date: string; max: number | null; precis: string }[]; towns: ForecastTown[];
}) {
  const el = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<L.Map | null>(null);
  const [hint, setHint] = useState(false);
  // The day shown starts on the customer's hottest day.
  const hottest = useMemo(() => days.reduce<string | null>((best, d) => (d.max !== null && (best === null || d.max > (days.find((x) => x.date === best)?.max ?? -Infinity)) ? d.date : best), null) ?? days[0]?.date ?? "", [days]);
  const [date, setDate] = useState(hottest);
  useEffect(() => setDate(hottest), [hottest]);

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { scrollWheelZoom: false });
    addBaseTiles(m);
    m.createPane("heat-coverage").style.zIndex = "350";
    m.getPane("heat-coverage")!.style.pointerEvents = "none";
    const points: [number, number][] = [location];
    for (const a of alerts) {
      const color = alertColor(a.alertLevel);
      for (const p of a.polygons) { L.polygon(p, { color, weight: 2, fillColor: color, fillOpacity: 0.25 }).bindPopup(() => alertPopup(a)).addTo(m); points.push(...p); }
      if (a.centre) { L.marker(a.centre, { icon: triangle(color), title: a.headline || a.alertLevel }).bindPopup(() => alertPopup(a)).addTo(m); points.push(a.centre); }
    }
    // The suburb's centre, not the customer's address: the dataset has no coordinates.
    L.circleMarker(location, { radius: 9, color: "#fff", weight: 2, fillColor: "#00875a", fillOpacity: 1 }).bindTooltip(label).addTo(m);
    if (points.length > 1) m.fitBounds(L.latLngBounds(points), { padding: [24, 24], maxZoom: 10 });
    else m.setView(location, 10);
    setMap(m);
    // Ctrl (or ⌘) + scroll zooms, so scrolling down the case page never gets caught by the map. A trackpad pinch
    // arrives as Ctrl + scroll too. A plain scroll shows a hint and scrolls the page as usual.
    let timer = 0;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) {
        setHint(true);
        window.clearTimeout(timer);
        timer = window.setTimeout(() => setHint(false), 1500);
        return;
      }
      e.preventDefault();
      setHint(false);
      const step = Math.max(-1, Math.min(1, -e.deltaY / 60));
      m.setZoomAround(m.mouseEventToContainerPoint(e as unknown as MouseEvent), m.getZoom() + step, { animate: false });
    };
    const box = el.current;
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => { box.removeEventListener("wheel", onWheel); window.clearTimeout(timer); m.remove(); setMap(null); };
  }, [location, label, alerts]);

  // The shaded temperatures for the chosen day, drawn under the warnings and the suburb.
  useEffect(() => {
    if (!map || !towns.length) return;
    const layer = temperatureLayer(forecastTemperatures(towns, date)).addTo(map);
    return () => { layer.remove(); };
  }, [map, towns, date]);

  const key = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
  return (
    <div className="case-wx-map-wrap">
      <div ref={el} className="case-wx-map" role="region" aria-label={`Map of ${label} and nearby Emergency WA warnings, shaded by forecast temperature`} />
      {days.length ? (
        <ol className="case-wx-map-days" aria-label="Choose a day to shade the map by its forecast maximum">
          {days.map((d) => (
            <li key={d.date}>
              <button type="button" aria-pressed={d.date === date} title={d.precis} onClick={() => setDate(d.date)}>
                <span>{dayName(d.date)}</span><strong style={tempColor(d.max)}>{d.max ?? "–"}°</strong>
              </button>
            </li>
          ))}
        </ol>
      ) : null}
      <div className={`map-wheel-hint${hint ? " is-on" : ""}`} aria-hidden="true">Use {key} + scroll to zoom the map</div>
    </div>
  );
}
