import { useEffect, useRef, useState, type ReactNode } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { addBaseTiles } from "./mapTiles";
import type { EmergencyAlert, OutlookTown } from "../data/api";
import { HAZARD_ICON, HAZARD_LABEL, alertColor, dayDate, dayName, hazardColor, tempColor } from "./outlookText";

/** All of Western Australia, fitted to whatever size the map is. */
const WA_BOUNDS: L.LatLngBoundsExpression = [[-35.2, 112.9], [-13.7, 129.1]];

/** A popup's content, built as elements so the feed's text is never read as HTML. */
export function alertPopup(a: EmergencyAlert): HTMLElement {
  const box = document.createElement("div");
  box.className = "alert-pop";
  const add = (tag: string, text: string, cls?: string) => { const el = document.createElement(tag); el.textContent = text; if (cls) el.className = cls; box.append(el); return el; };
  add("strong", a.headline || a.alertLevel);
  add("span", a.alertLevel, "sub");
  if (a.areaDesc) add("p", a.areaDesc.length > 240 ? `${a.areaDesc.slice(0, 240)}…` : a.areaDesc);
  if (a.web) { const link = add("a", "Details on Emergency WA") as HTMLAnchorElement; link.href = a.web; link.target = "_blank"; link.rel = "noreferrer"; }
  return box;
}

/** A warning triangle in the warning's colour, so warnings never look like the round forecast towns. */
export function triangle(color: string): L.DivIcon {
  return L.divIcon({
    className: "alert-tri", iconSize: [22, 20], iconAnchor: [11, 13], popupAnchor: [0, -12],
    html: `<svg viewBox="0 0 22 20" width="22" height="20" aria-hidden="true"><path d="M11 1.5 L20.5 18.5 H1.5 Z" fill="${color}" stroke="#253858" stroke-width="1.5" stroke-linejoin="round"/><path d="M11 7v5" stroke="#253858" stroke-width="2" stroke-linecap="round"/><circle cx="11" cy="15" r="1.1" fill="#253858"/></svg>`,
  });
}

/**
 * The outlook map of WA, with two layers that can be switched on and off: the forecast towns, coloured by the worst
 * weather coming and sized by the customers to contact; and Emergency WA's current warnings, drawn as their areas.
 */
