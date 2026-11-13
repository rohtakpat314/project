# Stochastic Ising Engine

A simulated-annealing accelerator for weighted Max-Cut on a Cyclone V. Spin state resides in on-chip memory. The fabric proposes single-spin flips under the Metropolis rule and keeps the best cut seen. A RISC-V host loads the graph and reads the result.

Parallel flips are issued only within an independent set, colored in software. The study compares time-to-target across a C++ annealer, a single processing element, and a small parallel array.

Design notes are in [SPEC.md](SPEC.md).

Platform: Terasic DE1-SoC (Cyclone V SE). Implementation language: SystemVerilog. Tools: Quartus Prime and a C++ reference.

## Layout

```text
README.md
SPEC.md
model/ising.cpp          reference annealer and graph coloring
model/graphs/            instances, including small graphs with known cuts
tb/cocotb/test_pe.py     single element against recorded draws
tb/cocotb/test_parallel.py
rtl/pe.sv                local energy and acceptance
rtl/graph_mem.sv
rtl/prng.sv
rtl/schedule.sv
rtl/top.sv
fpga/de1_soc/            pin constraints, clocks, Quartus project
```

## Status

Specification only.
