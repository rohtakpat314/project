export type Sample = {
  energy: number;
  mag: number;
  flips: number;
};

export type EngineKind = "webgpu" | "webgl2";

export interface LatticeEngine {
  readonly kind: EngineKind;
  setTemperature(t: number): void;
  resize(n: number, pixels: Uint8Array): void;
  upload(pixels: Uint8Array): void;
  step(frame: number): void;
  draw(): void;
  readStats(): Promise<Sample | null>;
  destroy(): void;
}
