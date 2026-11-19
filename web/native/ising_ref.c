/* Same checkerboard Metropolis kernel as src/sim/reference.ts.
   Build, when emscripten is installed:

   emcc native/ising_ref.c -O2 -s STANDALONE_WASM=1 \
     -s EXPORTED_FUNCTIONS=_ising_init,_ising_set_temp,_ising_sweep,_ising_energy,_ising_mag,_ising_ptr \
     --no-entry -o public/ising.wasm

   This is the reference kernel, not a Verilator image of the FPGA. */

#include <math.h>
#include <stdint.h>

enum { MAX_N = 256 };

static int8_t spins[MAX_N * MAX_N];
static uint32_t rng_state = 1;
static int side = 64;
static float temperature = 2.1f;

static uint32_t xorshift(void) {
  uint32_t x = rng_state;
  x ^= x << 13;
  x ^= x >> 17;
  x ^= x << 5;
  rng_state = x;
  return x;
}

static float unit(void) {
  return (xorshift() >> 0) / 4294967296.0f;
}

void ising_init(int n, unsigned seed) {
  if (n < 2) n = 2;
  if (n > MAX_N) n = MAX_N;
  side = n;
  rng_state = seed ? seed : 1;
  for (int i = 0; i < side * side; i++) spins[i] = unit() < 0.5f ? -1 : 1;
}

void ising_set_temp(float t) { temperature = t; }

static int at(int x, int y) {
  x = (x + side) % side;
  y = (y + side) % side;
  return spins[y * side + x];
}

void ising_sweep(void) {
  for (int parity = 0; parity < 2; parity++) {
    for (int y = 0; y < side; y++) {
      for (int x = 0; x < side; x++) {
        if (((x + y) & 1) != parity) continue;
        int s = at(x, y);
        int sum = at(x + 1, y) + at(x - 1, y) + at(x, y + 1) + at(x, y - 1);
        int delta = 2 * s * sum;
        int accept = delta <= 0 || (temperature > 0.0f && unit() < expf(-(float)delta / temperature));
        if (accept) spins[y * side + x] = (int8_t)(-s);
      }
    }
  }
}

float ising_energy(void) {
  int bonds = 0;
  for (int y = 0; y < side; y++) {
    for (int x = 0; x < side; x++) {
      int s = spins[y * side + x];
      bonds += s * at(x + 1, y) + s * at(x, y + 1);
    }
  }
  return -(float)bonds / (float)(side * side);
}

float ising_mag(void) {
  int sum = 0;
  for (int i = 0; i < side * side; i++) sum += spins[i];
  return (float)sum / (float)(side * side);
}

int ising_ptr(void) { return (int)(intptr_t)spins; }
