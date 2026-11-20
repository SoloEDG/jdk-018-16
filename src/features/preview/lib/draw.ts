import type { Grid } from "../../../shared/document";

export interface DrawOptions {
  /** 单色（非彩色）模式 */
  mono?: boolean;
  /** 追踪高亮的色板导出索引 */
  trackId?: number | null;
}

/**
 * 统一的字符画栅格化。索引色模式下只使用 grid.palette 中的颜色，
 * 与 PNG 导出共用同一绘制路径与同一色板。
 */
export function drawGrid(
  canvas: HTMLCanvasElement,
  grid: Grid,
  color: boolean,
  background: string,
  options: DrawOptions = {},
) {
  canvas.width = grid.columns * 8;
  canvas.height = grid.rows * 16;
  const g = canvas.getContext("2d")!;
  g.fillStyle = background;
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.font = "14px monospace";
  g.textBaseline = "middle";
  g.textAlign = "center";

  const entries = grid.palette?.entries;
  // 导出索引 -> 条目的 O(1) 映射，避免逐格 find 造成 O(n²)
  const byIndex = entries
    ? new Map(entries.map((e) => [e.index, e]))
    : null;
  for (let i = 0; i < grid.cells.length; i++) {
    const c = grid.cells[i]!;
    const entry = byIndex?.get(c.paletteId);
    const x = (i % grid.columns) * 8;
    const y = Math.floor(i / grid.columns) * 16;

    if (entry?.kind === "transparent") {
      // 透明项：棋盘格标识，透明 PNG 中该像素走 tRNS 索引；追踪时仍可高亮
      const col = i % grid.columns;
      const row = Math.floor(i / grid.columns);
      g.fillStyle = (col + row) % 2 === 0 ? "#2a2d33" : "#202329";
      g.fillRect(x, y, 8, 16);
      if (options.trackId !== undefined && options.trackId !== null) {
        g.fillStyle =
          c.paletteId === options.trackId
            ? "rgba(221,241,145,0.28)"
            : "rgba(12,14,18,0.62)";
        g.fillRect(x, y, 8, 16);
      }
      continue;
    }

    if (options.trackId !== undefined && options.trackId !== null) {
      const on = c.paletteId === options.trackId;
      g.fillStyle = on ? "rgba(221,241,145,0.22)" : "rgba(12,14,18,0.62)";
      g.fillRect(x, y, 8, 16);
      if (!on) continue;
    }

    g.fillStyle = color ? c.color : "#e9eceb";
    g.fillText(c.glyph, x + 4, y + 8);
  }
}

/** 导出用：逐像素的色板索引位图（与 drawGrid 的单元排列一致） */
export function indexBitmap(grid: Grid): Uint8Array {
  const n = grid.columns * grid.rows;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.max(0, grid.cells[i]!.paletteId);
  return out;
}
