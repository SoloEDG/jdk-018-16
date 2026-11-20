import type { PaletteEntry } from "../../../shared/document";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++)
    c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u32(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const len = data.length;
  const out = new Uint8Array(12 + len);
  out.set(u32(len), 0);
  out.set(typeBytes, 4);
  out.set(data, 8);
  out.set(u32(crc32(out, 4, 8 + len)), 8 + len);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

async function zlibDeflate(raw: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("deflate");
  const stream = new Blob([raw]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export interface IndexedImage {
  width: number;
  height: number;
  /** 与 entries.index 对齐的每像素调色板索引 */
  indices: Uint8Array | Uint8ClampedArray | number[];
  entries: PaletteEntry[];
}

/**
 * 编码为真正的索引色 PNG（color type 3）。
 * PLTE 顺序即 entries 的导出索引；含 alpha<255 的条目时写 tRNS，
 * 保证透明项随色板一起进入文件，而不是退回真彩色。
 */
export async function encodeIndexedPng(img: IndexedImage): Promise<Blob> {
  const { width, height, indices, entries } = img;
  if (entries.length < 1 || entries.length > 256)
    throw new Error("索引色板条目数必须在 1..256 之间");

  // IHDR：bit depth 8，color type 3（indexed），无隔行
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // color type = indexed
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // PLTE
  const plte = new Uint8Array(entries.length * 3);
  entries.forEach((e, i) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(e.color)!;
    const v = parseInt(m[1]!, 16);
    plte[i * 3] = (v >> 16) & 255;
    plte[i * 3 + 1] = (v >> 8) & 255;
    plte[i * 3 + 2] = v & 255;
  });

  const parts: Uint8Array[] = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("PLTE", plte),
  ];

  // tRNS：只需要写到最后一个非不透明条目
  const lastTrans = entries.reduce(
    (acc, e, i) => (e.alpha < 255 ? i : acc),
    -1,
  );
  if (lastTrans >= 0) {
    const trns = new Uint8Array(lastTrans + 1);
    for (let i = 0; i <= lastTrans; i++) trns[i] = entries[i]!.alpha;
    parts.push(chunk("tRNS", trns));
  }

  // 原始扫描流：每行前置 filter byte 0（None）
  const raw = new Uint8Array(height * (width + 1));
  let off = 0;
  for (let y = 0; y < height; y++) {
    raw[off++] = 0;
    for (let x = 0; x < width; x++) {
      raw[off++] = indices[y * width + x]!;
    }
  }
  const idat = await zlibDeflate(raw);
  parts.push(chunk("IDAT", idat));
  parts.push(chunk("IEND", new Uint8Array(0)));

  return new Blob([concat(parts)], { type: "image/png" });
}
