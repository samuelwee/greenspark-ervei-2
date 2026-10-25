import type { EmergencyFeed } from "../data/api";
import { ALERT_LEVELS, hazardColor } from "./outlookText";

export function SupportWeatherKey({ feed, enabled }: { feed: EmergencyFeed | null; enabled: boolean }) {
  return <div className="support-weather-key" aria-label="Weather and emergency legend">
    <div><strong>Emergency WA · current warnings</strong><div className="weather-key-items">{ALERT_LEVELS.slice(0, 3).map(([label, color]) => <span key={label}><svg width="15" height="15" viewBox="0 0 22 22" aria-hidden="true"><path d="M11 2 21 20H1Z" fill={color} stroke="#253858" /><path d="M11 7v6m0 3v1" stroke="#172b4d" strokeWidth="2" /></svg>{label}</span>)}</div><small>{!feed ? "Checking warning feed…" : !feed.available ? "Feed unavailable · no current warning data" : `${enabled ? "Layer on" : "Layer off"} · ${feed.error ? "Refresh failed; last available data" : "Updated"}${feed.fetchedAt ? ` ${new Date(feed.fetchedAt).toLocaleString("en-AU", { timeZone: "Australia/Perth", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` : " · update time unavailable"}`}</small></div>
    <div><strong>Town forecast hazard · app categories</strong><div className="weather-key-items">{[[4, "Severe"], [3, "Dangerous"], [1, "Hot day"], [0, "No forecast hazard"]].map(([severity, label]) => <span key={label}><i style={{ background: hazardColor(Number(severity)) }} />{label}</span>)}</div><small>Uses forecast heat, fire danger and Bureau warnings; separate from customer urgency.</small></div>
  </div>;
}
