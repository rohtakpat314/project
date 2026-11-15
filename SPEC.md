# Stochastic Ising Engine

One processing element first. Then two or four, flipping spins that do not share an edge. Annealing runs in the Cyclone V fabric on a DE1-SoC (5CSEMA5F31C6N). The on-chip ARM stays unused. Simulation loads the graph until a RISC-V core is attached. The annealer does not change when that wrapper is added.

Capacity, checked against the Quartus memory report before it is treated as final: 256 vertices, degree at most 16, signed weights stored in 16 bits, one to four processing elements.

Out of this design: parallel tempering, coloring in hardware, a wider array, a second random generator.

## Modules

```text
model/ising.cpp           golden cut, delta, coloring, table, schedule
model/graphs/             K2, the unequal triangle, then larger graphs
rtl/pe.sv                 one Metropolis trial
rtl/graph_mem.sv         four adjacency banks and the spin replicas
rtl/prng.sv               one xorshift32
rtl/schedule.sv           T update
rtl/top.sv                scheduler, N elements, register port
tb/cocotb/test_pe.py      one element against a recorded trace
tb/cocotb/test_parallel.py
fpga/de1_soc/             clocks, pins, Quartus project
```

`N` is a parameter on `top`. A one-element build and a four-element build are the same RTL.

## Objective the RTL implements

Spins are \(s_i \in \{-1,+1\}\). The cut and the energy are

$$
C(s) = \sum_{(i,j) \in E} w_{ij} \frac{1 - s_i s_j}{2}, \qquad H(s) = -C(s)
$$

The engine minimizes \(H\). Flipping spin \(i\) on the pre-flip state changes it by

$$
\Delta H_i = -s_i \sum_{j \in N(i)} w_{ij} s_j
$$

\(\Delta H_i \le 0\) is accepted. An uphill move is accepted with probability \(e^{-\Delta H_i / T}\). The cut delta has the opposite sign, so the accept test uses \(\Delta H\), not \(\Delta C\).

Weights are symmetric. Each undirected edge is stored in both adjacency lists. On an accept, the spin becomes \(-s_i\) and the running cut adds \(-\Delta H_i\).

## Processing element

`pe.sv` is a small state machine. The neighbor walk is one weight per clock, at most 16 clocks. The divider runs only after that walk, and only on an uphill move.

| State | What it does |
| --- | --- |
| `IDLE` | Wait for `issue_valid`. Latch the vertex id. |
| `HDR` | Read degree and the local pointer from that vertex's bank. |
| `WALK` | Each clock: read one neighbor word, add or subtract the weight according to the neighbor spin. A legal 16-bit instance fits in a signed 20-bit sum. Overflow sets a sticky flag and does not wrap. |
| `DELTA` | \(\Delta H_i\) from the sum and \(s_i\). \(\Delta H_i \le 0\) goes to `COMMIT`. Otherwise go to `DIV`. |
| `DIV` | Restoring divider, at most 36 clocks. A zero temperature sets the sticky flag and does not divide. |
| `DRAW` | Read \(\hat P\), step the xorshift, compare. |
| `COMMIT` | Broadcast the flipped spin. Add \(-\Delta H_i\) to the running cut if the move was accepted. Update the best cut and the best spins if this cut wins. Return to `IDLE` with `done`. |

The running cut, the best cut, and the initial cut are signed 32-bit. The host loads the initial cut. After a run, software recomputes the cut from the final spins.

Handshake with `top`:

- in: `issue_valid`, `vertex_id`
- out: `pe_ready`, `done`, `accepted`, `delta_h`
- memory: request a neighbor read, get the word back from `graph_mem`

No multiplier on the walk. A neighbor spin of \(+1\) adds the weight. A neighbor spin of \(-1\) subtracts it.

## Memory

Spins are one bit. Stored `0` means \(-1\), stored `1` means \(+1\). Each element has its own 256-bit copy, so a walk does not fight the other elements for a spin port. An accepted flip is broadcast to every copy.

Adjacency is banked by the source vertex: vertex \(v\) and its whole neighbor list live in bank \(v \bmod 4\). Each bank holds 64 vertices and 1024 neighbor slots. That is the maximum degree sum of those 64 vertices, so a legal list cannot overflow the bank.

| Word | Fields |
| --- | --- |
| Vertex record, 32 bits | degree `[4:0]`, pointer `[14:5]` into this bank's 1024 slots |
| Neighbor word, 32 bits | index `[7:0]`, signed weight `[23:8]`, `[31:24]` unused |

An 8-bit weight is sign-extended into the 16-bit field. One datapath covers both widths.

Each bank is true dual-port. During a run, port A is the walk and port B is idle. The host loads the graph on port B before `start`. A crossbar lets any element read any bank. The scheduler issues at most one read to a bank per clock. Two vertices in the same bank in the same clock means one of them waits. Coloring does not remove that wait. It only means the spins being flipped are not neighbors of each other.

Bit count of the four banks, records plus lists: 139264 bits. If each bank is one memory, that is about 16 M10K blocks. The fitter number replaces this estimate.

Color lists are separate and small: 256 vertex indices and 32 descriptors of base and length. Greedy coloring of a degree-16 graph uses at most 17 colors.

## Scheduler

Software colors the graph and writes one list of vertex indices per color. `top` walks one list at a time.

A free element may take the next vertex in the current color whose bank is not already being read this clock. Another vertex of the same color may start as soon as an element is free. The next color does not start until every trial of the current color has written back. Inside a color, a writeback does not change anyone else's local field. Across a color boundary, it does.

