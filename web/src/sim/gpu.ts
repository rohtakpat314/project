import type { Sample } from "./types";

const UPDATE = /* wgsl */ `
struct Params {
  size: u32,
  parity: u32,
  seed: u32,
  frame: u32,
  temperature: f32,
  decay: f32,
  pad0: f32,
  pad1: f32,
}

@group(0) @binding(0) var src_tex: texture_2d<f32>;
@group(0) @binding(1) var dst_tex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params: Params;

fn pcg(x: u32) -> u32 {
  let state = x * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

fn spin_at(p: vec2i) -> f32 {
  let n = i32(params.size);
  let x = (p.x + n) % n;
  let y = (p.y + n) % n;
  let v = textureLoad(src_tex, vec2i(x, y), 0).r;
  return select(-1.0, 1.0, v > 0.5);
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let x = gid.x;
  let y = gid.y;
  if (x >= params.size || y >= params.size) { return; }
  let p = vec2i(i32(x), i32(y));
  let here = textureLoad(src_tex, p, 0);
  if (((x + y) & 1u) != params.parity) {
    textureStore(dst_tex, p, here);
    return;
  }
  let s = select(-1.0, 1.0, here.r > 0.5);
  let sum = spin_at(p + vec2i(1, 0)) + spin_at(p + vec2i(-1, 0)) + spin_at(p + vec2i(0, 1)) + spin_at(p + vec2i(0, -1));
  let delta = 2.0 * s * sum;
  let h = pcg(params.seed ^ (x * 1664525u) ^ (y * 2246822519u) ^ (params.frame * 1013904223u) ^ params.parity);
  let rnd = f32(h) / 4294967296.0;
  let accept = delta <= 0.0 || (params.temperature > 0.0 && rnd < exp(-delta / params.temperature));
  var out = here;
  if (accept) {
    out = vec4f(select(1.0, 0.0, here.r > 0.5), 1.0, 0.0, 1.0);
  } else {
    out.g = here.g * params.decay;
  }
  textureStore(dst_tex, p, out);
}
`;

const STATS = /* wgsl */ `
struct SizeOnly { n: u32, pad0: u32, pad1: u32, pad2: u32 }
@group(0) @binding(0) var src_tex: texture_2d<f32>;
@group(0) @binding(1) var<uniform> size_only: SizeOnly;
@group(0) @binding(2) var<storage, read_write> stats: array<atomic<i32>>;

fn spin_of(p: vec2i, n: i32) -> i32 {
  let x = (p.x + n) % n;
  let y = (p.y + n) % n;
  let v = textureLoad(src_tex, vec2i(x, y), 0).r;
  return select(-1, 1, v > 0.5);
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let n = size_only.n;
  if (gid.x >= n || gid.y >= n) { return; }
  let p = vec2i(i32(gid.x), i32(gid.y));
  let s = spin_of(p, i32(n));
  let bonds = s * spin_of(p + vec2i(1, 0), i32(n)) + s * spin_of(p + vec2i(0, 1), i32(n));
  let heat = textureLoad(src_tex, p, 0).g;
  atomicAdd(&stats[0], s);
  atomicAdd(&stats[1], bonds);
  if (heat > 0.96) { atomicAdd(&stats[2], 1); }
}
`;

const FULLSCREEN = /* wgsl */ `
struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VsOut {
  let x = f32((i << 1u) & 2u);
  let y = f32(i & 2u);
  var out: VsOut;
  out.pos = vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  out.uv = vec2f(x, y);
  return out;
}
`;

