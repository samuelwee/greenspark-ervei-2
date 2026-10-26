import { useEffect, useRef } from "react";
import type { FlowDoc } from "@greenspark/shared";

/** How to read the flowchart, in a dialog opened from the link at the bottom of the page. */
export function FlowHowTo({ doc, onClose }: { doc: FlowDoc; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} className="settings" aria-labelledby="howto-title" onClose={onClose} onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}>
      <div className="settings-body">
        <header className="settings-head">
          <h2 id="howto-title">How to read this flowchart</h2>
          <button type="button" className="btn" onClick={() => ref.current?.close()}>Close</button>
        </header>
        <p>{doc.meta.how_it_works}</p>
        <p className="hint">Select any box to trace its path and see its details.</p>
        <h3>When a circumstance is flagged</h3>
        <dl className="facts">
          <dt>Flag when</dt><dd>{doc.meta.scoring.flag_when}</dd>
          <dt>Strong</dt><dd>{doc.meta.scoring.strong}</dd>
          <dt>Supporting</dt><dd>{doc.meta.scoring.supporting}</dd>
          <dt>Sensitive</dt><dd>{doc.meta.scoring.sensitive_rule}</dd>
          <dt>Safety</dt><dd>{doc.meta.scoring.safety_rule}</dd>
        </dl>
        <details>
          <summary>Guardrails ({doc.meta.guardrails.length})</summary>
          <ul className="rest-list">{doc.meta.guardrails.map((g, i) => <li key={i}>{g}</li>)}</ul>
        </details>
      </div>
    </dialog>
  );
}