`color_bypass` turns that rule off. Vertices are then issued in index order, in blocks of \(N\), including blocks that contain edges. That build exists so we can see the bad cut. It is not the default.

## Acceptance table and schedule

The table is 192 entries, copied into each element, indexed by the ratio rather than by the pair \((\Delta H, T)\).

Temperature is an unsigned 20.12 word \(T_{\mathrm{raw}}\), meaning \(T = T_{\mathrm{raw}} / 2^{12}\). \(\alpha\) is an unsigned 0.16 word. `schedule.sv` steps

$$
T_{\mathrm{raw}} \leftarrow (\alpha \, T_{\mathrm{raw}}) \gg 16
$$

with a 16-step shift-add, not a DSP multiply. The run stops once \(T_{\mathrm{raw}}\) falls below \(T_{\mathrm{final}}\). For the first experiments, \(T_{\mathrm{final}} = 2^{-4}\) (raw value 256) and \(\alpha = 62259\). Each temperature is held for a host-loaded sweep count. One sweep proposes one flip at every vertex.

For an uphill move the index is

$$
q = \min\left(\left\lfloor \frac{\Delta H \cdot 2^{16}}{T_{\mathrm{raw}}} \right\rfloor, 192\right)
$$

Entry \(q < 192\) is the 16-bit round-to-nearest value of \(e^{-(q + 1/2)/16}\). Index 192 stores 0. No interpolation. `ising.cpp` emits the table as a hex file. The RTL and the model both read that file. The model also prints the maximum absolute error of the table against \(e^{-\Delta H / T}\) on the temperatures this schedule actually visits.

## Random draws

`prng.sv` is xorshift32 with shifts 13, 17, 5. The state is 32 bits, programmable, and forced to 1 if the host writes 0.

A table entry \(P\) accepts when the new state \(R\) satisfies \(R < (P \ll 16)\). Only the top 16 bits of \(R\) matter.

The single-element test does not use this generator. The cocotb test feeds the uniforms recorded by the C++ model, and both sides use the same table, so \(\Delta H\) and the accept bit match. Parallel runs use one stream per element.

## Host port

Simulation uses a ready/valid register port. The RISC-V attachment is an AXI4-Lite slave with the same words, added after the annealer already matches simulation.

| Offset | Name | Access | Contents |
| --- | --- | --- | --- |
| `0x00` | `CTRL` | RW | bit 0 `start`, bit 1 `stop`, bit 2 `busy` (read), bit 3 sticky overflow (read), bit 4 `color_bypass` |
| `0x04` | `NVERT` | RW | vertex count, 1 to 256 |
| `0x08` | `T` | RW | \(T_{\mathrm{raw}}\) |
| `0x0C` | `ALPHA` | RW | 0.16 cooling factor |
| `0x10` | `TFINAL` | RW | stop threshold |
| `0x14` | `SWEEPS` | RW | sweeps held at each temperature |
| `0x18` | `BEST_CUT` | R | signed best cut |
| `0x1C` | `ACCEPT` | R | accept count |
| `0x20` | `REJECT` | R | reject count |
| `0x24` | `CYCLES` | R | clock count |
| `0x28` | `LOAD_ADDR` | RW | where the next `LOAD_DATA` write goes |
| `0x2C` | `LOAD_DATA` | W | one word, then `LOAD_ADDR` increments |

`LOAD_ADDR[31:28]` selects the region:

| Region | What the low bits address |
| --- | --- |
| 0 | spins, 8 words, 256 bits, broadcast to every replica |
| 1 | vertex records. `[9:8]` bank, `[5:0]` vertex within the bank |
| 2 | neighbor slots. `[11:10]` bank, `[9:0]` slot |
| 3 | color indices, four vertices per word |
| 4 | color descriptors, base and length |
| 5 | initial cut, one signed word |
| 6 | best-spin readout, same packing as region 0 |

`start` is ignored while `busy` is set. `stop` returns every element to `IDLE` and clears `busy`. The sticky overflow flag clears on the next `start`.

## Bring-up

Each step has a check that fails before the next file is trusted.

1. `ising.cpp`. Cut and \(\Delta H\) on a single edge of weight 1, and on a triangle with weights 1, 2, 3 (best cut 5). Greedy coloring in vertex order. A color class that contains an edge is a failed run. Emit the probability hex file and one annealing trace: per trial, the vertex, \(\Delta H\), the uniform, and the accept bit.
2. `pe.sv` plus a behavioral memory, driven by `test_pe.py`. Replay that trace. The element's \(\Delta H\) and accept bit match the file. Recompute the cut from the final spins and compare it with the running sum.
3. `graph_mem.sv`. Host writes on port B, an element reads on port A, and a second read to a busy bank waits. Then replicate the bank four times with the crossbar.
4. `prng.sv` and `schedule.sv`. A few dozen xorshift steps match the C++ stream. A few dozen cooling steps match the integer recurrence.
5. `top.sv` with `N = 1`, then `N = 2` and `N = 4`. The scheduler keeps the color barrier. `test_parallel.py` runs a colored graph and the `color_bypass` build on the same trace of proposals.
6. Quartus, on the DE1-SoC project. Record frequency, ALMs, M10K, DSP, and the power estimate. Rerun the 8-by-8 grid in hardware and compare it with simulation.
7. AXI4-Lite wrapper around the same register port. No change inside `pe` or the scheduler.

Flip rate is the accept count over the cycle count. It is logged. The number we look at is whether the best cut matches the model.
