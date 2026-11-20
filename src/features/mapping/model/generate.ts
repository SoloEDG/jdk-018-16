import type { StudioDocument, Grid, Cell } from "../../../shared/document";
import { glyphs } from "../lib/charsets";
import { gridSize } from "../lib/gridSize";
import { tone, luminance } from "../lib/tone";
import { sampleGrid } from "../../palette/lib/sampleGrid";
import { hexToRgb, rgbToHex } from "../../palette/lib/color";
import { quantize } from "../../palette/lib/quantize";

export function generate(doc: StudioDocument): Grid | null {
  if (!doc.asset) return null;
  const s = doc.settings;
  const size = gridSize(
    doc.asset.width * doc.crop.width,
    doc.asset.height * doc.crop.height,
    s.columns,
  );
  const samples = sampleGrid(doc.asset, doc.crop, size.columns, size.rows);
  const chars = glyphs(s.charset, s.custom);
  const bg = hexToRgb(s.background);
  const n = samples.r.length;

  // 每格的合成显示色与字符（明度取 0..255 的 luminance，不再重复缩放）
  const cellGlyphs: string[] = new Array(n);
  const displayRgb: { r: number; g: number; b: number }[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const alpha = samples.a[i]! / 255;
    const r = samples.r[i]! * alpha + bg.r * (1 - alpha);
    const g = samples.g[i]! * alpha + bg.g * (1 - alpha);
    const b = samples.b[i]! * alpha + bg.b * (1 - alpha);
    displayRgb[i] = { r, g, b };
    const t = tone(luminance(r, g, b), s.contrast, s.gamma, s.invert);
    cellGlyphs[i] = chars[Math.round(t * (chars.length - 1))]!;
  }

  const cells: Cell[] = [];
  if (!s.indexed) {
    // 真彩色路径：逐格采样色（与背景合成后的显示色），paletteId = -1
    for (let i = 0; i < n; i++) {
      const { r, g, b } = displayRgb[i]!;
      cells.push({
        glyph: cellGlyphs[i]!,
        color: rgbToHex(r, g, b),
        paletteId: -1,
      });
    }
    return { ...size, cells, samples, palette: null, revision: doc.revision };
  }

  // 索引色路径：先定字符，再由量化引擎统一求解色板
  for (let i = 0; i < n; i++) {
    cells.push({
      glyph: cellGlyphs[i]!,
      color: s.background,
      paletteId: -1,
    });
  }
  // 传入的是逐格字符数组（长度 n），而非字符集
  const res = quantize({
    samples,
    glyphs: cellGlyphs,
    settings: s,
    locks: doc.locks,
  });
  for (let i = 0; i < n; i++) {
    cells[i]!.paletteId = res.assignments[i]!;
    cells[i]!.color = res.colors[i]!;
  }
  return {
    ...size,
    cells,
    samples,
    palette: res.palette,
    revision: doc.revision,
  };
}
