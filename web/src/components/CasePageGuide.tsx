import { useEffect } from "react";

interface Question { q: string; answer: string; look: string }

/** The questions a representative brings to a case, and what the page tells them. */
const QUESTIONS: Question[] = [
  {
    q: "How urgent is this?",
    answer: "A priority score out of 100 and when to make contact (Today, This week, Soon or Monitor), worked out from what the case shows. A rising trend means something is getting worse: arrears growing, usage dropping, prepay credit running low or a disconnection warning. The line underneath names the circumstances that added the most.",
    look: "Contact by; Priority and chance of hardship",
  },
  {
    q: "What is going on with the account?",
    answer: "Warning signs found in the account, each with its evidence and dates, and an AI summary of what they show together. Whether power is on, warnings and disconnections, how bills and payments have gone, and whether usage has dropped compared with last year, which can mean the customer is going without.",
    look: "The account; Account signals, Bills, Collections and supply",
  },
  {
    q: "Why do we think they need help?",
    answer: "Each circumstance flagged for this customer, such as a lost job or choosing between bills and food, with the signals behind it. A strong signal is good evidence on its own; supporting signals need another. Handling notes say how to raise sensitive topics.",
    look: "What's going on; Support areas and why",
  },
  {
    q: "What has the customer told us?",
    answer: "Every call, message and complaint, with the outcome, how the customer seemed, the words they used and the full transcript. Survey answers about their situation, and help they said they've had in the past year.",
    look: "Contact history; Support areas and why (Assistance already reported)",
  },
  {
    q: "What help have they already had?",
    answer: "Hardship programs (current and past, and why they ended), payment plans and whether they were kept, bill extensions, HUGS grants, and other help offered and whether it was accepted.",
    look: "Support history; Customer and account",
  },
  {
    q: "What can I offer, and when?",
    answer: "Every program, grant and referral that fits the flagged circumstances: what to do, who provides it, how to contact them and what to know about eligibility. The AI order ranks them for this customer, with a reason, a date to act by and how to get in touch.",
    look: "What to do first; Solutions to offer",
  },
  {
    q: "How should I contact them?",
    answer: "Their preferred channel, whether SMS and email are switched on, do not call, consent to proactive support contact, an interpreter, and anyone with authority to act for them.",
    look: "Customer and account (Customer details, Contact settings)",
  },
];

