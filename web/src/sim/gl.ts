import type { Sample } from "./types";

const FULLSCREEN = `#version 300 es
precision highp float;
void main() {
  float x = float((gl_VertexID << 1) & 2);
  float y = float(gl_VertexID & 2);
  gl_Position = vec4(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
}
`;

const UPDATE = `#version 300 es
precision highp float;
uniform sampler2D src;
uniform vec2 lattice;
uniform float parity;
uniform float temperature;
uniform float seed;
uniform float frame;
uniform float decay;
out vec4 frag;

uint pcg(uint x) {
  uint state = x * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

float spinTex(ivec2 p, ivec2 n) {
  p = (p + n) % n;
  return texelFetch(src, p, 0).r > 0.5 ? 1.0 : -1.0;
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 n = ivec2(lattice);
  if (p.x >= n.x || p.y >= n.y) discard;
  vec4 here = texelFetch(src, p, 0);
  if (((p.x + p.y) & 1) != int(parity)) {
    frag = here;
    return;
  }
  float s = here.r > 0.5 ? 1.0 : -1.0;
  float sum = spinTex(p + ivec2(1, 0), n) + spinTex(p + ivec2(-1, 0), n)
    + spinTex(p + ivec2(0, 1), n) + spinTex(p + ivec2(0, -1), n);
  float delta = 2.0 * s * sum;
  uint h = pcg(uint(seed) ^ (uint(p.x) * 1664525u) ^ (uint(p.y) * 2246822519u) ^ (uint(frame) * 1013904223u) ^ uint(parity));
  float rnd = float(h) / 4294967296.0;
  bool accept = delta <= 0.0 || (temperature > 0.0 && rnd < exp(-delta / temperature));
  if (accept) frag = vec4(here.r > 0.5 ? 0.0 : 1.0, 1.0, 0.0, 1.0);
  else frag = vec4(here.r, here.g * decay, 0.0, 1.0);
}
`;

const PRESENT = `#version 300 es
precision highp float;
uniform sampler2D latticeTex;
uniform vec2 lattice;
uniform vec2 screen;
out vec4 frag;

float spinAt(ivec2 p, ivec2 n) {
  p = (p + n) % n;
  return texelFetch(latticeTex, p, 0).r > 0.5 ? 1.0 : -1.0;
}

void main() {
  ivec2 n = ivec2(lattice);
  float nf = lattice.x;
  vec3 bg = vec3(0.027, 0.031, 0.043);
  float top = 156.0;
  float foot = min(screen.y * 0.40, 248.0);
  float side = min(screen.x - 28.0, screen.y - top - foot);
  vec2 origin = vec2((screen.x - side) * 0.5, foot);
  vec2 p = (gl_FragCoord.xy - origin) / side;
  if (p.x < 0.0 || p.y < 0.0 || p.x >= 1.0 || p.y >= 1.0) {
    frag = vec4(bg, 1.0);
    return;
  }
  vec2 local = vec2(p.x, 1.0 - p.y);
  vec2 g = local * nf;
  ivec2 cell = ivec2(g);
  vec2 f = fract(g);
  float s = spinAt(cell, n);
  float cellPx = side / nf;
  float aa = 1.35 / cellPx;
  int hopX = f.x >= 0.5 ? 1 : -1;
  int hopY = f.y >= 0.5 ? 1 : -1;
  float otherH = spinAt(cell + ivec2(hopX, 0), n);
  float otherV = spinAt(cell + ivec2(0, hopY), n);
  bool cutH = s != otherH;
  bool cutV = s != otherV;
  float agreeW = max(0.03, 1.15 / cellPx);
  float cutW = max(0.075, 2.3 / cellPx);
  float hw = cutH ? cutW : agreeW;
  float vw = cutV ? cutW : agreeW;
  float ah = 1.0 - smoothstep(hw, hw + aa, abs(f.y - 0.5));
  float av = 1.0 - smoothstep(vw, vw + aa, abs(f.x - 0.5));
  vec3 agreeC = vec3(0.46, 0.43, 0.38);
  vec3 cutC = vec3(0.98, 0.72, 0.38);
  vec3 hcol = cutH ? cutC : agreeC;
  vec3 vcol = cutV ? cutC : agreeC;
  vec3 col = bg;
  if (ah >= av) {
    col = mix(col, vcol, av);
    col = mix(col, hcol, ah);
  } else {
    col = mix(col, hcol, ah);
    col = mix(col, vcol, av);
  }
  ivec2 wrapped = (cell + n) % n;
  float trail = texelFetch(latticeTex, wrapped, 0).g;
  vec3 node = s > 0.0 ? vec3(0.52, 0.60, 0.96) : vec3(0.86, 0.47, 0.34);
  node = mix(node, vec3(1.0, 0.93, 0.82), trail * 0.5);
  float radius = max(0.24, 3.2 / cellPx);
  float an = 1.0 - smoothstep(radius, radius + aa, length(f - vec2(0.5)));
  frag = vec4(mix(col, node, an), 1.0);
}
`;

