import { EXAMPLES, anneal, cutOf, deltaH, exactBest, parseEdges, readProblem, SPOKEN } from "../src/solve/cut.ts";
import { createLattice, energyPerSpin, magnetisation, sweepLattice, XorShift32 } from "../src/sim/reference.ts";

const n = 32;
const aligned = new Int8Array(n * n);
aligned.fill(1);
if (Math.abs(energyPerSpin(aligned, n) + 2) > 1e-9) throw new Error("all-up energy");
if (Math.abs(magnetisation(aligned, n) - 1) > 1e-9) throw new Error("all-up magnetisation");

const cold = aligned.slice();
sweepLattice(cold, n, 0.01, new XorShift32(7));
if (cold.some((s, i) => s !== aligned[i])) throw new Error("cold sweep moved the ground state");

const mixed = createLattice(n, 3);
const before = energyPerSpin(mixed, n);
sweepLattice(mixed, n, 0, new XorShift32(9));
const after = energyPerSpin(mixed, n);
if (after > before + 1e-9) throw new Error("zero temperature raised the energy");
if (!Number.isFinite(after) || Math.abs(magnetisation(mixed, n)) > 1) throw new Error("range");

console.log("reference ok", after.toFixed(4), magnetisation(mixed, n).toFixed(4));

const seven = parseEdges(EXAMPLES.seven.text, EXAMPLES.seven.n);
if (seven.error) throw new Error(seven.error);
const allUp = new Int8Array(EXAMPLES.seven.n);
allUp.fill(1);
if (deltaH(allUp, seven.edges, 1) !== -5) throw new Error("vertex 1 field");
if (cutOf(allUp, seven.edges) !== 0) throw new Error("all-up cut");
const best = exactBest(EXAMPLES.seven.n, seven.edges);
if (best.cut !== 18) throw new Error(`seven best ${best.cut}`);
for (const seed of [1, 2, 3, 9]) {
  const found = anneal(EXAMPLES.seven.n, seven.edges, seed);
  if (found.cut !== 18) throw new Error(`anneal seed ${seed} cut ${found.cut}`);
}
const path = parseEdges(EXAMPLES.path.text, EXAMPLES.path.n);
const pathBest = exactBest(EXAMPLES.path.n, path.edges);
if (pathBest.cut !== 10) throw new Error(`path best ${pathBest.cut}`);
const spoken = readProblem(SPOKEN.seven);
if (spoken.error) throw new Error(spoken.error);
if (spoken.n !== 7 || spoken.edges.length !== 8) throw new Error("spoken shape");
if (exactBest(spoken.n, spoken.edges).cut !== 18) throw new Error("spoken best");
const spokenPath = readProblem(SPOKEN.path);
if (exactBest(spokenPath.n, spokenPath.edges).cut !== 10) throw new Error("spoken path");
console.log("cut ok", best.cut);
