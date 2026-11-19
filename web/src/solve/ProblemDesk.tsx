import { useEffect, useMemo, useRef, useState } from "react";
import { EXAMPLES, Rng, SPOKEN, cutOf, exactBest, openingTemperature, parseEdges, readProblem, sweep, type Edge } from "./cut";

type Live = {
  spins: number[];
  cut: number;
  best: number;
  temperature: number;
  t0: number;
};

type Phase = "editing" | "running" | "settled";

function places(n: number): { x: number; y: number }[] {
  const cx = 500;
  const cy = 470;
  const radius = n === 2 ? 180 : 300;
  return Array.from({ length: n }, (_, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
  });
}

function show(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export function ProblemDesk({ onLattice }: { onLattice: () => void }) {
  const [problem, setProblem] = useState(SPOKEN.seven);
  const [readError, setReadError] = useState("");
  const [count, setCount] = useState(EXAMPLES.seven.n);
  const [text, setText] = useState(EXAMPLES.seven.text);
  const [phase, setPhase] = useState<Phase>("editing");
  const [live, setLive] = useState<Live>({
    spins: Array(EXAMPLES.seven.n).fill(1),
    cut: 0,
    best: 0,
    temperature: 0,
    t0: 1,
  });
  const job = useRef<{
    spins: Int8Array;
    bestSpins: Int8Array;
    best: number;
    temperature: number;
    t0: number;
    rng: Rng;
    edges: Edge[];
  } | null>(null);

  const parsed = useMemo(() => parseEdges(text, count), [text, count]);
  const exact = useMemo(() => (parsed.error ? null : exactBest(count, parsed.edges)), [count, parsed]);

  useEffect(() => {
    if (phase !== "running") return;
    let raf = 0;
    const frame = () => {
      const run = job.current;
      if (!run) return;
      sweep(run.spins, run.edges, run.temperature, run.rng);
      const score = cutOf(run.spins, run.edges);
      if (score > run.best) {
        run.best = score;
        run.bestSpins = run.spins.slice();
      }
      run.temperature *= 0.96;
      if (run.temperature < 0.05) {
        const settled = run.bestSpins.slice();
        run.spins = settled;
        setLive({ spins: Array.from(settled), cut: run.best, best: run.best, temperature: 0, t0: run.t0 });
        setPhase("settled");
        return;
      }
      setLive({
        spins: Array.from(run.spins),
        cut: score,
        best: run.best,
        temperature: run.temperature,
        t0: run.t0,
      });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  function editProblem(next: string) {
    job.current = null;
    setProblem(next);
    setPhase("editing");
    const read = readProblem(next);
    if (read.error) {
      setReadError(read.error);
      return;
    }
    setReadError("");
    setCount(read.n);
    setText(read.edgeText);
    setLive({ spins: Array(read.n).fill(1), cut: 0, best: 0, temperature: 0, t0: 1 });
  }

  function start() {
    if (parsed.error || parsed.edges.length === 0) return;
    const spins = new Int8Array(count);
    spins.fill(1);
    const t0 = openingTemperature(parsed.edges);
    job.current = {
      spins,
      bestSpins: spins.slice(),
      best: 0,
      temperature: t0,
      t0,
      rng: new Rng((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0 || 1),
      edges: parsed.edges,
    };
    setLive({ spins: Array.from(spins), cut: 0, best: 0, temperature: t0, t0 });
    setPhase("running");
  }

  function flip(index: number) {
    if (phase === "running" || parsed.error) return;
    const spins = Int8Array.from(live.spins.length === count ? live.spins : Array(count).fill(1));
    spins[index] = -spins[index];
    const score = cutOf(spins, parsed.edges);
    setPhase("editing");
    setLive({ spins: Array.from(spins), cut: score, best: Math.max(live.best, score), temperature: 0, t0: 1 });
  }

  const spots = places(count);
  const spins = live.spins.length === count ? live.spins : Array(count).fill(1);
  const heat = live.t0 > 0 ? Math.max(0, Math.min(1, live.temperature / live.t0)) : 0;

  return (
    <section className="desk">
      <header className="desk-top">
        <div>
          <h1>Cut</h1>
          <p className="quiet">
            {phase === "settled"
              ? exact && live.cut === exact.cut
                ? "Settled. This cut matches the best one."
                : "Settled on the best assignment it found while cooling."
              : phase === "running"
                ? "Cooling. A worse flip can still be kept while the temperature is high."
                : "Every vertex is indigo. The cut starts at 0."}
          </p>
        </div>
        <dl className="meters cut-meters">
          <div>
            <dt>cut</dt>
            <dd>{show(live.cut)}</dd>
          </div>
          <div>
            <dt>best seen</dt>
            <dd>{show(live.best)}</dd>
          </div>
          <div>
            <dt>best possible</dt>
            <dd>{exact ? show(exact.cut) : "—"}</dd>
          </div>
          <div>
            <dt>T</dt>
            <dd>{live.temperature.toFixed(2)}</dd>
          </div>
        </dl>
        <div className="desk-actions">
          <button type="button" onClick={start} disabled={phase === "running" || Boolean(readError) || parsed.edges.length === 0}>
            {phase === "running" ? "Cooling" : phase === "settled" ? "Solve again" : "Solve"}
          </button>
          <button type="button" onClick={onLattice}>
            Lattice
          </button>
        </div>
      </header>
      <div className="stage">
        <svg viewBox="0 0 1000 940" role="img" aria-label="Weighted graph">
          <title>Weighted graph</title>
          {parsed.edges.map((edge, index) => {
            const p = spots[edge.a];
            const q = spots[edge.b];
            const disagree = spins[edge.a] !== spins[edge.b];
            const dx = q.x - p.x;
            const dy = q.y - p.y;
            const len = Math.hypot(dx, dy) || 1;
            const ux = dx / len;
            const uy = dy / len;
            const gap = 36;
            const x1 = p.x + ux * gap;
            const y1 = p.y + uy * gap;
            const x2 = q.x - ux * gap;
            const y2 = q.y - uy * gap;
            const mx = (p.x + q.x) / 2 + -uy * 16;
            const my = (p.y + q.y) / 2 + ux * 16;
            return (
              <g key={`${edge.a}-${edge.b}-${index}`}>
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={disagree ? "#f0c39a" : "rgba(231,225,214,0.28)"}
                  strokeWidth={disagree ? 4 : 1.5}
                />
                <text x={mx} y={my} textAnchor="middle" className={disagree ? "weight cut-weight" : "weight"}>
                  {show(edge.w)}
                </text>
              </g>
            );
          })}
          {spots.map((spot, index) => (
            <g key={index} onClick={() => flip(index)} className="vertex" role="button">
              <circle cx={spot.x} cy={spot.y} r={28} fill={spins[index] > 0 ? "#9aabff" : "#e09278"} />
              <text x={spot.x} y={spot.y + 5} textAnchor="middle" className="index">
                {index}
              </text>
            </g>
          ))}
        </svg>
        <div className="coolbar" aria-hidden="true">
          <span style={{ transform: `scaleX(${heat})` }} />
        </div>
      </div>
      <aside className="editor">
        <label className="edges">
          Problem
          <textarea
            value={problem}
            spellCheck={false}
            aria-label="Problem statement"
            disabled={phase === "running"}
            onChange={(event) => editProblem(event.target.value)}
          />
        </label>
        <p className="quiet">Say how many vertices, then one sentence per edge.</p>
        {readError ? <p className="warn">{readError}</p> : <pre className="readout">{text}</pre>}
        <div className="actions">
          <button type="button" onClick={() => editProblem(SPOKEN.seven)} disabled={phase === "running"}>
            Seven vertices
          </button>
          <button type="button" onClick={() => editProblem(SPOKEN.path)} disabled={phase === "running"}>
            Path
          </button>
        </div>
      </aside>
    </section>
  );
}