const EXTRACT = `#version 300 es
precision highp float;
uniform sampler2D src;
void main() {
  float x = float((gl_VertexID << 1) & 2);
  float y = float(gl_VertexID & 2);
  gl_Position = vec4(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
}
`;

const EXTRACT_FS = `#version 300 es
precision highp float;
uniform sampler2D src;
out vec4 frag;
void main() {
  vec2 coord = gl_FragCoord.xy / vec2(textureSize(src, 0));
  vec3 c = texture(src, coord).rgb;
  float l = max(c.r, max(c.g, c.b));
  float k = max(l - 0.55, 0.0);
  frag = vec4(c * k / max(l, 0.0001), 1.0);
}
`;

const BLUR_VS = `#version 300 es
void main() {
  float x = float((gl_VertexID << 1) & 2);
  float y = float(gl_VertexID & 2);
  gl_Position = vec4(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
}
`;

const BLUR_FS = `#version 300 es
precision highp float;
uniform sampler2D src;
uniform vec2 dir;
uniform vec2 texel;
out vec4 frag;
void main() {
  vec2 uv = gl_FragCoord.xy * texel;
  float w0 = 0.227027;
  float w1 = 0.1945946;
  float w2 = 0.1216216;
  float w3 = 0.054054;
  float w4 = 0.016216;
  vec4 c = texture(src, uv) * w0;
  c += texture(src, uv + dir * texel * 1.0) * w1;
  c += texture(src, uv - dir * texel * 1.0) * w1;
  c += texture(src, uv + dir * texel * 2.0) * w2;
  c += texture(src, uv - dir * texel * 2.0) * w2;
  c += texture(src, uv + dir * texel * 3.0) * w3;
  c += texture(src, uv - dir * texel * 3.0) * w3;
  c += texture(src, uv + dir * texel * 4.0) * w4;
  c += texture(src, uv - dir * texel * 4.0) * w4;
  frag = c;
}
`;

const COMPOSITE_FS = `#version 300 es
precision highp float;
uniform sampler2D baseTex;
uniform sampler2D halfTex;
uniform sampler2D wideTex;
out vec4 frag;

vec3 aces(vec3 x) {
  float a = 2.51;
  float b = 0.03;
  float c = 2.43;
  float d = 0.59;
  float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / vec2(textureSize(baseTex, 0));
  vec3 base = texture(baseTex, uv).rgb;
  vec3 halfC = texture(halfTex, uv).rgb;
  vec3 wide = texture(wideTex, uv).rgb;
  vec3 col = aces(base + halfC * 0.35 + wide * 0.22);
  float v = smoothstep(0.92, 0.35, length(uv - 0.5));
  frag = vec4(col * mix(0.78, 1.0, v), 1.0);
}
`;

const BLOCK = `#version 300 es
precision highp float;
uniform sampler2D src;
uniform vec2 lattice;
out vec4 frag;

float spinOf(ivec2 p, ivec2 n) {
  p = (p + n) % n;
  return texelFetch(src, p, 0).r > 0.5 ? 1.0 : -1.0;
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 n = ivec2(lattice);
  vec3 acc = vec3(0.0);
  for (int dy = 0; dy < 2; dy++) {
    for (int dx = 0; dx < 2; dx++) {
      ivec2 q = p * 2 + ivec2(dx, dy);
      float s = spinOf(q, n);
      float sr = spinOf(q + ivec2(1, 0), n);
      float sd = spinOf(q + ivec2(0, 1), n);
      acc.x += s;
      acc.y += s * sr + s * sd;
      acc.z += texelFetch(src, (q + n) % n, 0).g > 0.96 ? 1.0 : 0.0;
    }
  }
  frag = vec4(acc, 1.0);
}
`;

