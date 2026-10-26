// A small help chat in the corner of every page: visitors ask how ERVEI works. It answers from a written description
// of the tool on the server and never sees any customer's details.
import { useEffect, useRef, useState } from "react";
import type { ApiClient } from "../data/api";

interface Turn { role: "user" | "assistant"; content: string }
const SUGGESTIONS = ["What does Contact by mean?", "How is Chance of hardship worked out?", "What is the difference between priority and the outlook?", "Is this real customer data?"];
const MAX = 600;

export function AssistantChat({ client }: { client: Pick<ApiClient, "ask"> }) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [turns, busy, open]);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!client.ask) return null;
  const send = async (question: string) => {
    const q = question.trim().slice(0, MAX);
    if (!q || busy) return;
    const next = [...turns, { role: "user" as const, content: q }];
    setTurns(next); setText(""); setError(null); setBusy(true);
    try {
      const r = await client.ask!(next.slice(-12));
      setTurns([...next, { role: "assistant", content: r.answer }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't get an answer. Try again.");
    } finally { setBusy(false); }
  };

  return (
    <div className="assistant">
      {open ? (
        <section className="assistant-panel" role="dialog" aria-label="Ask how ERVEI works">
          <header>
            <strong>Ask how ERVEI works</strong>
            <button type="button" className="assistant-close" aria-label="Close the assistant" onClick={() => setOpen(false)}>✕</button>
          </header>
          <div className="assistant-log" ref={log} aria-live="polite">
            {turns.length === 0 ? (
              <div className="assistant-intro">
                <p>Ask about the outlook, Contact by, priority or the models. I explain how the tool works and can't see any customer's details. Everything here is synthetic demo data.</p>
                <div className="assistant-suggest">{SUGGESTIONS.map((s) => <button key={s} type="button" onClick={() => void send(s)}>{s}</button>)}</div>
              </div>
            ) : turns.map((t, i) => <p key={i} className={`assistant-turn is-${t.role}`}>{t.content}</p>)}
            {busy ? <p className="assistant-turn is-assistant is-busy" role="status">Thinking…</p> : null}
            {error ? <p className="assistant-error" role="alert">{error}</p> : null}
          </div>
          <form className="assistant-form" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
            <textarea ref={input} value={text} rows={2} maxLength={MAX} placeholder="Ask a question" aria-label="Your question"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(text); } }} />
            <button type="submit" className="btn btn-small" disabled={busy || !text.trim()}>Send</button>
          </form>
        </section>
      ) : null}
      <button type="button" className="assistant-launch" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? "Close" : "Ask a question"}
      </button>
    </div>
  );
}