const PRESENT = /* wgsl */ `
${FULLSCREEN}

@group(0) @binding(0) var lattice: texture_2d<f32>;
struct Screen {
  lattice: u32,
  width: u32,
  height: u32,
  pad: u32,
}

@group(0) @binding(1) var<uniform> screen: Screen;

fn spin_px(p: vec2i, n: i32) -> f32 {
  let x = (p.x + n) % n;
  let y = (p.y + n) % n;
  return select(-1.0, 1.0, textureLoad(lattice, vec2i(x, y), 0).r > 0.5);
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let n = i32(screen.lattice);
  let nf = f32(n);
  let res = vec2f(f32(screen.width), f32(screen.height));
  let bg = vec3f(0.027, 0.031, 0.043);
  let top = 156.0;
  let foot = min(res.y * 0.40, 248.0);
  let side = min(res.x - 28.0, res.y - top - foot);
  let origin = vec2f((res.x - side) * 0.5, top);
  let p = (pos.xy - origin) / side;
  if (p.x < 0.0 || p.y < 0.0 || p.x >= 1.0 || p.y >= 1.0) {
    return vec4f(bg, 1.0);
  }
  let g = p * nf;
  let cell = vec2i(g);
  let f = fract(g);
  let s = spin_px(cell, n);
  let cell_px = side / nf;
  let aa = 1.35 / cell_px;
  let hop_x = select(-1, 1, f.x >= 0.5);
  let hop_y = select(-1, 1, f.y >= 0.5);
  let other_h = spin_px(cell + vec2i(hop_x, 0), n);
  let other_v = spin_px(cell + vec2i(0, hop_y), n);
  let cut_h = s != other_h;
  let cut_v = s != other_v;
  let agree_w = max(0.03, 1.15 / cell_px);
  let cut_w = max(0.075, 2.3 / cell_px);
  let hw = select(agree_w, cut_w, cut_h);
  let vw = select(agree_w, cut_w, cut_v);
  let ah = 1.0 - smoothstep(hw, hw + aa, abs(f.y - 0.5));
  let av = 1.0 - smoothstep(vw, vw + aa, abs(f.x - 0.5));
  let agree_c = vec3f(0.46, 0.43, 0.38);
  let cut_c = vec3f(0.98, 0.72, 0.38);
  let hcol = select(agree_c, cut_c, cut_h);
  let vcol = select(agree_c, cut_c, cut_v);
  var col = bg;
  if (ah >= av) {
    col = mix(col, vcol, av);
    col = mix(col, hcol, ah);
  } else {
    col = mix(col, hcol, ah);
    col = mix(col, vcol, av);
  }
  let wrapped = vec2i((cell.x + n) % n, (cell.y + n) % n);
  let trail = textureLoad(lattice, wrapped, 0).g;
  var node = select(vec3f(0.86, 0.47, 0.34), vec3f(0.52, 0.60, 0.96), s > 0.0);
  node = mix(node, vec3f(1.0, 0.93, 0.82), trail * 0.5);
  let radius = max(0.24, 3.2 / cell_px);
  let an = 1.0 - smoothstep(radius, radius + aa, length(f - vec2f(0.5)));
  col = mix(col, node, an);
  return vec4f(col, 1.0);
}
`;

const EXTRACT = /* wgsl */ `
${FULLSCREEN}
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let c = textureSample(src, samp, uv).rgb;
  let l = max(c.r, max(c.g, c.b));
  let k = max(l - 0.55, 0.0);
  return vec4f(c * k / max(l, 0.0001), 1.0);
}
`;

const BLUR = /* wgsl */ `
${FULLSCREEN}
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
struct Blur {
  dir: vec2f,
  texel: vec2f,
}
@group(0) @binding(2) var<uniform> blur: Blur;

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let w = array<f32, 5>(0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
  var c = textureSample(src, samp, uv) * w[0];
  for (var i: i32 = 1; i < 5; i = i + 1) {
    let o = blur.dir * blur.texel * f32(i);
    c = c + textureSample(src, samp, uv + o) * w[i];
    c = c + textureSample(src, samp, uv - o) * w[i];
  }
  return c;
}
`;

const COMPOSITE = /* wgsl */ `
${FULLSCREEN}
@group(0) @binding(0) var base_tex: texture_2d<f32>;
@group(0) @binding(1) var half_tex: texture_2d<f32>;
@group(0) @binding(2) var wide_tex: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;

fn aces(x: vec3f) -> vec3f {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let base = textureSample(base_tex, samp, uv).rgb;
  let half = textureSample(half_tex, samp, uv).rgb;
  let wide = textureSample(wide_tex, samp, uv).rgb;
  var col = aces(base + half * 0.35 + wide * 0.22);
  let v = smoothstep(0.92, 0.35, length(uv - vec2f(0.5)));
  col = col * mix(0.78, 1.0, v);
  return vec4f(col, 1.0);
}
`;

