import { useDeferredValue, useEffect, useEffectEvent, useState } from "react";
import { diagramFixtures } from "../fixtures/diagram-fixtures.js";
import { analyzeDiagram } from "../mermaid/diagram-adapters.js";
import { configureMermaid, renderMermaid } from "../mermaid/runtime.js";
import "./debug.css";

configureMermaid("light");

function DiagramSpecimen({ fixture, onStatus }) {
  const [result, setResult] = useState({ status: "queued", svg: "", error: "" });
  const reportStatus = useEffectEvent(onStatus);

  useEffect(() => {
    let active = true;
    setResult({ status: "rendering", svg: "", error: "" });
    reportStatus(fixture.id, "rendering");
    renderMermaid(`debug-${fixture.id}`, fixture.source).then(({ svg }) => {
      if (!active) return;
      setResult({ status: "passed", svg, error: "" });
      reportStatus(fixture.id, "passed");
    }).catch((error) => {
      if (!active) return;
      const message = error?.message?.split("\n")[0] || "Unknown render failure";
      setResult({ status: "failed", svg: "", error: message });
      reportStatus(fixture.id, "failed");
    });
    return () => { active = false; };
  }, [fixture]);

  const analysis = analyzeDiagram(fixture.source);
  return (
    <article className={`debug-card ${result.status}`} data-fixture-id={fixture.id} data-render-status={result.status}>
      <header className="debug-card-header">
        <div>
          <span className="fixture-family">{fixture.family}</span>
          <h2>{fixture.title}</h2>
        </div>
        <span className="render-state">{result.status}</span>
      </header>
      <div className="fixture-meta">
        <code>{fixture.id}</code>
        <span>{analysis.id}</span>
        <span>{analysis.mode}</span>
        <span>{fixture.stability}</span>
      </div>
      <div className="feature-list" aria-label="Covered syntax">
        {fixture.features.map((feature) => <span key={feature}>{feature}</span>)}
      </div>
      <div className="debug-render">
        {result.status === "failed"
          ? <pre className="render-error">{result.error}</pre>
          : result.svg
            ? <div className="rendered-specimen" dangerouslySetInnerHTML={{ __html: result.svg }} />
            : <div className="render-placeholder">Waiting for renderer</div>}
      </div>
      <a className="experiment-link" href={`/?fixture=${encodeURIComponent(fixture.id)}`} target="_blank" rel="noopener noreferrer">
        Experiment in viewer
      </a>
      <details>
        <summary>Source</summary>
        <pre><code>{fixture.source}</code></pre>
      </details>
    </article>
  );
}

export default function DebugPage() {
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState("all");
  const [statuses, setStatuses] = useState(() => Object.fromEntries(diagramFixtures.map(({ id }) => [id, "queued"])));
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const families = [...new Set(diagramFixtures.map((fixture) => fixture.family))].sort();
  const visibleFixtures = diagramFixtures.filter((fixture) => (
    (family === "all" || fixture.family === family)
    && (!deferredQuery || `${fixture.id} ${fixture.family} ${fixture.title} ${fixture.features.join(" ")}`.toLocaleLowerCase().includes(deferredQuery))
  ));
  const counts = Object.values(statuses).reduce((result, status) => {
    result[status] = (result[status] || 0) + 1;
    return result;
  }, {});
  const updateStatus = (id, status) => setStatuses((current) => current[id] === status ? current : { ...current, [id]: status });

  useEffect(() => {
    document.documentElement.classList.add("debug-route");
    document.body.classList.add("debug-route");
    return () => {
      document.documentElement.classList.remove("debug-route");
      document.body.classList.remove("debug-route");
    };
  }, []);

  return (
    <main className="debug-page">
      <header className="debug-masthead">
        <div className="debug-title">
          <a href="/">Mermaid Atlas</a>
          <span>Development renderer laboratory</span>
          <h1>Every grammar gets a specimen.</h1>
          <p>One catalog drives this page, the viewer examples, and automated render checks. A red card is a reproducible compatibility bug.</p>
        </div>
        <div className="debug-tally" aria-label="Render totals">
          <strong>{diagramFixtures.length}</strong><span>fixtures</span>
          <strong className="pass-count">{counts.passed || 0}</strong><span>passed</span>
          <strong className="fail-count">{counts.failed || 0}</strong><span>failed</span>
          <strong>{(counts.queued || 0) + (counts.rendering || 0)}</strong><span>pending</span>
        </div>
      </header>
      <section className="debug-controls" aria-label="Filter syntax fixtures">
        <label>
          <span>Find syntax</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Try: aggregation, ELK, C4…" />
        </label>
        <label>
          <span>Family</span>
          <select value={family} onChange={(event) => setFamily(event.target.value)}>
            <option value="all">All families</option>
            {families.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <output>{visibleFixtures.length} visible</output>
      </section>
      <section className="debug-grid" aria-live="polite">
        {visibleFixtures.map((entry) => <DiagramSpecimen key={entry.id} fixture={entry} onStatus={updateStatus} />)}
      </section>
    </main>
  );
}
