import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { addBaseTiles } from "./mapTiles";
import type { EmergencyAlert } from "../data/api";
import { alertPopup, triangle } from "./OutlookMap";
import { alertColor, dayName, tempColor } from "./outlookText";

/** The customer's suburb and the Emergency WA warnings near it. Fits the suburb and the warnings, or zooms in on the suburb. */
export function CaseWeatherMap({ location, label, alerts, days }: { location: [number, number]; label: string; alerts: EmergencyAlert[]; days: { date: string; max: number | null; precis: string }[] }) {
  const el = useRef<HTMLDivElement>(null);
  const [hint, setHint] = useState(false);
  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { scrollWheelZoom: false });
    addBaseTiles(m);
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
    return () => { box.removeEventListener("wheel", onWheel); window.clearTimeout(timer); m.remove(); };
  }, [location, label, alerts]);
  const key = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
  return (
    <div className="case-wx-map-wrap">
      <div ref={el} className="case-wx-map" role="region" aria-label={`Map of ${label} and nearby Emergency WA warnings`} />
      {days.length ? (
        <ol className="case-wx-map-days" aria-label="Forecast maximum for the next days">
          {days.map((d) => <li key={d.date} title={d.precis}><span>{dayName(d.date)}</span><strong style={tempColor(d.max)}>{d.max ?? "–"}°</strong></li>)}
        </ol>
      ) : null}
      <div className={`map-wheel-hint${hint ? " is-on" : ""}`} aria-hidden="true">Use {key} + scroll to zoom the map</div>
    </div>
  );
}
