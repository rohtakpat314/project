export type BoardFrame = {
  energy: number;
  mag: number;
  temp: number;
};

type Port = {
  open: (options: { baudRate: number }) => Promise<void>;
  close: () => Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
};

export class BoardLink {
  private port: Port | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private stop = false;
  frame: BoardFrame | null = null;

  static available(): boolean {
    return typeof navigator !== "undefined" && "serial" in navigator;
  }

  async connect(onFrame: (frame: BoardFrame) => void): Promise<void> {
    const serial = (navigator as Navigator & { serial?: { requestPort: () => Promise<Port> } }).serial;
    if (!serial) throw new Error("WebSerial is not in this browser. Chrome can open a board port.");
    const port = await serial.requestPort();
    await port.open({ baudRate: 115200 });
    this.port = port;
    this.stop = false;
    const reader = port.readable?.getReader();
    if (!reader) throw new Error("The port has no readable stream.");
    this.reader = reader;
    void this.pump(reader, onFrame);
  }

  async disconnect(): Promise<void> {
    this.stop = true;
    try {
      await this.reader?.cancel();
    } catch {
      /* already closed */
    }
    this.reader = null;
    try {
      await this.port?.close();
    } catch {
      /* already closed */
    }
    this.port = null;
    this.frame = null;
  }

  private async pump(reader: ReadableStreamDefaultReader<Uint8Array>, onFrame: (frame: BoardFrame) => void): Promise<void> {
    const decoder = new TextDecoder();
    let pending = "";
    try {
      while (!this.stop) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        pending += decoder.decode(value, { stream: true });
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? "";
        for (const line of lines) {
          const frame = parseFrame(line);
          if (!frame) continue;
          this.frame = frame;
          onFrame(frame);
        }
      }
    } catch {
      this.frame = null;
    }
  }
}

function parseFrame(line: string): BoardFrame | null {
  const text = line.trim();
  if (!text) return null;
  const isng = text.match(/^ISNG\s+([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)/i);
  if (isng) return { energy: Number(isng[1]), mag: Number(isng[2]), temp: Number(isng[3]) };
  const labeled = text.match(/E\s*[:=]\s*([+-]?\d+(?:\.\d+)?).*M\s*[:=]\s*([+-]?\d+(?:\.\d+)?).*T\s*[:=]\s*([+-]?\d+(?:\.\d+)?)/i);
  if (labeled) return { energy: Number(labeled[1]), mag: Number(labeled[2]), temp: Number(labeled[3]) };
  return null;
}
