export type Edge = { a: number; b: number; w: number };

export class Rng {
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
    return this.state / 4294967296;
  }
}

export const EXAMPLES = {
  seven: {
    n: 7,
    text: ["0 1 -2", "0 2 2", "1 3 7", "2 3 8", "2 4 1", "2 6 -1", "3 4 -1", "3 5 2"].join("\n"),
  },
  path: {
    n: 3,
    text: ["0 1 -5", "1 2 10"].join("\n"),
  },
};

export const SPOKEN = {
  seven: [
    "There are 7 vertices.",
    "The edge between 0 and 1 has weight -2.",
    "The edge between 0 and 2 has weight 2.",
    "The edge between 1 and 3 has weight 7.",
    "The edge between 2 and 3 has weight 8.",
    "The edge between 2 and 4 has weight 1.",
    "The edge between 2 and 6 has weight -1.",
    "The edge between 3 and 4 has weight -1.",
    "The edge between 3 and 5 has weight 2.",
  ].join("\n"),
  path: [
    "There are 3 vertices.",
    "The edge between 0 and 1 has weight -5.",
    "The edge between 1 and 2 has weight 10.",
  ].join("\n"),
};

export function readProblem(source: string): { n: number; edges: Edge[]; edgeText: string; error: string } {
  const countMatch = source.match(/(\d+)\s+vertices\b/i);
  const sentences = source
    .split(/[\n.]+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const weight = "([+-]?\\d+(?:\\.\\d+)?)";
  const pair = "(?:vertex\\s+)?(\\d+)\\s+and\\s+(?:vertex\\s+)?(\\d+)";
  const patterns = [
    new RegExp(`(?:between|btwn)\\s+${pair}\\s+(?:has\\s+|have\\s+|with\\s+)?(?:a\\s+)?weight(?:\\s+of)?\\s+${weight}`, "i"),
    new RegExp(`${pair}\\s+weight\\s+${weight}`, "i"),
    new RegExp(`(\\d+)\\s*[-–—]\\s*(\\d+)\\s+weight\\s+${weight}`, "i"),
    /^(\d+)\s+(\d+)\s+([+-]?\d+(?:\.\d+)?)$/,
  ];
  const edges: Edge[] = [];
  for (const sentence of sentences) {
    if (/\d+\s+vertices\b/i.test(sentence)) continue;
    let found: RegExpMatchArray | null = null;
    for (const pattern of patterns) {
      found = sentence.match(pattern);
      if (found) break;
    }
    if (!found) {
      if (/\d/.test(sentence)) return { n: 0, edges: [], edgeText: "", error: `Couldn't read “${sentence}”.` };
      continue;
    }
    const a = Number(found[1]);
    const b = Number(found[2]);
    const w = Number(found[3]);
    if (a === b) return { n: 0, edges: [], edgeText: "", error: `“${sentence}” ties a vertex to itself.` };
    edges.push({ a, b, w });
  }
  if (edges.length === 0) {
    return { n: 0, edges: [], edgeText: "", error: "Write each edge as: the edge between 0 and 1 has weight 5." };
  }
  const highest = edges.reduce((max, edge) => Math.max(max, edge.a, edge.b), 0);
  const n = countMatch ? Number(countMatch[1]) : highest + 1;
  if (n < 2 || n > 16) return { n, edges: [], edgeText: "", error: "Use 2 to 16 vertices." };
  if (highest >= n) return { n, edges: [], edgeText: "", error: `Vertex ${highest} needs at least ${highest + 1} vertices.` };
  const edgeText = edges.map((edge) => `${edge.a} ${edge.b} ${edge.w}`).join("\n");
  return { n, edges, edgeText, error: "" };
}

export function parseEdges(text: string, n: number): { edges: Edge[]; error: string } {
  const edges: Edge[] = [];
  const lines = text.split(/\n/);
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li].trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/[\s,]+/);
    if (parts.length < 3) return { edges: [], error: `Line ${li + 1} needs two vertices and a weight.` };
    const a = Number(parts[0]);
    const b = Number(parts[1]);
    const w = Number(parts[2]);
    if (!Number.isInteger(a) || !Number.isInteger(b) || !Number.isFinite(w)) {
      return { edges: [], error: `Line ${li + 1} is not two vertices and a weight.` };
    }
    if (a === b || a < 0 || b < 0 || a >= n || b >= n) {
      return { edges: [], error: `Line ${li + 1} points outside vertices 0…${n - 1}.` };
    }
    edges.push({ a, b, w });
  }
  return { edges, error: "" };
}

export function cutOf(spins: Int8Array, edges: Edge[]): number {
  let score = 0;
  for (const edge of edges) score += (edge.w * (1 - spins[edge.a] * spins[edge.b])) / 2;
  return score;
}

export function deltaH(spins: Int8Array, edges: Edge[], i: number): number {
  let field = 0;
  for (const edge of edges) {
    if (edge.a === i) field += edge.w * spins[edge.b];
    else if (edge.b === i) field += edge.w * spins[edge.a];
  }
  return -spins[i] * field;
}

export function exactBest(n: number, edges: Edge[]): { cut: number; spins: Int8Array } {
  const spins = new Int8Array(n);
  let best = Number.NEGATIVE_INFINITY;
  let bestSpins = new Int8Array(n);
  const limit = 1 << Math.max(0, n - 1);
  for (let mask = 0; mask < limit; mask++) {
    spins[0] = 1;
    for (let i = 1; i < n; i++) spins[i] = mask & (1 << (i - 1)) ? -1 : 1;
    const score = cutOf(spins, edges);
    if (score > best) {
      best = score;
      bestSpins = spins.slice();
    }
  }
  return { cut: Number.isFinite(best) ? best : 0, spins: bestSpins };
}

export function sweep(spins: Int8Array, edges: Edge[], temperature: number, rng: Rng): void {
  const n = spins.length;
  for (let k = 0; k < n; k++) {
    const i = Math.floor(rng.next() * n);
    const change = deltaH(spins, edges, i);
    if (change <= 0 || (temperature > 0 && rng.next() < Math.exp(-change / temperature))) {
      spins[i] = -spins[i];
    }
  }
}

export function anneal(n: number, edges: Edge[], seed: number): { cut: number; spins: Int8Array; temperature: number } {
  const rng = new Rng(seed);
  const spins = new Int8Array(n);
  spins.fill(1);
  let best = cutOf(spins, edges);
  let bestSpins = spins.slice();
  const scale = edges.reduce((max, edge) => Math.max(max, Math.abs(edge.w)), 1);
  let temperature = scale * 3;
  while (temperature > 0.02) {
    sweep(spins, edges, temperature, rng);
    const score = cutOf(spins, edges);
    if (score > best) {
      best = score;
      bestSpins = spins.slice();
    }
    temperature *= 0.97;
  }
  return { cut: best, spins: bestSpins, temperature: 0 };
}

export function openingTemperature(edges: Edge[]): number {
  const scale = edges.reduce((max, edge) => Math.max(max, Math.abs(edge.w)), 1);
  return scale * 3;
}