export function CasePageGuide() {
  useEffect(() => { document.title = "Case page · ERVEI"; }, []);
  return (
    <main id="queue" className="bts-page" tabIndex={-1}>
      <header className="bts-head">
        <p className="eyebrow">BTS · Case page</p>
        <h1>Case page</h1>
        <p className="sub">
          Each customer has one case, at <code>/accounts/:accountNumber</code>. The page opens on a summary of the case at a glance:
          how urgent it is, the chance of harm, the account, what's going on, what to do first and electricity use. The full detail
          sits in sections that open as modals, from a link on each card or the "More about this case" tiles. This page explains how a
          representative uses it and what happens behind it.
        </p>
      </header>

      <section className="case-card" aria-labelledby="cp-info">
        <h2 id="cp-info">What the page tells you</h2>
        <p className="hint">The page answers the questions you'd ask before getting in touch with a customer who may be struggling. "Where" names the summary card first, then the section to open for the detail.</p>
        <div className="table-scroll">
          <table className="mini-table ds-table">
            <thead><tr><th scope="col">Your question</th><th scope="col">What the page tells you</th><th scope="col">Where</th></tr></thead>
            <tbody>
              {QUESTIONS.map((x) => <tr key={x.q}><th scope="row">{x.q}</th><td>{x.answer}</td><td className="muted">{x.look}</td></tr>)}
            </tbody>
          </table>
        </div>
      </section>

      <section className="case-card" aria-labelledby="cp-three">
        <h2 id="cp-three">Outlook, chance of hardship and priority</h2>
        <p className="hint">Three different measures, each answering its own question. In one line: the outlook is the next 7 days, chance of hardship is the next 90 days, and priority is today.</p>
        <div className="table-scroll">
          <table className="mini-table ds-table">
            <thead><tr><th scope="col">Measure</th><th scope="col">The question</th><th scope="col">How it's worked out</th><th scope="col">Changes when</th></tr></thead>
            <tbody>
              <tr><th scope="row">Outlook (Act now, Watch)</th><td>Could this week's weather hurt them?</td><td>The Bureau's forecast for their area, combined with what makes them vulnerable, such as life support or a supply that could be cut off.</td><td>The forecast changes (hourly with live data)</td></tr>
              <tr><th scope="row">Chance of hardship (Low to Very high)</th><td>How likely is something bad to happen to their account in the next 90 days: being disconnected, debt passing $1,000, or a payment plan breaking?</td><td>A statistical model trained on account history. It ignores the weather.</td><td>The model is retrained</td></tr>
              <tr><th scope="row">Priority (Routine to Urgent, out of 100)</th><td>How serious is their situation right now?</td><td>Points for each problem the flowchart finds, such as job loss, growing debt or illness, and the evidence behind each. Weather can add to it.</td><td>The case, its signals or the forecast change</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="case-card bts-facts" aria-labelledby="cp-before">
        <h2 id="cp-before">Before you get in touch</h2>
        <ul className="plain history">
          <li><strong>Pick the case.</strong> The Classic outlook (the home page) lists customers this week's forecast could hurt, act now first. The case queue puts the most urgent first: search by name, account number or suburb, or filter by priority, support need or status. Cases with a follow-up date show when it's due or overdue.</li>
          <li><strong>Get the picture in a minute.</strong> The summary cards say how urgent it is, what seems to be going on and what to do first, with the AI's plan and the top three solutions.</li>
          <li><strong>Check the evidence.</strong> Don't take the plan on trust. Look at the signals behind each circumstance: what was seen, when, and whether it is strong or supporting. Older evidence may no longer be true.</li>
          <li><strong>Check what's been tried.</strong> Support history shows a plan that broke or a program the customer left, which changes what to offer and how. Contact history shows what was said last time and whether anything was promised.</li>
          <li><strong>Decide what to offer and when.</strong> Use the AI order as a starting point, and the dates and contact methods as a guide. Check each solution's eligibility notes. Anything about being without power, or a safety risk, comes first.</li>
          <li><strong>Plan how to contact them.</strong> Use the channel they prefer unless it's urgent. Respect do not call and opted-out channels, book an interpreter if one is needed, and speak to an authorised representative where one is recorded.</li>
          <li><strong>See how it fits together.</strong> Flowchart for this case shows which signals led to which circumstances and solutions, if you need to explain or question a suggestion.</li>
        </ul>
      </section>

      <section className="case-card bts-facts" aria-labelledby="cp-talk">
        <h2 id="cp-talk">When you talk to the customer</h2>
        <ul className="plain history">
          <li><strong>Lead with help, not the debt.</strong> Every signal is a prompt to offer support, never a penalty. The page gives you a reason to call that is about them.</li>
          <li><strong>Confirm, don't assume.</strong> Signals are what the data suggests. Check with the customer before acting on them, especially circumstances inferred from usage or payments.</li>
          <li><strong>Raise sensitive topics gently.</strong> Circumstances marked Sensitive come with handling notes; follow them. Never mention a sensitive signal the customer hasn't told us about themselves.</li>
          <li><strong>Safety comes first.</strong> Circumstances marked Safety, such as family violence, are never actioned automatically. Pass them to trained staff.</li>
          <li><strong>Use their words.</strong> Contact history shows what they have said before, so they don't have to repeat it.</li>
        </ul>
      </section>

      <section className="case-card bts-facts" aria-labelledby="cp-after">
        <h2 id="cp-after">After you've been in touch</h2>
        <ul className="plain history">
          <li><strong>Set the status from the case queue:</strong> tick the case and use the bar above the list. In progress while you're working on it, Waiting when you're waiting on the customer or another organisation, Resolved when nothing more is needed. The case page shows who has the case and its status, but doesn't change them.</li>
          <li><strong>Hand it on if needed.</strong> A manager can assign cases to someone else from the same bar.</li>
          <li><strong>Made a mistake?</strong> Assignment and status changes can be undone from the notice that appears for 20 seconds after saving.</li>
        </ul>
      </section>

      <section className="case-card bts-facts" aria-labelledby="cp-trust">
        <h2 id="cp-trust">How much to trust what you see</h2>
        <ul className="plain history">
          <li><strong>Account data</strong> is what the systems record. Survey answers and transcript phrases are what the customer told us, as of the date shown.</li>
          <li><strong>The priority</strong> is a guide for ordering the queue, not a judgement about the customer.</li>
          <li><strong>The AI boxes</strong> (Suggested plan, What the signals say, the AI order) are drafts to check before acting. They only use the case's facts but can still get things wrong or miss something.</li>
          <li><strong>Solutions</strong> come from a reference list; eligibility, amounts and contacts can change. Use the Source link to check.</li>
        </ul>
      </section>

      <section className="case-card bts-facts" aria-labelledby="cp-who">
        <h2 id="cp-who">Who can change what</h2>
        <ul className="plain history">
          <li><strong>Assigned worker:</strong> the status of their own cases.</li>
          <li><strong>Manager:</strong> the status of every case, and assigning cases.</li>
          <li><strong>Anyone else:</strong> can read the case but not change it.</li>
          <li><strong>Demo view</strong> in Demo settings (the gear in the header) switches who you are. It is a demo identity, not a real sign-in.</li>
        </ul>
      </section>

      <section className="case-card bts-facts" aria-labelledby="cp-data">
        <h2 id="cp-data">Behind the scenes: where the data lives</h2>
        <ul className="plain history">
          <li><strong>Demo cases and people:</strong> one case for every open account in the synthetic WA dataset, 4,380 in all. 200 are testing scenarios (20 each) with fictional survey answers, from <code>data/synthetic/case-queue.v1.json</code>; the other 4,180 have no survey. Names, contact details and dates of birth are fictional. The data's "today" is 16 Oct 2026.</li>
          <li><strong>Utility accounts</strong> come from the synthetic WA dataset (see Data sources), with dates moved forward 473 days. They are kept in their own database table and loaded only when a case is opened; each person stores a short summary of the signals their account raises, which is all the queue needs. The full import's files are too big for Git and are built by <code>scripts/generate-all-cases.mts</code>.</li>
          <li><strong>The flowchart</strong> is <code>data/admin/utility_hardship_mapping.json</code>: 110 signals (50 from account data, 57 asked of the customer, 3 from weather forecasts), 99 circumstances and 49 solutions. Edits on the Flowchart page are written straight back to this file.</li>
          <li><strong>Workers' changes</strong> are kept in a SQLite database on the server's disk (on Fly, the <code>/data</code> volume). Tables: <code>cases</code> (status, assignee, review, version), <code>notes</code>, <code>note_edits</code> (every earlier version of an edited note), and <code>workflow_actions</code> with <code>workflow_action_items</code> (the before and after of each change, for undo). The demo files are copied in on first start and never edited.</li>
        </ul>
      </section>

      <section className="case-card bts-facts" aria-labelledby="cp-load">
        <h2 id="cp-load">Behind the scenes: loading a case</h2>
        <ul className="plain history">
          <li><strong>One request,</strong> <code>GET /api/accounts/:accountNumber</code>, returns the case and the person with their whole utility account. Every request carries an <code>X-Demo-User</code> header naming the Demo view user, and the server refuses requests without a known user. Responses are gzipped.</li>
          <li><strong>The server enriches the case</strong> before sending it: it runs the flowchart over the case (below) and adds the flagged circumstances, support areas, solutions and priority. The result is kept in memory per case version and flowchart version, so opening the case again, or listing it in the queue, doesn't work it out again.</li>
          <li><strong>The page then draws the summary</strong> and asks for the Suggested plan (below), which the What to do first card and the Solutions to offer section share. The sections are only drawn when opened; the Account signals list is worked out again in the browser from the account, with the same rules as the server, and its AI summary is asked for then.</li>
          <li><strong>The open section is in the address</strong> as <code>#customer</code>, <code>#priority</code>, <code>#signals</code>, <code>#support</code>, <code>#solutions</code>, <code>#bills</code>, <code>#support-history</code>, <code>#supply</code> or <code>#contacts</code>, so a link can open it directly and Back closes it. Old <code>/accounts/:accountNumber/visual</code> links open the case page.</li>
        </ul>
      </section>

      <section className="case-card bts-facts" aria-labelledby="cp-signals">
        <h2 id="cp-signals">Behind the scenes: finding signals</h2>
        <ul className="plain history">
          <li><strong>From the account (33 rules):</strong> for example bills overdue, repeated late payments, a broken payment plan, a dishonoured payment, a disconnection warning, being disconnected, arrears rising, usage dropping, low prepay credit, outages, remote supply and unanswered outreach. Each rule reads the bills, payments, plans, collections, usage and contacts, and writes the evidence shown on the page, such as "2 bills past due; oldest due 11 Aug 2026".</li>
          <li><strong>From survey answers (5 questions):</strong> couldn't afford other essentials, avoided heating or cooling, life support, health affects energy use, and holds a concession card. Only a "Yes" raises the signal.</li>
          <li><strong>From what the customer said (14 phrases):</strong> the customer's own words in contact transcripts from the last 12 months, such as "lost my job", "rent went up" or "sitting in the dark". The agent's words never count, and vaguer remarks are left out on purpose.</li>
          <li><strong>From account facts:</strong> the medical cooling subsidy counts as "health affects energy use".</li>
          <li><strong>From weather forecasts (3 signals):</strong> the Bureau of Meteorology's forecasts for the customer's postcode, refreshed every hour. Extreme heat: a forecast maximum of 38°C or more in the next 7 days (42°C north of the 26th parallel, where 40°C is routine). Extreme fire danger: an Extreme or Catastrophic rating for the district (the free forecast usually rates tomorrow only). Weather warning: an active heatwave, severe weather, fire weather, cyclone or flood warning for the district. Each postcode is matched to its nearest of the Bureau's forecast towns, and that town's district.</li>
          <li><strong>Each signal counts once,</strong> with the first evidence found: account data, then the survey, then account facts, transcripts (newest first) and weather.</li>
        </ul>
      </section>

      <section className="case-card bts-facts" aria-labelledby="cp-flags">
        <h2 id="cp-flags">Behind the scenes: circumstances, solutions and priority</h2>
        <ul className="plain history">
          <li><strong>A circumstance is flagged</strong> when its linked signals include 1 strong signal or 2 supporting ones. Sensitive and safety circumstances need a strong one. The area signal (ABS SEIFA: the customer's postcode is among the most disadvantaged 20% in WA) never counts towards this; it only adds points once the customer's own evidence has flagged a circumstance. Only circumstances that apply to electricity are checked.</li>
          <li><strong>Weather is a risk, not an event.</strong> Extreme heat is a strong signal for "Heatwave or cold snap", and a supporting one for medical need for cooling, life support, rationing and prepay self-disconnection, so it adds weight where the customer is already vulnerable. Fire danger only supports "Bushfire, flood, cyclone or storm", so a forecast alone never claims a disaster happened.</li>
          <li><strong>Support areas</strong> are the flowchart categories with at least one flagged circumstance.</li>
          <li><strong>Solutions</strong> are every solution linked to a flagged circumstance, each listed once with the circumstances it is for. Their standard order is the order they appear in the flowchart file.</li>
          <li><strong>Priority</strong> adds points for each flagged circumstance and each distinct signal behind them, capped at 100 (see Priority model). The trend is rising when a worsening signal is present: arrears growing, usage dropping, low prepay credit or a disconnection warning.</li>
        </ul>
      </section>

      <section className="case-card bts-facts" aria-labelledby="cp-ai">
        <h2 id="cp-ai">Behind the scenes: the AI</h2>
        <ul className="plain history">
          <li><strong>Two requests per case:</strong> <code>GET /api/cases/:id/plan?kind=support</code> (the Suggested plan and solution order, when the case opens) and <code>kind=signals</code> (the Account signals summary, when that section opens). The browser asks the app's server, and the server calls the AI service with a key stored as a Fly secret, so the key never reaches the browser.</li>
          <li><strong>AI service:</strong> Claude (Anthropic) or Gemini (Google). The setting <code>AI_PROVIDER</code> (<code>claude</code> or <code>gemini</code>) picks one; without it, Claude is used when <code>ANTHROPIC_API_KEY</code> is set, otherwise Gemini with <code>GEMINI_API_KEY</code>. Either way there is a 30-second timeout.</li>
          <li><strong>Claude:</strong> Claude Haiku 5.5 (<code>claude-haiku-5-5</code>) at low effort, paid per use. <code>CLAUDE_MODEL</code> (plan) and <code>CLAUDE_SIGNALS_MODEL</code> (signals) change the model without a code change.</li>
          <li><strong>Gemini:</strong> Gemini Flash-Lite (<code>gemini-flash-lite-latest</code>) on the free tier, temperature 0.3. <code>GEMINI_MODEL</code> (plan) and <code>GEMINI_SIGNALS_MODEL</code> (signals) change the model.</li>
          <li><strong>Sent for the plan:</strong> the priority and trend; each circumstance with its support area, sensitivity and handling notes; each signal with its strength and evidence; each solution with its id, who it is for, key facts and how to access it; the contact settings (preferred channel, do not call, SMS and email opt-in, interpreter, life support); and the contact methods allowed. Dates are written like 10 Oct 2026. Never the name, address, phone or email.</li>
          <li><strong>Sent for the signals summary:</strong> only the account signals and weather signals, with their evidence.</li>
          <li><strong>The instructions</strong> say: one paragraph; use only the facts given; plain, kind language; never judge the customer; safety goes to trained staff. The plan must describe the situation accurately (reconnect if already disconnected), the order must match the plan, reasons must be about this customer only, and anything urgent is same-day. The signals summary must only describe, with no suggestions.</li>
          <li><strong>The plan comes back as JSON</strong> in a fixed shape: the paragraph, then every solution with a reason, a number of working days and a contact method (phone, SMS, email or letter).</li>
          <li><strong>The server checks and fixes the answer.</strong> The order must contain exactly the case's solutions, each once, or the page keeps the standard order. The due date is today in Perth plus that many working days, skipping weekends. A method the contact settings rule out is replaced with the preferred channel, or a letter. Anything due today becomes a phone call unless the customer is do not call. Phone steps mention an interpreter when one is required.</li>
          <li><strong>Results are kept in memory</strong> per case version and flowchart version, so each case calls the AI once until it changes. A server restart clears them. Failed calls aren't kept, so reloading tries again.</li>
          <li><strong>Errors:</strong> if the AI service is busy or has a server error, the server tries once more. A usage limit, a missing key or an empty answer shows a plain message in the box; the rest of the page is unaffected.</li>
        </ul>
      </section>

      <section className="case-card bts-facts" aria-labelledby="cp-save">
        <h2 id="cp-save">Behind the scenes: saving changes</h2>
        <ul className="plain history">
          <li><strong>Every change sends the case version the page loaded.</strong> If someone else changed the case since, the server refuses with a conflict and sends the latest version, which the page shows, so nobody overwrites another person's work. Each saved change adds 1 to the version.</li>
          <li><strong>Permissions are checked on the server,</strong> not just hidden on the page: only the assigned worker or a manager can change a case, and only managers can assign.</li>
          <li><strong>Assignment and status changes can be undone</strong> from the notice shown for 20 seconds after saving, by the person who made them or a manager. Undo is refused if the case has changed since.</li>
          <li><strong>Notes and review:</strong> the server still keeps case notes (with every edit in <code>note_edits</code>) and the review status, but the case page no longer shows or changes them.</li>
          <li><strong>Changing a case clears its saved AI results,</strong> because the version changes, so the next view drafts fresh ones.</li>
        </ul>
      </section>

      <section className="case-card bts-facts" aria-labelledby="cp-flow">
        <h2 id="cp-flow">Behind the scenes: Flowchart for this case</h2>
        <ul className="plain history">
          <li><strong>It loads the flowchart</strong> (<code>GET /api/admin/flow</code>) and finds this case's signals again in the browser, with the same rules as the server.</li>
          <li><strong>It shows only this case's path:</strong> the signals seen, the circumstances flagged and the solutions offered, with the links between them. Nothing is highlighted until a box is chosen.</li>
          <li><strong>Clicking a box</strong> shows this case's data for it: whether a signal was seen and its evidence, why a circumstance was or wasn't flagged, and which circumstances led to a solution. It can't edit the flowchart.</li>
        </ul>
      </section>
    </main>
  );
}
