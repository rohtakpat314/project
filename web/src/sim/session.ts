import { GlLattice } from "./gl";
import { GpuLattice } from "./gpu";
import { createLattice, energyPerSpin, flipCoins, magnetisation, paintLattice, sweepLattice, XorShift32 } from "./reference";
import type { EngineKind, LatticeEngine, Sample } from "./types";

export type Mode = "gpu" | "reference" | "coins";

export class Session {
  readonly kind: EngineKind;
  n = 24;
  temperature = 2.1;
  mode: Mode = "gpu";
  seed = 1;
  private frame = 1;
  private gpuTicks = 0;
  private spins: Int8Array | null = null;
  private trail: Float32Array | null = null;
  private flipped: Uint8Array | null = null;
  private rng: XorShift32 | null = null;
  private statsFlight: Promise<void> | null = null;
  latest: Sample | null = null;

  private constructor(private view: LatticeEngine) {
    this.kind = view.kind;
  }

  static async open(canvas: HTMLCanvasElement): Promise<Session> {
    let view: LatticeEngine | null = null;
    try {
      view = await GpuLattice.create(canvas);
    } catch (err) {
      console.warn(err);
      view = null;
    }
    if (!view) {
      try {
        view = GlLattice.create(canvas);
      } catch (err) {
        console.warn(err);
        view = null;
      }
    }
    if (!view) throw new Error("This browser has neither WebGPU nor WebGL2.");
    const session = new Session(view);
    session.reset();
    return session;
  }

  setSize(n: number): void {
    this.n = this.mode === "reference" ? Math.min(n, 256) : n;
    this.reset();
  }

  setMode(mode: Mode): void {
    this.mode = mode;
    if (mode === "reference" && this.n > 256) this.n = 256;
    this.reset();
  }

  reset(): void {
    this.seed = (this.seed + 1) >>> 0;
    const spins = createLattice(this.n, this.seed);
    this.spins = spins;
    this.trail = new Float32Array(spins.length);
    this.flipped = new Uint8Array(spins.length);
    this.rng = new XorShift32((this.seed ^ 0x9e3779b9) >>> 0);
    this.view.setTemperature(this.temperature);
    this.view.resize(this.n, paintLattice(spins, this.trail, this.flipped, 1));
  }

  tick(): void {
    this.view.setTemperature(this.temperature);
    if (this.mode === "reference") this.tickReference();
    else if (this.mode === "coins") this.tickCoins();
    else this.tickGpu();
    this.view.draw();
  }

  render(): void {
    this.view.draw();
  }

  destroy(): void {
    this.view.destroy();
  }

  private tickReference(): void {
    if (!this.spins || !this.trail || !this.flipped || !this.rng) return;
    const before = this.spins.slice();
    const flips = sweepLattice(this.spins, this.n, this.temperature, this.rng);
    for (let i = 0; i < before.length; i++) this.flipped[i] = before[i] === this.spins[i] ? 0 : 1;
    this.view.upload(paintLattice(this.spins, this.trail, this.flipped, 0.9));
    this.latest = {
      energy: energyPerSpin(this.spins, this.n),
      mag: magnetisation(this.spins, this.n),
      flips,
    };
  }

  private tickCoins(): void {
    if (!this.spins || !this.trail || !this.flipped || !this.rng) return;
    const before = this.spins.slice();
    flipCoins(this.spins, this.rng);
    let flips = 0;
    for (let i = 0; i < before.length; i++) {
      const changed = before[i] === this.spins[i] ? 0 : 1;
      this.flipped[i] = changed;
      flips += changed;
    }
    this.view.upload(paintLattice(this.spins, this.trail, this.flipped, 0.9));
    this.latest = {
      energy: energyPerSpin(this.spins, this.n),
      mag: magnetisation(this.spins, this.n),
      flips,
    };
  }

  private tickGpu(): void {
    const sweeps = this.n >= 1024 ? 1 : this.n >= 512 ? 2 : 4;
    for (let i = 0; i < sweeps; i++) this.view.step(this.frame++);
    this.gpuTicks += 1;
    if (!this.statsFlight && this.gpuTicks % 8 === 0) {
      this.statsFlight = this.view.readStats().then((sample) => {
        this.statsFlight = null;
        if (sample) this.latest = sample;
      });
    }
  }
}
