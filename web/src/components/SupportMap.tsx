import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { SUPPORT_GROUPS, SUPPORT_GROUP_COLORS, SUPPORT_URGENCY, supportMarkerRadius, type SupportGroupId } from "@greenspark/shared";
import { alertPopup, triangle } from "./OutlookMap";
import type { EmergencyAlert, OutlookTown } from "../data/api";
import { alertColor, hazardColor } from "./outlookText";
import { regionalSupportAreas, type MapRegion, type SupportArea } from "../domain/supportGroups";
import { forecastTemperatures } from "../domain/forecastHeat";
import { temperatureLayer } from "./temperatureLayer";

const REGION_BOUNDS: Record<MapRegion, L.LatLngBoundsExpression> = {
  perth: [[-32.28, 115.6], [-31.68, 116.2]],
  southwest: [[-35.1, 114.9], [-31.5, 118.5]],
  wa: [[-35.3, 112], [-14, 129]],
};

/** Count markers and weather coverage deliberately use different visual encodings. */
export function SupportMap({ areas, towns, activeGroups, alerts, showHeat, showAlerts, chosen, onChoose, region, date, demo }: {
  areas: SupportArea[]; towns: OutlookTown[]; activeGroups: SupportGroupId[]; alerts: EmergencyAlert[];
  showHeat: boolean; showAlerts: boolean; chosen: string | null; onChoose: (id: string | null) => void;
  region: MapRegion; date: string; demo: boolean;
}) {
  const el = useRef<HTMLDivElement>(null), wrap = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markers = useRef<L.LayerGroup | null>(null), heat = useRef<L.LayerGroup | null>(null), emergency = useRef<L.LayerGroup | null>(null);
  const choose = useRef(onChoose);
  choose.current = onChoose;
  const [full, setFull] = useState(false);
  const [zoom, setZoom] = useState(9);
  const temperatures = useMemo(() => forecastTemperatures(towns, date), [towns, date]);
  const legendColors = SUPPORT_GROUP_COLORS[activeGroups[0] ?? "health"];

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { scrollWheelZoom: false, zoomSnap: 0.5 });
    map.current = m;
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", {
      maxNativeZoom: 18, maxZoom: 18,
      attribution: "Tiles &copy; Esri, HERE, Garmin, USGS, Intermap, INCREMENT P, NRCan, Esri Japan, METI, Esri China (Hong Kong), Esri Korea, Esri (Thailand), NGCC, &copy; OpenStreetMap contributors, GIS User Community",
    }).addTo(m);
    m.createPane("heat-coverage").style.zIndex = "350";
    m.getPane("heat-coverage")!.style.pointerEvents = "none";
    m.createPane("heat-labels").style.zIndex = "450";
    m.getPane("heat-labels")!.style.pointerEvents = "none";
    m.createPane("alerts").style.zIndex = "390";
    m.on("zoomend", () => setZoom(m.getZoom()));
    markers.current = L.layerGroup().addTo(m);
    heat.current = L.layerGroup().addTo(m);
    emergency.current = L.layerGroup().addTo(m);
    const observer = new ResizeObserver(() => m.invalidateSize());
    observer.observe(el.current);
    const onFull = () => { setFull(document.fullscreenElement === wrap.current); m.invalidateSize(); };
    document.addEventListener("fullscreenchange", onFull);
    return () => { observer.disconnect(); document.removeEventListener("fullscreenchange", onFull); m.remove(); map.current = null; };
  }, []);

  useEffect(() => { map.current?.fitBounds(REGION_BOUNDS[region], { padding: [22, 22] }); }, [region]);
  useEffect(() => {
    const area = areas.find((item) => item.id === chosen), m = map.current;
    if (area && m && m.getZoom() < 8.5) m.setView([area.lat, area.lng], 10);
    else if (area && m && !m.getBounds().contains([area.lat, area.lng])) m.panTo([area.lat, area.lng]);
  }, [chosen, areas]);
  useEffect(() => {
    const layer = markers.current;
    if (!layer) return;
    layer.clearLayers();
    // Small markers are added last so larger nearby circles cannot swallow them.
    const renderedAreas = regionalSupportAreas(areas, zoom);
    const multipleGroups = new Set(renderedAreas.map((item) => item.group)).size > 1;
    for (const area of renderedAreas.sort((a, b) => b.count - a.count)) {
      const group = area.group ?? "health", palette = SUPPORT_GROUP_COLORS[group], radius = supportMarkerRadius(area.count), diameter = radius * 2;
      const definition = SUPPORT_GROUPS.find((item) => item.id === group)!;
      const count = area.count.toLocaleString("en-AU");
      const title = area.parts.length > 1 ? `${definition.label}: ${count} customers across ${area.parts.length} postcode areas; zoom in to separate them`
        : `${area.suburb}, postcode ${area.postcode}, ${definition.label}: ${count} customers; ${area.act} act now, ${area.watch} review soon, ${area.monitor} monitor`;
      let position = L.latLng(area.lat, area.lng);
      if (multipleGroups && (area.parts.length > 1 || renderedAreas.some((other) => other.postcode === area.postcode && other.group !== area.group))) {
        const offsets = { health: [-13, -13], supply: [13, -13], bills: [-18, 6], concessions: [18, 6], coaching: [-10, 22], monitor: [10, 22] } as const;
        const offset = offsets[group], pixel = map.current!.latLngToLayerPoint(position).add(L.point(offset[0], offset[1]));
        position = map.current!.layerPointToLatLng(pixel);
      }
      const marker = L.marker(position, { keyboard: true, title, alt: title, icon: L.divIcon({
        className: `support-marker${chosen === area.id ? " is-selected" : ""}${area.parts.length > 1 ? " is-regional" : ""}`,
        iconSize: [diameter, diameter], iconAnchor: [radius, radius],
        html: `<span style="--bubble-color:${palette[area.urgency]};width:${diameter}px;height:${diameter}px"><b>${count}</b></span>`,
      }) }).addTo(layer);
      marker.bindTooltip(title);
      const select = () => {
        if (area.parts.length > 1) map.current?.fitBounds(area.parts.map((part) => [part.lat, part.lng] as L.LatLngTuple), { padding: [65, 65], maxZoom: 11 });
        else choose.current(chosen === area.id ? null : area.id);
      };
      marker.on("click", select);
      const element = marker.getElement();
      if (element) {
        element.setAttribute("role", "button");
        element.setAttribute("aria-label", title);
        element.setAttribute("aria-pressed", String(chosen === area.id));
        element.setAttribute("data-group", group);
        element.addEventListener("keydown", (event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); event.stopPropagation(); select(); } });
      }
    }
  }, [areas, chosen, zoom]);

  useEffect(() => {
    const layer = heat.current, m = map.current;
    if (!layer || !m) return;
    layer.clearLayers();
    if (!showHeat) return;
    temperatureLayer(temperatures).addTo(layer);
    const labels = L.layerGroup().addTo(layer);
    const renderLabels = () => {
      labels.clearLayers();
      const positions: L.Point[] = [], bounds = m.getBounds(), size = m.getSize();
      for (const point of temperatures) {
        if (!bounds.contains([point.lat, point.lng])) continue;
        const at = m.latLngToContainerPoint([point.lat, point.lng]);
        if (at.x < 32 || at.x > size.x - 105 || at.y < 85 || at.y > size.y - 70 || positions.some((other) => Math.abs(other.x - at.x) < 105 && Math.abs(other.y - at.y) < 50)) continue;
        positions.push(at);
        const content = document.createElement("span"), name = document.createElement("small"), value = document.createElement("strong");
        name.textContent = point.name; value.textContent = `${point.max}°C`;
        const town = towns.find((t) => t.id === point.id);
        const severity = Math.max(0, ...(town?.hazards ?? []).filter((h) => !date || h.date === date || h.kind === "warning").map((h) => h.severity));
        const category = severity >= 4 ? "Severe" : severity >= 3 ? "Dangerous" : severity >= 1 ? "Hot day" : "No forecast hazard";
        const dot = document.createElement("i"); dot.className = "town-hazard-dot"; dot.style.background = hazardColor(severity);
        content.title = `${point.name}: ${point.max}°C · ${category} (app forecast hazard category)`;
        content.setAttribute("aria-label", content.title);
        content.append(dot, name, value);
        L.marker([point.lat, point.lng], { pane: "heat-labels", interactive: false, keyboard: false, icon: L.divIcon({
          className: "forecast-temperature-label", iconSize: [88, 35], iconAnchor: [-18, 28], html: content,
        }) }).addTo(labels);
      }
    };
    renderLabels();
    m.on("moveend zoomend resize", renderLabels);
    return () => { m.off("moveend zoomend resize", renderLabels); };
  }, [temperatures, showHeat, towns, date]);

  useEffect(() => {
    const layer = emergency.current;
    if (!layer) return;
    layer.clearLayers();
    if (!showAlerts) return;
    for (const alert of alerts) {
      const color = alertColor(alert.alertLevel);
      for (const polygon of alert.polygons) L.polygon(polygon, { pane: "alerts", color, weight: 2, fillColor: color, fillOpacity: 0.18 }).bindPopup(() => alertPopup(alert)).addTo(layer);
      if (alert.centre) L.marker(alert.centre, { pane: "alerts", icon: triangle(color), keyboard: true, title: alert.headline || alert.alertLevel }).bindPopup(() => alertPopup(alert)).addTo(layer);
    }
  }, [alerts, showAlerts]);

  const toggleFull = () => {
    if (document.fullscreenEnabled && wrap.current?.requestFullscreen) {
      if (document.fullscreenElement) void document.exitFullscreen(); else void wrap.current.requestFullscreen();
    } else { setFull((current) => !current); requestAnimationFrame(() => map.current?.invalidateSize()); }
  };
  useEffect(() => {
    if (!full || document.fullscreenElement) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setFull(false); };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [full]);

  return <div ref={wrap} className={`outlook-map-wrap support-map-wrap${full ? " is-full" : ""}`}>
    <div className="support-map-stage">
      <div ref={el} className="outlook-map support-map" role="region" aria-label="Customer support groups and estimated forecast temperatures" />
      <div className="support-map-caption">{showHeat ? demo ? "Illustrative temperature forecast" : "Town forecast temperature estimate" : "Customer support groups"}<span>{showHeat ? `${date ? `Daily maximum · ${date}` : "Peak daily maximum · next 7 days"} · °C` : "Approximate postcode locations"}</span></div>
      <div className="support-map-key" aria-label="Map legend">
        <strong>Support groups</strong>
        <div className="support-group-key">{SUPPORT_GROUPS.filter((item) => activeGroups.includes(item.id)).map((item) => <span key={item.id}><i style={{ background: SUPPORT_GROUP_COLORS[item.id].strong }} />{item.letter} {item.label}</span>)}</div>
        <div className="support-urgency-key">{Object.entries(SUPPORT_URGENCY).map(([id, item]) => <span key={id}><i style={{ background: legendColors[id as keyof typeof SUPPORT_URGENCY] }} />{item.label}</span>)}</div>
        <span className="support-size-key"><i style={{ background: legendColors.strong }} /><i style={{ background: legendColors.strong }} /><i style={{ background: legendColors.strong }} /> Size = count · darker = more attention</span>
        {zoom < 8.5 ? <span>Regional totals · select a circle to zoom in</span> : null}
        {showHeat ? <><strong>{date ? "Daily maximum temperature" : "Peak daily maximum this week"}</strong><div className="support-temperature-scale"><i /><span><b>28°</b><b>32°</b><b>36°</b><b>40°</b><b>44°+</b></span></div><span>{temperatures.length ? "Estimated between town forecasts" : "No temperature forecast for this period"}</span></> : null}
      </div>
    </div>
    <div className="map-zoom outlook-zoom">
      <span className="sub">{demo ? "Fictional sample values" : "BoM town forecast values"} · shading estimated · approximate postcode groups</span>
      <button type="button" className="link-btn" onClick={() => map.current?.fitBounds(REGION_BOUNDS[region], { padding: [22, 22] })}>Reset map</button>
      {region === "perth" ? <button type="button" className="link-btn" onClick={() => map.current?.setView([-32.53, 115.77], 11)}>Mandurah</button> : null}
      <button type="button" className="btn btn-small map-full" aria-pressed={full} onClick={toggleFull}>{full ? "Exit full screen" : "Full screen"}</button>
    </div>
  </div>;
}
