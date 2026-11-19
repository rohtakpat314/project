export type Trace = { energy: number; mag: number; temp: number };

const ROWS = [
  { key: "energy" as const, color: "#e2a27a", lo: -2.05, hi: 0.05, label: "E/N" },
  { key: "mag" as const, color: "#9fd0ea", lo: -1, hi: 1, label: "m" },
  { key: "temp" as const, color: "#d9d3c7", lo: 0, hi: 4.5, label: "T" },
];

export function drawScope(canvas: HTMLCanvasElement, traces: Trace[]): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width < 2 || height < 2) return;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const rowH = height / ROWS.length;
  ROWS.forEach((row, index) => {
    const top = index * rowH;
    ctx.strokeStyle = "rgba(231,225,214,0.12)";
    ctx.beginPath();
    ctx.moveTo(28, top + rowH - 8);
    ctx.lineTo(width - 8, top + rowH - 8);
    ctx.stroke();
    ctx.fillStyle = "rgba(217,211,199,0.72)";
    ctx.font = "12px Bahnschrift, Segoe UI, sans-serif";
    ctx.fillText(row.label, 0, top + 14);
    if (traces.length < 2) return;
    ctx.beginPath();
    ctx.strokeStyle = row.color;
    ctx.lineWidth = 1.25;
    traces.forEach((point, i) => {
      const x = 28 + ((width - 36) * i) / Math.max(1, traces.length - 1);
      const t = (point[row.key] - row.lo) / (row.hi - row.lo);
      const y = top + rowH - 8 - Math.max(0, Math.min(1, t)) * (rowH - 18);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });
}