const SUM = `#version 300 es
precision highp float;
uniform sampler2D src;
out vec4 frag;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy) * 2;
  vec4 acc = texelFetch(src, p, 0) + texelFetch(src, p + ivec2(1, 0), 0)
    + texelFetch(src, p + ivec2(0, 1), 0) + texelFetch(src, p + ivec2(1, 1), 0);
  frag = acc;
}
`;

function program(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
  const compile = (type: number, src: string) => {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("shader");
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) || "shader compile");
    }
    return shader;
  };
  const vs = compile(gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  if (!prog) throw new Error("program");
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(prog) || "link");
  }
  return prog;
}

function texture(gl: WebGL2RenderingContext, w: number, h: number, floatTex: boolean): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error("texture");
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, floatTex ? gl.NEAREST : gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, floatTex ? gl.NEAREST : gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (floatTex) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  return tex;
}

function target(gl: WebGL2RenderingContext, tex: WebGLTexture): WebGLFramebuffer {
  const fb = gl.createFramebuffer();
  if (!fb) throw new Error("framebuffer");
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return fb;
}

export class GlLattice {
  readonly kind = "webgl2" as const;
  private n = 64;
  private temperature = 2.1;
  private seed = 1;
  private lattice: [WebGLTexture, WebGLTexture];
  private latticeFb: [WebGLFramebuffer, WebGLFramebuffer];
  private readIndex = 0;
  private hdr: WebGLTexture | null = null;
  private hdrFb: WebGLFramebuffer | null = null;
  private halfA: WebGLTexture | null = null;
  private halfB: WebGLTexture | null = null;
  private wide: WebGLTexture | null = null;
  private halfAFb: WebGLFramebuffer | null = null;
  private halfBFb: WebGLFramebuffer | null = null;
  private wideFb: WebGLFramebuffer | null = null;
  private levels: { tex: WebGLTexture; fb: WebGLFramebuffer; size: number }[] = [];
  private viewW = 1;
  private viewH = 1;
  private canReduce: boolean;

  private constructor(
    private gl: WebGL2RenderingContext,
    private updateProg: WebGLProgram,
    private presentProg: WebGLProgram,
    private extractProg: WebGLProgram,
    private blurProg: WebGLProgram,
    private compositeProg: WebGLProgram,
    private blockProg: WebGLProgram,
    private sumProg: WebGLProgram,
    lattice: [WebGLTexture, WebGLTexture],
    latticeFb: [WebGLFramebuffer, WebGLFramebuffer],
    canReduce: boolean,
  ) {
    this.lattice = lattice;
    this.latticeFb = latticeFb;
    this.canReduce = canReduce;
  }