function align(n: number): number {
  return Math.max(1, n);
}

async function assertShaders(device: GPUDevice, codes: string[]): Promise<void> {
  const modules = codes.map((code) => device.createShaderModule({ code }));
  const infos = await Promise.all(modules.map((mod) => mod.getCompilationInfo()));
  const messages = infos.flatMap((info) => info.messages.filter((m) => m.type === "error"));
  if (messages.length) throw new Error(messages.map((m) => m.message).join("\n"));
}

export class GpuLattice {
  readonly kind = "webgpu" as const;
  private n = 64;
  private temperature = 2.1;
  private seed = 1;
  private statsBusy = false;
  private dead = false;

  private constructor(
    private device: GPUDevice,
    private context: GPUCanvasContext | null,
    private lattice: [GPUTexture, GPUTexture],
    private groups: [GPUBindGroup, GPUBindGroup],
    private updatePipeline: GPUComputePipeline,
    private statsPipeline: GPUComputePipeline,
    private statsGroup: GPUBindGroup,
    private params: GPUBuffer,
    private statsBuf: GPUBuffer,
    private staging: GPUBuffer,
    private sizeBuf: GPUBuffer,
    private present: Presenter,
  ) {}

  static async create(canvas: HTMLCanvasElement): Promise<GpuLattice | null> {
    const gpu = navigator.gpu;
    if (!gpu) return null;
    const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    const format = gpu.getPreferredCanvasFormat();
    let engine: GpuLattice | null = null;
    try {
    await assertShaders(device, [UPDATE, STATS, PRESENT, EXTRACT, BLUR, COMPOSITE]);

    const updateModule = device.createShaderModule({ code: UPDATE });
    const statsModule = device.createShaderModule({ code: STATS });
    const updateInfo = await updateModule.getCompilationInfo();
    const statsInfo = await statsModule.getCompilationInfo();
    const bad = [...updateInfo.messages, ...statsInfo.messages].filter((m) => m.type === "error");
    if (bad.length) throw new Error(bad.map((m) => m.message).join("\n"));

    const params = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const sizeBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const statsBuf = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    const staging = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });

