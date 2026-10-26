import { useEffect, useRef, useState } from "react";
import type { AiStatus, ApiClient } from "../data/api";
import { ASSISTANT_EVENT } from "./AssistantChat";
import { FLOW_MODES, setFlowMode, useFlowMode } from "../admin/editMode";
import type { StaffUser } from "../domain/types";
import { WeatherSource } from "./DataSourcesPage";

/** The AI model behind the case summaries; anyone can switch it, for everyone, until the server restarts. */
function AiModel({ client }: { client: ApiClient }) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { client.ai?.().then(setStatus, () => setError("Couldn't load the AI setting.")); }, [client]);
  if (!client.ai) return null;
  if (!status) return error ? <p className="muted">{error}</p> : <p className="muted">Loading…</p>;
  const choose = async (model: string) => {
    if (!client.setAi) return;
    setBusy(true); setError(null);
    try { setStatus(await client.setAi(model)); } catch (e) { setError(e instanceof Error ? e.message : "Couldn't change the model."); } finally { setBusy(false); }
  };
  return (
    <>
      <select value={status.on ? status.model ?? "" : ""} disabled={busy} onChange={(e) => void choose(e.target.value)} aria-label="AI model">
        {status.on ? null : <option value="">Off: no API key on the server</option>}
        {status.options.map((o) => <option key={o.model} value={o.model} disabled={!o.available}>{o.label}{o.available ? "" : " (no key)"}</option>)}
      </select>
      <p className="hint">Writes the Suggested plan, the signals summary and the order of solutions. Switching applies to everyone and drafts fresh summaries.</p>
      {error ? <p className="muted" role="alert">{error}</p> : null}
    </>
  );
}

/** The help chat's on/off switch; like the AI model, it is for everyone until the server restarts. */
function AssistantSwitch({ client }: { client: Pick<ApiClient, "assistantStatus" | "setAssistant"> }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { client.assistantStatus?.().then((s) => setOn(s.on), () => setError("Couldn't load the assistant setting.")); }, [client]);
  if (!client.assistantStatus || !client.setAssistant) return null;
  const change = async (next: boolean) => {
    setError(null);
    try {
      const s = await client.setAssistant!(next);
      setOn(s.on);
      window.dispatchEvent(new CustomEvent(ASSISTANT_EVENT, { detail: s.on }));
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't change the assistant."); }
  };
  return (
    <>
      <label className="switch"><input type="checkbox" role="switch" checked={on ?? true} disabled={on === null} onChange={(e) => void change(e.target.checked)} /><span>{on === false ? "Off" : "On"}</span></label>
      {error ? <span className="hint" role="alert">{error}</span> : null}
    </>
  );
}

/** Flowchart mode: Demo (the default), View only or Edit. A per-browser setting. */
function FlowModeSelect() {
  const mode = useFlowMode();
  return (
    <>
      <select value={mode} onChange={(e) => setFlowMode(e.target.value as typeof mode)} aria-label="Flowchart mode">
        {FLOW_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>
      <span className="hint">Demo is a clean view-only presentation. Edit lets you change the flowchart. This browser only.</span>
    </>
  );
}

/** A gear in the top right of the header that opens the demo's settings: who you are, the AI model and the weather. */
export function DemoSettings({ client, users, user, onSwitchUser }: { client: ApiClient; users: StaffUser[]; user: StaffUser; onSwitchUser: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) { setOpen(false); if (e instanceof KeyboardEvent) button.current?.focus(); }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);

  return (
    <div className="demo-settings" ref={ref}>
      <button ref={button} type="button" className="icon-btn settings-btn" aria-expanded={open} aria-controls="demo-settings" aria-label="Demo settings" title="Demo settings" onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6a.5.5 0 0 0 .1-.6l-2-3.5a.5.5 0 0 0-.6-.2l-2.5 1a7.4 7.4 0 0 0-1.7-1l-.4-2.6a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 0-.5.4l-.4 2.7a7.4 7.4 0 0 0-1.7 1l-2.5-1a.5.5 0 0 0-.6.2l-2 3.5a.5.5 0 0 0 .1.6L4.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6a.5.5 0 0 0-.1.6l2 3.5a.5.5 0 0 0 .6.2l2.5-1c.5.4 1.1.7 1.7 1l.4 2.6a.5.5 0 0 0 .5.5h4a.5.5 0 0 0 .5-.4l.4-2.7a7.4 7.4 0 0 0 1.7-1l2.5 1a.5.5 0 0 0 .6-.2l2-3.5a.5.5 0 0 0-.1-.6L19.4 13ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z" /></svg>
      </button>
      {open ? (
        <div id="demo-settings" className="settings-pop" role="dialog" aria-label="Demo settings">
          <h2>Demo settings</h2>
          <label className="field">
            <span>Demo view</span>
            <select value={user.id} onChange={(e) => onSwitchUser(e.target.value)} aria-label="Demo user (not real sign-in)">
              {users.map((u) => <option key={u.id} value={u.id}>{u.displayName} · {u.role === "manager" ? "Manager" : "Support worker"}</option>)}
            </select>
            <span className="hint">Who you are in the demo. Not a real sign-in.</span>
          </label>
          <div className="field">
            <span>AI model</span>
            <AiModel client={client} />
          </div>
          <div className="field">
            <span>Flowchart mode</span>
            <FlowModeSelect />
          </div>
          <div className="field">
            <span>Help assistant</span>
            <AssistantSwitch client={client} />
          </div>
          <div className="field">
            <span>Weather source</span>
            <WeatherSource client={client} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