export function OutlookMap({ towns, alerts, showTowns, showAlerts, chosen, onChoose, controls }: {
  towns: OutlookTown[]; alerts: EmergencyAlert[]; showTowns: boolean; showAlerts: boolean; chosen: string | null; onChoose: (id: string | null) => void;
  /** Shown in the row under the map, before the zoom links: the layer switches. */
  controls?: ReactNode;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const townLayer = useRef<L.LayerGroup | null>(null);
  const alertLayer = useRef<L.LayerGroup | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  const choose = useRef(onChoose);
  choose.current = onChoose;

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = (map.current = L.map(el.current, { scrollWheelZoom: true }).fitBounds(WA_BOUNDS, { padding: [22, 22] }));
    addBaseTiles(m);
    // Warning areas sit under the town circles, so the towns stay clickable.
    m.createPane("alerts").style.zIndex = "390";
    townLayer.current = L.layerGroup();
    alertLayer.current = L.layerGroup();
    // Leaflet needs to measure again when the map goes in or out of full screen.
    const onFull = () => { setFull(document.fullscreenElement === wrap.current); m.invalidateSize(); };
    document.addEventListener("fullscreenchange", onFull);
    return () => { document.removeEventListener("fullscreenchange", onFull); m.remove(); map.current = null; };
  }, []);
  // Browsers without the Fullscreen API for elements (Safari on iPhone) get the map filling the window instead.
  const picked = chosen ? towns.find((t) => t.id === chosen) ?? null : null;
  // The panel takes room from the map, so Leaflet measures again when it opens or closes.
  useEffect(() => { requestAnimationFrame(() => map.current?.invalidateSize()); }, [full, !!picked]);
  const toggleFull = () => {
    if (document.fullscreenEnabled && wrap.current?.requestFullscreen) {
      if (document.fullscreenElement) void document.exitFullscreen(); else void wrap.current.requestFullscreen();
    } else {
      setFull((f) => !f);
      requestAnimationFrame(() => map.current?.invalidateSize());
    }
  };
  useEffect(() => {
    if (!full || document.fullscreenElement) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setFull(false); requestAnimationFrame(() => map.current?.invalidateSize()); } };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [full]);

  useEffect(() => {
    const g = townLayer.current;
    if (!g) return;
    g.clearLayers();
    const max = Math.max(1, ...towns.map((t) => t.act + t.watch));
    for (const t of towns) {
      const worst = Math.max(0, ...t.hazards.map((h) => h.severity));
      const peak = Math.max(...t.days.map((d) => d.max ?? -99));
      const c = L.circleMarker([t.lat, t.lng], {
        radius: 6 + 20 * Math.sqrt((t.act + t.watch) / max), color: t.id === chosen ? "#253858" : "#fff", weight: t.id === chosen ? 3 : 1.5,
        fillColor: hazardColor(worst), fillOpacity: 0.85,
      }).addTo(g);
      c.bindTooltip(`${t.name}: peak ${peak > -99 ? `${peak}°C` : "n/a"} · ${t.act} act now, ${t.watch} watch`);
      c.on("click", () => choose.current(t.id === chosen ? null : t.id));
    }
  }, [towns, chosen]);

  useEffect(() => {
    const g = alertLayer.current;
    if (!g) return;
    g.clearLayers();
    for (const a of alerts) {
      const color = alertColor(a.alertLevel);
      for (const p of a.polygons) L.polygon(p, { pane: "alerts", color, weight: 2, fillColor: color, fillOpacity: 0.25 }).bindPopup(() => alertPopup(a)).addTo(g);
      // A dot at the centre too, as small areas vanish when zoomed out.
      if (a.centre) {
        L.marker(a.centre, { pane: "alerts", icon: triangle(color), keyboard: true, title: a.headline || a.alertLevel })
          .bindPopup(() => alertPopup(a)).addTo(g);
      }
    }
  }, [alerts]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    for (const [layer, on] of [[townLayer.current, showTowns], [alertLayer.current, showAlerts]] as const) {
      if (!layer) continue;
      if (on && !m.hasLayer(layer)) layer.addTo(m);
      if (!on && m.hasLayer(layer)) layer.remove();
    }
  }, [showTowns, showAlerts]);

  return (
    <div ref={wrap} className={`outlook-map-wrap${full ? " is-full" : ""}`}>
      <div ref={el} className="outlook-map" role="region" aria-label="Map of forecast towns and Emergency WA warnings" />
      {full && picked ? (
        <section className="map-town-panel" aria-label={`${picked.name} forecast`}>
          <div className="mtp-head">
            <div>
              <h2>{picked.name}</h2>
              <p className="sub">{picked.districtName}</p>
              {picked.hazards.length ? (
                <ul className="mtp-hazards">{[...new Set(picked.hazards.map((h) => h.kind))].map((k) => <li key={k}><span aria-hidden="true">{HAZARD_ICON[k]}</span>{HAZARD_LABEL[k]}</li>)}</ul>
              ) : <p className="sub">No hot or dangerous weather this week</p>}
            </div>
            <div className="mtp-counts"><span className="mtp-act"><strong>{picked.act}</strong>Act now</span><span className="mtp-watch"><strong>{picked.watch}</strong>Watch</span></div>
            <button type="button" className="icon-btn" aria-label="Close town forecast" onClick={() => choose.current(null)}>✕</button>
          </div>
          <ol className="mtp-days">
            {picked.days.slice(0, 7).map((d) => (
              <li key={d.date} style={tempColor(d.max)} title={d.precis}>
                <span className="mtp-day">{dayName(d.date)} {dayDate(d.date)}</span>
                <strong>{d.max ?? "–"}°</strong>
                <span className="mtp-min">{d.min ?? "–"}°</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      <div className="map-zoom outlook-zoom">
        {controls}
        <button type="button" className="link-btn" onClick={() => map.current?.setView([-31.95, 115.86], 9)}>Perth</button>
        <button type="button" className="link-btn" onClick={() => map.current?.setView([-33.2, 116.2], 7)}>South West</button>
        <button type="button" className="link-btn" onClick={() => map.current?.fitBounds(WA_BOUNDS, { padding: [22, 22] })}>All of WA</button>
        <button type="button" className="btn btn-small map-full" aria-pressed={full} onClick={toggleFull}>{full ? "✕ Exit full screen" : "⛶ Full screen"}</button>
      </div>
    </div>
  );
}