    const updateLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "write-only", format: "rgba8unorm" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      ],
    });
    const updatePipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [updateLayout] }),
      compute: { module: updateModule, entryPoint: "main" },
    });
    const statsLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      ],
    });
    const statsPipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [statsLayout] }),
      compute: { module: statsModule, entryPoint: "main" },
    });

    const lattice: [GPUTexture, GPUTexture] = [makeLatticeTex(device, 64), makeLatticeTex(device, 64)];
    const groups: [GPUBindGroup, GPUBindGroup] = [
      bindUpdate(device, updateLayout, lattice[0], lattice[1], params),
      bindUpdate(device, updateLayout, lattice[1], lattice[0], params),
    ];
    const statsGroup = device.createBindGroup({
      layout: statsLayout,
      entries: [
        { binding: 0, resource: lattice[0].createView() },
        { binding: 1, resource: { buffer: sizeBuf } },
        { binding: 2, resource: { buffer: statsBuf } },
      ],
    });
    const present = await Presenter.create(device, format, lattice[0]);
    engine = new GpuLattice(
      device,
      null,
      lattice,
      groups,
      updatePipeline,
      statsPipeline,
      statsGroup,
      params,
      statsBuf,
      staging,
      sizeBuf,
      present,
    );
    const context = canvas.getContext("webgpu");
    if (!context) {
      engine.destroy();
      return null;
    }
    context.configure({ device, format, alphaMode: "opaque" });
    engine.attach(context);
    return engine;
    } catch (err) {
      if (engine) engine.destroy();
      else device.destroy();
      throw err;
    }
  }

  attach(context: GPUCanvasContext): void {
    this.context = context;
    this.present.attach(context);
  }

  setTemperature(t: number): void {
    this.temperature = t;
  }

  resize(n: number, pixels: Uint8Array): void {
    this.n = n;
    this.lattice[0].destroy();
    this.lattice[1].destroy();
    this.lattice = [makeLatticeTex(this.device, n), makeLatticeTex(this.device, n)];
    const layout = this.updatePipeline.getBindGroupLayout(0);
    this.groups = [
      bindUpdate(this.device, layout, this.lattice[0], this.lattice[1], this.params),
      bindUpdate(this.device, layout, this.lattice[1], this.lattice[0], this.params),
    ];
    const statsLayout = this.statsPipeline.getBindGroupLayout(0);
    this.statsGroup = this.device.createBindGroup({
      layout: statsLayout,
      entries: [
        { binding: 0, resource: this.lattice[0].createView() },
        { binding: 1, resource: { buffer: this.sizeBuf } },
        { binding: 2, resource: { buffer: this.statsBuf } },
      ],
    });
    this.present.setLattice(this.lattice[0]);
    this.upload(pixels);
    this.device.queue.writeBuffer(this.sizeBuf, 0, new Uint32Array([n, 0, 0, 0]));
  }

  upload(pixels: Uint8Array): void {
    const n = this.n;
    this.device.queue.writeTexture(
      { texture: this.lattice[0] },
      pixels as unknown as GPUAllowSharedBufferSource,
      { bytesPerRow: n * 4, rowsPerImage: n },
      { width: n, height: n },
    );
  }

  step(frame: number): void {
    this.writeParams(0, frame);
    const even = this.device.createCommandEncoder();
    this.dispatch(even, 0);
    this.device.queue.submit([even.finish()]);
    this.writeParams(1, frame);
    const odd = this.device.createCommandEncoder();
    this.dispatch(odd, 1);
    this.device.queue.submit([odd.finish()]);
  }

  draw(): void {
    if (!this.context) return;
    const canvas = this.context.canvas as HTMLCanvasElement;
    this.present.resize(canvas.width, canvas.height, this.n);
    this.present.draw();
  }

  readStats(): Promise<Sample | null> {
    if (this.statsBusy || this.dead) return Promise.resolve(null);
    this.statsBusy = true;
    const n = this.n;
    this.device.queue.writeBuffer(this.statsBuf, 0, new Int32Array(4));
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(this.statsPipeline);
    pass.setBindGroup(0, this.statsGroup);
    pass.dispatchWorkgroups(Math.ceil(n / 16), Math.ceil(n / 16));
    pass.end();
    enc.copyBufferToBuffer(this.statsBuf, 0, this.staging, 0, 16);
    this.device.queue.submit([enc.finish()]);
    return this.staging
      .mapAsync(GPUMapMode.READ)
      .then(() => {
        const raw = new Int32Array(this.staging.getMappedRange().slice(0));
        this.staging.unmap();
        const cells = n * n;
        this.statsBusy = false;
        return { energy: -raw[1] / cells, mag: raw[0] / cells, flips: raw[2] };
      })
      .catch(() => {
        this.statsBusy = false;
        return null;
      });
  }

  destroy(): void {
    this.dead = true;
    this.lattice[0].destroy();
    this.lattice[1].destroy();
    this.params.destroy();
    this.statsBuf.destroy();
    this.staging.destroy();
    this.sizeBuf.destroy();
    this.present.destroy();
    this.device.destroy();
  }

  private writeParams(parity: number, frame: number): void {
    const data = new ArrayBuffer(32);
    const u = new Uint32Array(data);
    const f = new Float32Array(data);
    u[0] = this.n;
    u[1] = parity;
    u[2] = this.seed >>> 0;
    u[3] = frame >>> 0;
    f[4] = this.temperature;
    f[5] = 0.9;
    this.device.queue.writeBuffer(this.params, 0, data);
  }

  private dispatch(enc: GPUCommandEncoder, which: number): void {
    const pass = enc.beginComputePass();
    pass.setPipeline(this.updatePipeline);
    pass.setBindGroup(0, this.groups[which]);
    pass.dispatchWorkgroups(Math.ceil(this.n / 16), Math.ceil(this.n / 16));
    pass.end();
  }
}