  static create(canvas: HTMLCanvasElement): GlLattice | null {
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false });
    if (!gl) return null;
    const floatExt = gl.getExtension("EXT_color_buffer_float");
    const updateProg = program(gl, FULLSCREEN, UPDATE);
    const presentProg = program(gl, FULLSCREEN, PRESENT);
    const extractProg = program(gl, EXTRACT, EXTRACT_FS);
    const blurProg = program(gl, BLUR_VS, BLUR_FS);
    const compositeProg = program(gl, BLUR_VS, COMPOSITE_FS);
    const blockProg = program(gl, BLUR_VS, BLOCK);
    const sumProg = program(gl, BLUR_VS, SUM);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const lattice: [WebGLTexture, WebGLTexture] = [texture(gl, 64, 64, false), texture(gl, 64, 64, false)];
    const latticeFb: [WebGLFramebuffer, WebGLFramebuffer] = [target(gl, lattice[0]), target(gl, lattice[1])];
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return new GlLattice(gl, updateProg, presentProg, extractProg, blurProg, compositeProg, blockProg, sumProg, lattice, latticeFb, Boolean(floatExt));
  }

  setTemperature(t: number): void {
    this.temperature = t;
  }

  resize(n: number, pixels: Uint8Array): void {
    const gl = this.gl;
    this.n = n;
    gl.deleteTexture(this.lattice[0]);
    gl.deleteTexture(this.lattice[1]);
    gl.deleteFramebuffer(this.latticeFb[0]);
    gl.deleteFramebuffer(this.latticeFb[1]);
    this.lattice = [texture(gl, n, n, false), texture(gl, n, n, false)];
    this.latticeFb = [target(gl, this.lattice[0]), target(gl, this.lattice[1])];
    this.readIndex = 0;
    this.upload(pixels);
    this.allocReduction();
  }

  upload(pixels: Uint8Array): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.lattice[this.readIndex]);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.n, this.n, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  }

  step(frame: number): void {
    this.pass(0, frame);
    this.pass(1, frame);
  }

  draw(): void {
    const gl = this.gl;
    const canvas = gl.canvas as HTMLCanvasElement;
    this.ensureView(canvas.width, canvas.height);
    if (!this.hdr || !this.hdrFb || !this.halfA || !this.halfB || !this.wide || !this.halfAFb || !this.halfBFb || !this.wideFb) return;
    gl.disable(gl.BLEND);
    gl.useProgram(this.presentProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.lattice[this.readIndex]);
    gl.uniform1i(gl.getUniformLocation(this.presentProg, "latticeTex"), 0);
    gl.uniform2f(gl.getUniformLocation(this.presentProg, "lattice"), this.n, this.n);
    gl.uniform2f(gl.getUniformLocation(this.presentProg, "screen"), this.viewW, this.viewH);
    this.drawTo(this.hdrFb, this.viewW, this.viewH);

    gl.useProgram(this.extractProg);
    this.bindTex(this.extractProg, "src", this.hdr);
    this.drawTo(this.halfAFb, this.viewW >> 1, this.viewH >> 1);

    this.blurTo(this.halfA, this.halfBFb, [1, 0], [1 / (this.viewW >> 1), 1 / (this.viewH >> 1)], this.viewW >> 1, this.viewH >> 1);
    this.blurTo(this.halfB, this.halfAFb, [0, 1], [1 / (this.viewW >> 1), 1 / (this.viewH >> 1)], this.viewW >> 1, this.viewH >> 1);
    this.blurTo(this.halfA, this.wideFb, [1, 1], [1.6 / (this.viewW >> 1), 1.6 / (this.viewH >> 1)], this.viewW >> 2, this.viewH >> 2);

    gl.useProgram(this.compositeProg);
    this.bindUnit(this.compositeProg, "baseTex", this.hdr, 0);
    this.bindUnit(this.compositeProg, "halfTex", this.halfA, 1);
    this.bindUnit(this.compositeProg, "wideTex", this.wide, 2);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.viewW, this.viewH);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  readStats(): Promise<Sample | null> {
    if (!this.canReduce || this.levels.length === 0) return Promise.resolve(null);
    const gl = this.gl;
    const first = this.levels[0];
    gl.useProgram(this.blockProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.lattice[this.readIndex]);
    gl.uniform1i(gl.getUniformLocation(this.blockProg, "src"), 0);
    gl.uniform2f(gl.getUniformLocation(this.blockProg, "lattice"), this.n, this.n);
    this.drawTo(first.fb, first.size, first.size);
    let prev = first;
    for (let i = 1; i < this.levels.length; i++) {
      const level = this.levels[i];
      gl.useProgram(this.sumProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, prev.tex);
      gl.uniform1i(gl.getUniformLocation(this.sumProg, "src"), 0);
      this.drawTo(level.fb, level.size, level.size);
      prev = level;
    }
    const buf = new Float32Array(4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, prev.fb);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, buf);
    const cells = this.n * this.n;
    return Promise.resolve({ mag: buf[0] / cells, energy: -buf[1] / cells, flips: buf[2] });
  }

  destroy(): void {
    const gl = this.gl;
    this.lattice.forEach((tex) => gl.deleteTexture(tex));
    this.latticeFb.forEach((fb) => gl.deleteFramebuffer(fb));
    if (this.hdr) gl.deleteTexture(this.hdr);
    if (this.halfA) gl.deleteTexture(this.halfA);
    if (this.halfB) gl.deleteTexture(this.halfB);
    if (this.wide) gl.deleteTexture(this.wide);
    this.levels.forEach((level) => {
      gl.deleteTexture(level.tex);
      gl.deleteFramebuffer(level.fb);
    });
  }

  private pass(parity: number, frame: number): void {
    const gl = this.gl;
    const src = this.readIndex;
    const dst = 1 - src;
    gl.useProgram(this.updateProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.lattice[src]);
    gl.uniform1i(gl.getUniformLocation(this.updateProg, "src"), 0);
    gl.uniform2f(gl.getUniformLocation(this.updateProg, "lattice"), this.n, this.n);
    gl.uniform1f(gl.getUniformLocation(this.updateProg, "parity"), parity);
    gl.uniform1f(gl.getUniformLocation(this.updateProg, "temperature"), this.temperature);
    gl.uniform1f(gl.getUniformLocation(this.updateProg, "seed"), this.seed);
    gl.uniform1f(gl.getUniformLocation(this.updateProg, "frame"), frame);
    gl.uniform1f(gl.getUniformLocation(this.updateProg, "decay"), 0.9);
    this.drawTo(this.latticeFb[dst], this.n, this.n);
    this.readIndex = dst;
  }

  private allocReduction(): void {
    const gl = this.gl;
    this.levels.forEach((level) => {
      gl.deleteTexture(level.tex);
      gl.deleteFramebuffer(level.fb);
    });
    this.levels = [];
    if (!this.canReduce) return;
    let size = this.n >> 1;
    while (size >= 1) {
      const tex = texture(gl, size, size, true);
      this.levels.push({ tex, fb: target(gl, tex), size });
      size >>= 1;
    }
  }

  private ensureView(width: number, height: number): void {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    if (w === this.viewW && h === this.viewH && this.hdr) return;
    const gl = this.gl;
    this.viewW = w;
    this.viewH = h;
    const wipe = (tex: WebGLTexture | null, fb: WebGLFramebuffer | null) => {
      if (tex) gl.deleteTexture(tex);
      if (fb) gl.deleteFramebuffer(fb);
    };
    wipe(this.hdr, this.hdrFb);
    wipe(this.halfA, this.halfAFb);
    wipe(this.halfB, this.halfBFb);
    wipe(this.wide, this.wideFb);
    const halfW = Math.max(1, w >> 1);
    const halfH = Math.max(1, h >> 1);
    this.hdr = this.floatView(w, h);
    this.hdrFb = target(gl, this.hdr);
    this.halfA = this.floatView(halfW, halfH);
    this.halfAFb = target(gl, this.halfA);
    this.halfB = this.floatView(halfW, halfH);
    this.halfBFb = target(gl, this.halfB);
    this.wide = this.floatView(Math.max(1, w >> 2), Math.max(1, h >> 2));
    this.wideFb = target(gl, this.wide);
  }

  private floatView(w: number, h: number): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture();
    if (!tex) throw new Error("texture");
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const internal = this.canReduce ? gl.RGBA16F : gl.RGBA8;
    const type = this.canReduce ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, gl.RGBA, type, null);
    return tex;
  }

  private drawTo(fb: WebGLFramebuffer, w: number, h: number): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.viewport(0, 0, Math.max(1, w), Math.max(1, h));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private bindTex(prog: WebGLProgram, name: string, tex: WebGLTexture): void {
    this.bindUnit(prog, name, tex, 0);
  }

  private bindUnit(prog: WebGLProgram, name: string, tex: WebGLTexture, unit: number): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(gl.getUniformLocation(prog, name), unit);
  }

  private blurTo(src: WebGLTexture, fb: WebGLFramebuffer, dir: number[], texel: number[], w: number, h: number): void {
    const gl = this.gl;
    gl.useProgram(this.blurProg);
    this.bindTex(this.blurProg, "src", src);
    gl.uniform2f(gl.getUniformLocation(this.blurProg, "dir"), dir[0], dir[1]);
    gl.uniform2f(gl.getUniformLocation(this.blurProg, "texel"), texel[0], texel[1]);
    this.drawTo(fb, w, h);
  }
}
