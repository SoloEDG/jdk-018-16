export interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Asset {
  name: string;
  url: string;
  width: number;
  height: number;
  image: HTMLImageElement;
}
export type PaletteStrategy = "salient" | "fidelity";
export interface Settings {
  columns: number;
  charset: string;
  custom: string;
  contrast: number;
  gamma: number;
  invert: boolean;
  color: boolean;
  background: string;
  /** 索引色模式开关；false 时继续使用逐格真彩色 */
  indexed: boolean;
  /** 色板条目总数上限（含背景项与透明项） */
  maxColors: number;
  /** 锁色超额时的冲突解决策略 */
  strategy: PaletteStrategy;
}
export interface LockedColor {
  id: string;
  color: string;
  origin: "eyedropper" | "manual" | "swatch";
  createdAt: number;
}
export type PaletteEntryKind =
  | "transparent"
  | "background"
  | "locked"
  | "auto";
export interface PaletteEntry {
  /** 在 entries 数组内的稳定标识，cell.paletteId 指向它 */
  id: number;
  /** 导出 PNG 时的 PLTE 索引 */
  index: number;
  color: string;
  /** 0 表示全透明项，255 为不透明 */
  alpha: number;
  kind: PaletteEntryKind;
  /** 锁定来源锁色 id（kind === "locked" 时） */
  lockId?: string;
  /** 实际占用的单元数 */
  count: number;
  /** 归入该项的半透明边缘单元数（0 < alpha < 255） */
  edgeCells: number;
}
export interface Cell {
  glyph: string;
  color: string;
  /** 指向 Grid.palette.entries 的 id；真彩色模式为 -1 */
  paletteId: number;
}
/** 逐格采样的原始像素，供色板重新提取与占用核对 */
export interface GridSamples {
  r: Uint8ClampedArray;
  g: Uint8ClampedArray;
  b: Uint8ClampedArray;
  a: Uint8ClampedArray;
  lum: Float32Array;
  cover: Float32Array;
}
export interface PaletteMetrics {
  meanDeltaE: number;
  maxDeltaE: number;
  /** 采样明度与归并后条目明度的 Kendall τ，用于核对层次是否倒置 */
  orderTau: number;
  totalCells: number;
  usedEntries: number;
  transparentCells: number;
  edgeCells: number;
}
export interface DroppedLock {
  color: string;
  score: number;
  reason: string;
}
export interface StrategyScore {
  meanDeltaE: number;
  /** 被舍弃锁色的显眼度总和（越小越好） */
  droppedSalience: number;
}
export interface PaletteConflict {
  requested: number;
  unique: number;
  capacity: number;
  /** 完全重复的锁色分组（同 hex） */
  duplicateGroups: { color: string; count: number }[];
  /** 近似但不相同的锁色对（ΔE 很小，建议合并） */
  nearPairs: { a: string; b: string; deltaE: number }[];
  dropped: DroppedLock[];
  compare: Record<PaletteStrategy, StrategyScore>;
}
export interface PaletteState {
  entries: PaletteEntry[];
  metrics: PaletteMetrics;
  conflict: PaletteConflict | null;
}
export interface Grid {
  columns: number;
  rows: number;
  cells: Cell[];
  samples: GridSamples;
  /** 索引色模式下的色板；真彩色模式为 null */
  palette: PaletteState | null;
  revision: number;
}
export interface StudioDocument {
  asset: Asset | null;
  crop: Crop;
  settings: Settings;
  locks: LockedColor[];
  grid: Grid | null;
  revision: number;
}