function makeLatticeTex(device: GPUDevice, n: number): GPUTexture {
  return device.createTexture({
    size: { width: n, height: n },
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST,
  });
}

function bindUpdate(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  src: GPUTexture,
  dst: GPUTexture,
  params: GPUBuffer,
): GPUBindGroup {
  return device.createBindGroup({
    layout,
    entries: [
      { binding: 0, resource: src.createView() },
      { binding: 1, resource: dst.createView() },
      { binding: 2, resource: { buffer: params } },
    ],
  });
}

class Presenter {
  private lattice: GPUTexture;
  private hdr: GPUTexture | null = null;
  private halfA: GPUTexture | null = null;
  private halfB: GPUTexture | null = null;
  private wide: GPUTexture | null = null;
  private width = 0;
  private height = 0;
  private latticeSize = 64;
  private screenBuf: GPUBuffer;
  private blurBufs: [GPUBuffer, GPUBuffer, GPUBuffer];

  private constructor(
    private device: GPUDevice,
    private context: GPUCanvasContext | null,
    lattice: GPUTexture,
    private presentPipe: GPURenderPipeline,
    private extractPipe: GPURenderPipeline,
    private blurPipe: GPURenderPipeline,
    private compositePipe: GPURenderPipeline,
    private presentLayout: GPUBindGroupLayout,
    private imageLayout: GPUBindGroupLayout,
    private blurLayout: GPUBindGroupLayout,
    private compositeLayout: GPUBindGroupLayout,
    private sampler: GPUSampler,
    screenBuf: GPUBuffer,
    blurBufs: [GPUBuffer, GPUBuffer, GPUBuffer],
  ) {
    this.lattice = lattice;
    this.screenBuf = screenBuf;
    this.blurBufs = blurBufs;
  }

