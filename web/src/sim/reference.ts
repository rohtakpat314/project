// Checkerboard Metropolis for the 2D Ising model, J = 1, periodic boundaries.
// One sweep updates the even sublattice, then the odd one. Neighbors are frozen
// during a sublattice pass, which is what the GPU shader does in parallel.

export class XorShift32 {
  state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 1;
  }

  next(): number {
    let x = this.state >>> 0;
    x ^= (x << 13) >>> 0;
    x ^= x >>> 17;
    x ^= (x << 5) >>> 0;
    this.state = x >>> 0;
    return (this.state >>> 0) / 4294967296;
  }
}

export function flipCoins(spins: Int8Array, rng: XorShift32): number {
  let flips = 0;
  for (let i = 0; i < spins.length; i++) {
    const next = rng.next() < 0.5 ? -1 : 1;
    if (next !== spins[i]) flips += 1;
    spins[i] = next;
  }
  return flips;
}

export function createLattice(n: number, seed: number): Int8Array {
  const rng = new XorShift32(seed);
  const spins = new Int8Array(n * n);
  for (let i = 0; i < spins.length; i++) spins[i] = rng.next() < 0.5 ? -1 : 1;
  return spins;
}

function at(spins: Int8Array, n: number, x: number, y: number): number {
  const xx = (x + n) % n;
  const yy = (y + n) % n;
  return spins[yy * n + xx];
}

export function sweepLattice(spins: Int8Array, n: number, temperature: number, rng: XorShift32): number {
  let flips = 0;
  for (let parity = 0; parity < 2; parity++) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (((x + y) & 1) !== parity) continue;
        const s = at(spins, n, x, y);
        const sum =
          at(spins, n, x + 1, y) +
          at(spins, n, x - 1, y) +
          at(spins, n, x, y + 1) +
          at(spins, n, x, y - 1);
        const delta = 2 * s * sum;
        const accept =
          delta <= 0 || (temperature > 0 && rng.next() < Math.exp(-delta / temperature));
        if (accept) {
          spins[y * n + x] = -s;
          flips += 1;
        }
      }
    }
  }
  return flips;
}

export function energyPerSpin(spins: Int8Array, n: number): number {
  let bonds = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const s = spins[y * n + x];
      bonds += s * at(spins, n, x + 1, y) + s * at(spins, n, x, y + 1);
    }
  }
  return -bonds / (n * n);
}

export function magnetisation(spins: Int8Array, n: number): number {
  let sum = 0;
  for (let i = 0; i < spins.length; i++) sum += spins[i];
  return sum / (n * n);
}

export function paintLattice(spins: Int8Array, trail: Float32Array, flipped: Uint8Array, decay: number): Uint8Array {
  const n = spins.length;
  const rgba = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const heat = flipped[i] ? 1 : trail[i] * decay;
    trail[i] = heat;
    rgba[i * 4] = spins[i] > 0 ? 255 : 0;
    rgba[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(heat * 255)));
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}
