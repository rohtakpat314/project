# Stochastic Ising Engine

A configurable simulated-annealing engine for weighted Max-Cut, implemented in SystemVerilog on a Cyclone V. The first working system is a single processing element. A second configuration updates several spins per cycle, restricted to vertices that do not share an edge.

## Problem

Let \(G = (V, E)\) be an undirected weighted graph with \(|V| \le 256\) and degree at most 16. Each vertex carries a spin \(s_i \in \{-1,+1\}\).

\[
C(s) = \sum_{(i,j) \in E} w_{ij} \frac{1 - s_i s_j}{2}, \qquad H(s) = -C(s)
\]

The engine minimizes \(H\). The change from flipping spin \(i\), evaluated on the pre-flip state, is

\[
\Delta H_i = -s_i \sum_{j \in N(i)} w_{ij} s_j
\]

The move is accepted when \(\Delta H_i \le 0\), and otherwise with probability \(e^{-\Delta H_i / T}\). A positive \(\Delta H_i\) is uphill. Weights are symmetric. Each undirected edge is stored in both adjacency lists.

## Evaluation

1. On recorded uniform draws, one processing element matches the C++ model on \(\Delta H\) and on the accept bit.
2. Time-to-target, same schedule, across seeds: the C++ annealer, one element, and two or four elements on precolored independent sets. Median and spread are both reported. A build that updates adjacent spins in the same cycle is included so the effect on solution quality is visible.
3. Post-place-and-route frequency, ALM count, M10K use, DSP use, and estimated dynamic power, taken from the Quartus reports.

Flip rate is logged with the other counters. It is not used as the figure of merit.

## Platform

DE1-SoC, device 5CSEMA5F31C6N. Annealing runs in the fabric. The on-chip ARM is unused. The existing RISC-V core is the host once the memory map is in place. Until then, simulation loads the graph.

Planned capacity, to be confirmed against the memory report before it is treated as final:

- 256 vertices, 16 neighbors, signed weights of 8 or 16 bits
- one, two, or four processing elements

Cuts known to be optimal are used only where the instance is small enough to solve. Larger instances are compared to a long reference run.

## Datapath

1. Read \(s_i\), the degree, and the neighbor pointer.
2. Accumulate \(\sum_j w_{ij} s_j\) in a wide signed integer. Overflow sets a sticky flag.
3. Form \(\Delta H_i\).
4. Accept immediately if \(\Delta H_i \le 0\). Otherwise draw \(r \in [0,1)\) and accept if \(r < \widehat{P}(\Delta H_i, T)\).
5. On acceptance, store \(-s_i\) and add \(-\Delta H_i\) to the running cut.

\(\widehat{P}\) is a lookup table. Its maximum absolute error against \(e^{-\Delta H/T}\), over the \((\Delta H, T)\) range the schedule can produce, is measured in C++ before the table is used in RTL.

The host loads \(T_0\), \(\alpha\), and \(T_{\text{final}}\) for the schedule \(T \leftarrow \alpha T\). The best spin configuration and the best cut remain on the chip. Initial \(C\) is loaded from software. A check recomputes the cut from the final spins.

## Parallel updates

A cycle updates an independent set only. Software colors the graph and writes one list of vertex indices per color. The scheduler walks one list at a time. Elements draw distinct indices from the active list.

Coloring stays in software. An implementation that ignores the coloring is retained as a comparison, not as the default configuration.

CSR banking is considered only if a single-element run shows the neighbor read limiting the pipeline.

## Random streams

Each element has its own 32-bit xorshift stream. Seeds are programmable. The single-element tests replay the C++ uniforms, so acceptance is bit-exact. Parallel runs are compared by the distribution of the best cut over seeds.

At fixed \(\Delta H / T\), measured acceptance frequency is checked against the table.

## Host interface

The map is fixed when RTL begins:

- CSR write
- initial spins, \(T_0\), \(\alpha\), iteration counts
- color-class lists
- start, stop, and busy
- best cut, best spins, accept count, reject count, cycle count

AXI4-Lite is used when the engine is attached to the RISC-V core. A ready/valid port is sufficient in simulation.

## Reference model

The C++ model precedes the corresponding RTL:

- \(\Delta H\) and \(C\) on a two-vertex graph and on a triangle with unequal weights
- one annealing trace with stored uniforms
- a check that every color class is an independent set
- time-to-target for the sequential annealer

Hardware and software use the same schedule and the same stopping rule.

## Implementation order

1. Reference model, recorded trace, and coloring check.
2. Single element in simulation, bit-exact against that trace. Incremental cut checked by a full recompute.
3. Colored parallel simulation. Time-to-target for one, two, and four elements, and for the adjacent-update comparison.
4. Quartus timing and resource reports. One small graph rerun on the board and compared to simulation.
5. RISC-V host load and readout, without changing the annealer.

Parallel tempering, coloring in hardware, and a wider array follow only after step 3.

## Design record

| Choice | Alternative set aside | Reason |
| --- | --- | --- |
| Minimize \(H\), with the \(\Delta H\) above | Treat the cut delta as the Metropolis energy | The cut delta has the opposite sign |
| Software coloring, one independent set at a time | Concurrent updates of neighbors | Those updates do not implement the same chain |
| Time-to-target over seeds | Flip rate | Flip rate can rise while cut quality falls |
| One xorshift stream per element | A generator study as a gating milestone | Acceptance statistics are checked; a second generator can wait |
| Lookup-table probability, error reported | A floating-point exponential | The table error is the quantity to bound |
| Up to four elements, degree 16 | Wider arrays, on-chip coloring | Those depend on the step-3 measurements |
