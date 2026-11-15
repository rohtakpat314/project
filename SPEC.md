# Stochastic Ising Engine

`model/ising.cpp` scores a weighted graph and searches by flipping one spin at a time. A flip is kept only when it raises the cut. The search repeats until a full pass flips nothing.

The hardware design is not in this tree. There is no Verilog, no register map, and no temperature schedule. This file describes the program that compiles and runs today.

## Graph

A `Graph` holds three things:

- `n`, the vertex count
- `spin`, one entry per vertex, each `+1` or `-1`
- `adj`, one neighbor list per vertex

Each neighbor entry is a pair. The first number is the other vertex. The second number is the weight. `make_graph(n)` builds `n` vertices, sets every spin to `+1`, and leaves every list empty. The cut of that blank graph is 0.

`add_edge(graph, a, b, weight)` appends `(b, weight)` to vertex `a` and `(a, weight)` to vertex `b`. One undirected edge lives in both lists. `cut` skips the copy whose neighbor index is smaller, so each edge is scored once. `change_energy` reads only the flipped vertex's list, so it uses every copy in that list.

## Cut

Spins are $s_i \in \{-1,+1\}$. The cut is

$$
C(s) = \sum_{(i,j) \in E} w_{ij} \frac{1 - s_i s_j}{2}
$$

Agreeing spins have product `+1`, and that edge adds nothing. Disagreeing spins have product `-1`, and that edge adds its weight. A negative weight lowers the cut when the edge is cut.

`cut` walks every vertex, and inside that vertex walks `adj[i]`. The loop skips a pair when the neighbor index is less than `i`.

## Energy change

Energy is the negative of the cut, $H(s) = -C(s)$. Flipping spin `i` and leaving every other spin in place changes the energy by

$$
\Delta H_i = -s_i \sum_{j \in N(i)} w_{ij} s_j
$$

`change_energy(graph, i)` returns that number. It does not flip the spin. The sum is `weight * neighbor spin` for each pair in `adj[i]`. The return multiplies the sum by `-spin[i]`.

A negative return means the cut would rise. A positive return means the cut would fall. Zero means the cut would stay the same.

## Sweep

`sweep` is a downhill search.

```text
changed starts true
while changed:
    changed = false
    for each vertex i:
        if change_energy(graph, i) < 0:
            flip spin i
            changed = true
            keep this cut and these spins if the cut is the best so far
copy the best spins back onto the graph
```

A return of zero does not flip. Flipping a zero-change spin would let the same vertex flip on every later pass.

The loop stops when a pass flips nothing. That split is one where every single flip would lower the cut or leave it unchanged. It can be short of the best split in the graph. Further passes do not climb out of it.

On each accepted flip the running spins change before the next vertex is scored. A vertex skipped early in a pass can become worth flipping on the next pass.

## The run

`main` builds three vertices and two edges.

| Edge | Weight |
| --- | --- |
| 0 to 1 | -5 |
| 1 to 2 | 10 |

Every spin starts at `+1`. The checked output is:

```text
pass 1
vertex 0 return 5 spins 1 1 1 cut 0
vertex 1 return -5 flip spins 1 -1 1 cut 5
vertex 2 return 10 spins 1 -1 1 cut 5
pass 2
vertex 0 return -5 flip spins -1 -1 1 cut 10
vertex 1 return 15 spins -1 -1 1 cut 10
vertex 2 return 10 spins -1 -1 1 cut 10
pass 3
vertex 0 return 5 spins -1 -1 1 cut 10
vertex 1 return 15 spins -1 -1 1 cut 10
vertex 2 return 10 spins -1 -1 1 cut 10
stop
```

Pass 1 flips vertex 1. The cut is 5, because the weight-10 edge is cut and the weight -5 edge is cut too. Pass 2 flips vertex 0. Vertices 0 and 1 then agree, the negative edge stops subtracting, and the cut is 10. Pass 3 flips nothing, so the search stops. The saved spins are `-1 -1 +1`.

This run was compiled and executed with the Visual Studio 2026 Build Tools compiler. From `c:\quant` in PowerShell:

```powershell
cmd /c 'call "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat" && cl /nologo /EHsc /std:c++17 /Fo:C:\quant\ /Fe:C:\quant\ising.exe C:\quant\model\ising.cpp && C:\quant\ising.exe'
```

`g++ -std=c++17 -o ising.exe model/ising.cpp` is the same check where `g++` is on the path. Any line that differs from the block above is a failed run.

## Not in this program

- An uphill flip is never kept. There is no temperature and no random draw.
- The search does not list the $2^{n-1}$ distinct splits.
- No coloring, no second copy of the spins, and no hardware build.
