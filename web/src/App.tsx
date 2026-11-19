import { useEffect, useRef, useState } from "react";
import { drawScope, type Trace } from "./plot/scope";
import { BoardLink, type BoardFrame } from "./serial/board";
import { ProblemDesk } from "./solve/ProblemDesk";
import { Session, type Mode } from "./sim/session";

const SIZES = [16, 24, 32, 48];
const MIN_N = 2;
const MAX_N = 96;

function format(n: number): string {
  return Number.isFinite(n) ? n.toFixed(3) : "—";
}

export function App() {
  const viewRef = useRef<HTMLCanvasElement>(null);
  const scopeRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<Session | null>(null);
  const traces = useRef<Trace[]>([]);
  const tempRef = useRef(2.1);
  const runningRef = useRef(true);
  const boardRef = useRef(new BoardLink());
  const [backend, setBackend] = useState("starting");
  const [error, setError] = useState("");
  const [temp, setTemp] = useState(2.1);
  const [size, setSize] = useState(24);
  const [sizeText, setSizeText] = useState("24");
  const [mode, setMode] = useState<Mode>("gpu");
  const [running, setRunning] = useState(true);
  const [sample, setSample] = useState({ energy: 0, mag: 0, flips: 0 });
  const [board, setBoard] = useState<BoardFrame | null>(null);
  const [linked, setLinked] = useState(false);
  const [desk, setDesk] = useState<"problem" | "lattice">("problem");
  const deskRef = useRef(desk);
  deskRef.current = desk;

  useEffect(() => {
    const canvas = viewRef.current;
    if (!canvas) return;
    let dead = false;
    let raf = 0;
    let ticks = 0;
    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.max(2, Math.floor(canvas.clientWidth * dpr));
      canvas.height = Math.max(2, Math.floor(canvas.clientHeight * dpr));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(canvas);
    void Session.open(canvas)
      .then((session) => {
        if (dead) {
          session.destroy();
          return;
        }
        sessionRef.current = session;
        setBackend(session.kind === "webgpu" ? "WebGPU" : "WebGL2");
        const loop = () => {
          session.temperature = tempRef.current;
          if (deskRef.current === "lattice") {
            if (runningRef.current) session.tick();
            else session.render();
          }
          if (session.latest) {
            traces.current.push({
              energy: session.latest.energy,
              mag: session.latest.mag,
              temp: tempRef.current,
            });
            if (traces.current.length > 240) traces.current.shift();
            if (scopeRef.current) drawScope(scopeRef.current, traces.current);
          }
          ticks += 1;
          if (ticks % 8 === 0 && session.latest) setSample({ ...session.latest });
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "The lattice did not start.");
      });
    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      sessionRef.current?.destroy();
      void boardRef.current.disconnect();
    };
  }, []);

  function chooseSize(next: number) {
    const clamped = Math.max(MIN_N, Math.min(MAX_N, Math.round(next)));
    const limited = mode === "reference" ? Math.min(clamped, 256) : clamped;
    setSizeText(String(limited));
    if (limited === size) return;
    setSize(limited);
    traces.current = [];
    sessionRef.current?.setSize(limited);
  }

  function commitSize(text: string) {
    const trimmed = text.trim();
    if (!/^\d+$/.test(trimmed)) {
      setSizeText(String(size));
      return;
    }
    chooseSize(Number(trimmed));
  }

  function chooseMode(next: Mode) {
    setMode(next);
    if (next === "reference") setSize(Math.min(size, 256));
    traces.current = [];
    sessionRef.current?.setMode(next);
  }

  async function toggleBoard() {
    if (linked) {
      await boardRef.current.disconnect();
      setLinked(false);
      setBoard(null);
      return;
    }
    try {
      await boardRef.current.connect((frame) => setBoard(frame));
      setLinked(true);
    } catch (err) {
      setBoard(null);
      setLinked(false);
      if (err instanceof Error && err.name !== "NotFoundError") setError(err.message);
    }
  }

  if (error) {
    return (
      <main className="error">
        <p>{error}</p>
      </main>
    );
  }

  return (
    <main>
      <canvas ref={viewRef} className={desk === "problem" ? "view view-back" : "view"} aria-label="Ising lattice" />
      {desk === "problem" ? <ProblemDesk onLattice={() => setDesk("lattice")} /> : null}
      <div className={desk === "problem" ? "hud view-back" : "hud"}>
        <header className="top">
          <div>
            <h1>Ising</h1>
            <p className="quiet">
              {backend} · {size}² · {mode === "gpu" ? "checkerboard" : mode === "reference" ? "reference" : "fair coins"} · {running ? "running" : "paused"}
            </p>
          </div>
          <button type="button" onClick={() => setDesk("problem")}>
            Problem
          </button>
          <dl className="meters">
            <div>
              <dt>T</dt>
              <dd>{format(temp)}</dd>
            </div>
            <div>
              <dt>m</dt>
              <dd>{format(sample.mag)}</dd>
            </div>
            <div>
              <dt>E/N</dt>
              <dd>{format(sample.energy)}</dd>
            </div>
          </dl>
        </header>
        <div />
        <footer className="bottom">
          <canvas ref={scopeRef} className="scope" aria-label="Energy, magnetisation, and temperature" />
          <section className="panel">
            <label className="row">
              Temperature
              <input
                type="range"
                min={0.5}
                max={4.5}
                step={0.01}
                value={temp}
                disabled={mode === "coins"}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  tempRef.current = next;
                  setTemp(next);
                }}
              />
            </label>
            <div className="sizes" role="group" aria-label="Lattice size">
              {SIZES.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={size === value}
                  disabled={mode === "reference" && value > 256}
                  onClick={() => chooseSize(value)}
                >
                  {value}
                </button>
              ))}
            </div>
            <label className="row">
              n × n
              <input
                type="number"
                min={MIN_N}
                max={MAX_N}
                step={1}
                value={sizeText}
                aria-label="Custom grid size"
                onChange={(event) => setSizeText(event.target.value)}
                onBlur={(event) => commitSize(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitSize(event.currentTarget.value);
                  }
                }}
              />
            </label>
            <div className="actions">
              <button
                type="button"
                onClick={() => {
                  runningRef.current = !runningRef.current;
                  setRunning(runningRef.current);
                }}
              >
                {running ? "Pause" : "Run"}
              </button>
              <button
                type="button"
                onClick={() => {
                  traces.current = [];
                  sessionRef.current?.reset();
                }}
              >
                Reset
              </button>
              <button
                type="button"
                disabled={mode === "coins"}
                onClick={() => {
                  tempRef.current = 1.2;
                  setTemp(1.2);
                }}
              >
                Cool
              </button>
              <button
                type="button"
                disabled={mode === "coins"}
                onClick={() => {
                  tempRef.current = 3.6;
                  setTemp(3.6);
                }}
              >
                Heat
              </button>
              <button type="button" aria-pressed={mode === "coins"} onClick={() => chooseMode(mode === "coins" ? "gpu" : "coins")}>
                {mode === "coins" ? "Neighbors" : "Coins"}
              </button>
              <button type="button" aria-pressed={mode === "reference"} onClick={() => chooseMode(mode === "gpu" ? "reference" : "gpu")}>
                {mode === "gpu" ? "Reference" : "GPU"}
              </button>
              <button type="button" aria-pressed={linked} onClick={() => void toggleBoard()} disabled={!BoardLink.available() && !linked}>
                {linked ? "Close board" : "Board"}
              </button>
            </div>
            <p className="quiet">
              {mode === "coins"
                ? "Indigo is heads, clay is tails. Every vertex is flipped again as a fair coin. A bright edge is two neighbors that landed on different sides. Temperature stays out of it, so E/N wobbles around 0."
                : mode === "reference"
                  ? "Indigo vertices are +1. Clay vertices are −1. A bright edge is a cut. Reference kernel, capped at 256²."
                  : "Indigo vertices are +1. Clay vertices are −1. A bright edge is a cut. Critical point is near 2.27."}
            </p>
            {board ? (
              <p className="board">
                board E {format(board.energy)} m {format(board.mag)} T {format(board.temp)}
              </p>
            ) : null}
          </section>
        </footer>
      </div>
    </main>
  );
}