  static async create(device: GPUDevice, format: GPUTextureFormat, lattice: GPUTexture): Promise<Presenter> {
    const presentMod = device.createShaderModule({ code: PRESENT });
    const extractMod = device.createShaderModule({ code: EXTRACT });
    const blurMod = device.createShaderModule({ code: BLUR });
    const compositeMod = device.createShaderModule({ code: COMPOSITE });
    const messages = (
      await Promise.all([
        presentMod.getCompilationInfo(),
        extractMod.getCompilationInfo(),
        blurMod.getCompilationInfo(),
        compositeMod.getCompilationInfo(),
      ])
    ).flatMap((info) => info.messages.filter((m) => m.type === "error"));
    if (messages.length) throw new Error(messages.map((m) => m.message).join("\n"));

    const presentLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ],
    });
    const imageLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      ],
    });
    const blurLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ],
    });
    const compositeLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      ],
    });
    const target: GPUColorTargetState = { format: "rgba16float" };
    const presentPipe = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [presentLayout] }),
      vertex: { module: presentMod, entryPoint: "vs" },
      fragment: { module: presentMod, entryPoint: "fs", targets: [target] },
    });
    const extractPipe = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [imageLayout] }),
      vertex: { module: extractMod, entryPoint: "vs" },
      fragment: { module: extractMod, entryPoint: "fs", targets: [target] },
    });
    const blurPipe = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [blurLayout] }),
      vertex: { module: blurMod, entryPoint: "vs" },
      fragment: { module: blurMod, entryPoint: "fs", targets: [target] },
    });
    const compositePipe = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [compositeLayout] }),
      vertex: { module: compositeMod, entryPoint: "vs" },
      fragment: { module: compositeMod, entryPoint: "fs", targets: [{ format }] },
    });
    const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
    const screenBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const blurUsage = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;
    const blurBufs: [GPUBuffer, GPUBuffer, GPUBuffer] = [
      device.createBuffer({ size: 16, usage: blurUsage }),
      device.createBuffer({ size: 16, usage: blurUsage }),
      device.createBuffer({ size: 16, usage: blurUsage }),
    ];
    return new Presenter(
      device,
      null,
      lattice,
      presentPipe,
      extractPipe,
      blurPipe,
      compositePipe,
      presentLayout,
      imageLayout,
      blurLayout,
      compositeLayout,
      sampler,
      screenBuf,
      blurBufs,
    );
  }

  attach(context: GPUCanvasContext): void {
    this.context = context;
  }

  setLattice(tex: GPUTexture): void {
    this.lattice = tex;
  }

  resize(width: number, height: number, lattice: number): void {
    this.latticeSize = lattice;
    if (width === this.width && height === this.height && this.hdr) return;
    this.width = align(width);
    this.height = align(height);
    this.hdr?.destroy();
    this.halfA?.destroy();
    this.halfB?.destroy();
    this.wide?.destroy();
    this.hdr = this.rt(this.width, this.height);
    this.halfA = this.rt(Math.max(1, this.width >> 1), Math.max(1, this.height >> 1));
    this.halfB = this.rt(Math.max(1, this.width >> 1), Math.max(1, this.height >> 1));
    this.wide = this.rt(Math.max(1, this.width >> 2), Math.max(1, this.height >> 2));
  }

  draw(): void {
    if (!this.context || !this.hdr || !this.halfA || !this.halfB || !this.wide) return;
    this.device.queue.writeBuffer(this.screenBuf, 0, new Uint32Array([this.latticeSize, this.width, this.height, 0]));
    const view = this.context.getCurrentTexture().createView();
    const enc = this.device.createCommandEncoder();
    this.pass(enc, this.presentPipe, this.presentGroup(), this.hdr.createView(), this.width, this.height);
    this.pass(enc, this.extractPipe, this.imageGroup(this.hdr), this.halfA.createView(), this.halfA.width, this.halfA.height);
    this.blur(enc, 0, this.halfA, this.halfB, [1, 0], [1 / this.halfA.width, 0]);
    this.blur(enc, 1, this.halfB, this.halfA, [0, 1], [0, 1 / this.halfA.height]);
    this.blur(enc, 2, this.halfA, this.wide, [1, 1], [1.6 / this.halfA.width, 1.6 / this.halfA.height]);
    const composite = this.device.createBindGroup({
      layout: this.compositeLayout,
      entries: [
        { binding: 0, resource: this.hdr.createView() },
        { binding: 1, resource: this.halfA.createView() },
        { binding: 2, resource: this.wide.createView() },
        { binding: 3, resource: this.sampler },
      ],
    });
    this.pass(enc, this.compositePipe, composite, view, this.width, this.height);
    this.device.queue.submit([enc.finish()]);
  }

  destroy(): void {
    this.hdr?.destroy();
    this.halfA?.destroy();
    this.halfB?.destroy();
    this.wide?.destroy();
    this.screenBuf.destroy();
    this.blurBufs.forEach((buf) => buf.destroy());
  }

  private rt(width: number, height: number): GPUTexture {
    return this.device.createTexture({
      size: { width, height },
      format: "rgba16float",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
  }

  private presentGroup(): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.presentLayout,
      entries: [
        { binding: 0, resource: this.lattice.createView() },
        { binding: 1, resource: { buffer: this.screenBuf } },
      ],
    });
  }

  private imageGroup(tex: GPUTexture): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.imageLayout,
      entries: [
        { binding: 0, resource: tex.createView() },
        { binding: 1, resource: this.sampler },
      ],
    });
  }

  private blur(enc: GPUCommandEncoder, slot: 0 | 1 | 2, src: GPUTexture, dst: GPUTexture, dir: number[], texel: number[]): void {
    const data = new Float32Array([dir[0], dir[1], texel[0], texel[1]]);
    this.device.queue.writeBuffer(this.blurBufs[slot], 0, data);
    const group = this.device.createBindGroup({
      layout: this.blurLayout,
      entries: [
        { binding: 0, resource: src.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: this.blurBufs[slot] } },
      ],
    });
    this.pass(enc, this.blurPipe, group, dst.createView(), dst.width, dst.height);
  }

  private pass(enc: GPUCommandEncoder, pipe: GPURenderPipeline, group: GPUBindGroup, view: GPUTextureView, width: number, height: number): void {
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
    });
    pass.setPipeline(pipe);
    pass.setBindGroup(0, group);
    pass.setViewport(0, 0, width, height, 0, 1);
    pass.draw(3);
    pass.end();
  }
}
