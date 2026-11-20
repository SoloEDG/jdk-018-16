import { computed, reactive, ref, type Ref } from "vue";
import type {
  LockedColor,
  PaletteState,
  PaletteStrategy,
  StudioDocument,
} from "../../../shared/document";
import { quantize } from "../lib/quantize";
import { hexToRgb, rgbToHex } from "../lib/color";

interface Snapshot {
  palette: PaletteState;
  assignments: number[];
  colors: string[];
  /** 当时的锁色集合，撤销加锁/解锁时一并回滚来源标记 */
  locks: LockedColor[];
  /** 当时的色板设置，撤销色数/策略调整时一并回滚 */
  maxColors: number;
  strategy: PaletteStrategy;
}

const MAX_HISTORY = 20;
let seq = 0;

function clonePalette(p: PaletteState): PaletteState {
  return {
    entries: p.entries.map((e) => ({ ...e })),
    metrics: { ...p.metrics },
    conflict: p.conflict
      ? {
          ...p.conflict,
          duplicateGroups: p.conflict.duplicateGroups.map((d) => ({ ...d })),
          nearPairs: p.conflict.nearPairs.map((d) => ({ ...d })),
          dropped: p.conflict.dropped.map((d) => ({ ...d })),
          compare: {
            salient: { ...p.conflict.compare.salient },
            fidelity: { ...p.conflict.compare.fidelity },
          },
        }
      : null,
  };
}

/**
 * 调色板会话：锁色、重提取、冲突策略、点击追踪与单步撤销。
 * 模块级单例，不依赖 inject，由 App 显式注册文档与提示通道，
 * 保证色板面板、预览、源图吸色层共享同一份状态。
 * doc 由 reactive() 创建后只会被修改、不会被整体替换，因此可直接持有引用。
 * 网格重新生成（新图/裁剪/密度/明暗调整）会清空撤销栈；
 * 仅色板调整入栈，撤销时同步恢复分配、来源标记与导出索引。
 */

const store = reactive<{ doc: StudioDocument | null }>({ doc: null });
const noticeStore: Ref<string> = ref("");
const history = ref<Snapshot[]>([]);
const trackedIndex = ref<number | null>(null);
const eyedropper = ref(false);

export function initPaletteSession(
  doc: StudioDocument,
  notice: Ref<string>,
): void {
  store.doc = doc;
  noticeBridge = notice;
}

let noticeBridge: Ref<string> | null = null;

function requireDoc(): StudioDocument {
  if (!store.doc) throw new Error("调色板会话尚未初始化");
  return store.doc;
}

function setNotice(text: string) {
  if (noticeBridge) noticeBridge.value = text;
  noticeStore.value = text;
}

const palette = computed<PaletteState | null>(
  () => store.doc?.grid?.palette ?? null,
);
const canUndo = computed(() => history.value.length > 0);
const trackedCount = computed(() => {
  if (!store.doc?.grid || trackedIndex.value === null) return 0;
  return store.doc.grid.cells.reduce(
    (n, c) => (c.paletteId === trackedIndex.value ? n + 1 : n),
    0,
  );
});

function takeSnapshot(): Snapshot | null {
  const doc = store.doc;
  if (!doc?.grid || !doc.grid.palette) return null;
  return {
    palette: clonePalette(doc.grid.palette),
    assignments: doc.grid.cells.map((c) => c.paletteId),
    colors: doc.grid.cells.map((c) => c.color),
    locks: doc.locks.map((l) => ({ ...l })),
    maxColors: doc.settings.maxColors,
    strategy: doc.settings.strategy,
  };
}

function applySnapshot(s: Snapshot) {
  const doc = requireDoc();
  if (!doc.grid) return;
  doc.grid.palette = clonePalette(s.palette);
  doc.locks = s.locks.map((l) => ({ ...l }));
  doc.settings.maxColors = s.maxColors;
  doc.settings.strategy = s.strategy;
  for (let i = 0; i < doc.grid.cells.length; i++) {
    doc.grid.cells[i]!.paletteId = s.assignments[i]!;
    doc.grid.cells[i]!.color = s.colors[i]!;
  }
  if (trackedIndex.value !== null) {
    const stillExists = doc.grid.palette.entries.some(
      (e) => e.index === trackedIndex.value,
    );
    if (!stillExists) trackedIndex.value = null;
  }
}

/** 在任何变更发生之前记录当前状态 */
function commit() {
  const s = takeSnapshot();
  if (!s) return;
  history.value.push(s);
  if (history.value.length > MAX_HISTORY) history.value.shift();
}

function clearHistory() {
  history.value = [];
  trackedIndex.value = null;
}

/** 用当前采样、锁色与设置重新求解并写回（不拍快照，快照必须在变更前由调用方提交） */
function recompute() {
  const doc = requireDoc();
  const grid = doc.grid;
  if (!grid) return;
  // 逐格字符已在生成阶段确定，色板重算只改颜色不改字符
  const res = quantize({
    samples: grid.samples,
    glyphs: grid.cells.map((c) => c.glyph),
    settings: doc.settings,
    locks: doc.locks,
  });
  grid.palette = res.palette;
  for (let i = 0; i < grid.cells.length; i++) {
    grid.cells[i]!.paletteId = res.assignments[i]!;
    grid.cells[i]!.color = res.colors[i]!;
  }
}

function undo() {
  const s = history.value.pop();
  if (!s) {
    setNotice("没有可撤销的色板调整");
    return;
  }
  applySnapshot(s);
  setNotice("已撤销上一次色板调整");
}

function addLock(color: string, origin: LockedColor["origin"]) {
  const doc = requireDoc();
  const hex = normalizeHex(color);
  // 重复锁色仍登记入册，交由量化器去重并在冲突面板中可核对
  if (doc.locks.length >= 256) {
    setNotice("锁色数量已达上限");
    return;
  }
  const duplicated = doc.locks.some((l) => l.color.toLowerCase() === hex);
  commit();
  doc.locks.push({
    id: `lock-${++seq}-${Date.now()}`,
    color: hex,
    origin,
    createdAt: Date.now(),
  });
  recompute();
  setNotice(duplicated ? `已登记重复锁色 ${hex}（将自动合并）` : `已锁定 ${hex}`);
}

function removeLock(id: string) {
  const doc = requireDoc();
  const before = doc.locks.length;
  const next = doc.locks.filter((l) => l.id !== id);
  if (next.length === before) return;
  commit();
  doc.locks = next;
  recompute();
  setNotice("已移除锁色");
}

/** 从色板条目直接锁定（自动色 → 锁色） */
function lockEntry(index: number) {
  const entry = store.doc?.grid?.palette?.entries.find(
    (e) => e.index === index,
  );
  if (!entry || entry.kind === "transparent" || entry.kind === "background")
    return;
  addLock(entry.color, "swatch");
}

function reextract() {
  commit();
  recompute();
  setNotice("已保留锁色并重新提取自动色");
}function setMaxColors(v: number) {
  const doc = requireDoc();
  const clamped = Math.max(2, Math.min(256, Math.round(v)));
  if (clamped === doc.settings.maxColors) return;
  commit();
  doc.settings.maxColors = clamped;
  recompute();
  setNotice(`色数上限调整为 ${clamped}`);
}

function setStrategy(s: PaletteStrategy) {
  const doc = requireDoc();
  if (s === doc.settings.strategy) return;
  commit();
  doc.settings.strategy = s;
  recompute();
  setNotice(
    s === "fidelity" ? "已切换为整体色差优先" : "已切换为显眼小区域优先",
  );
}

function track(index: number | null) {
  trackedIndex.value = trackedIndex.value === index ? null : index;
}

/** 取某单元的原始采样显示色（与背景合成后），用于吸色锁定原图真实颜色 */
function sampleCellColor(cellIndex: number): string | null {
  const doc = store.doc;
  if (!doc?.grid) return null;
  const s = doc.grid.samples;
  const bg = hexToRgb(doc.settings.background);
  const alpha = s.a[cellIndex]! / 255;
  return rgbToHex(
    s.r[cellIndex]! * alpha + bg.r * (1 - alpha),
    s.g[cellIndex]! * alpha + bg.g * (1 - alpha),
    s.b[cellIndex]! * alpha + bg.b * (1 - alpha),
  );
}

export function usePaletteSession() {
  return {
    /** 注册前为 null；App setup 注册后，所有子组件读取时已可用 */
    get doc(): StudioDocument {
      return requireDoc();
    },
    notice: noticeStore,
    history,
    canUndo,
    trackedIndex,
    trackedCount,
    eyedropper,
    palette,
    clearHistory,
    undo,
    addLock,
    removeLock,
    lockEntry,
    reextract,
    setMaxColors,
    setStrategy,
    track,
    sampleCellColor,
  };
}

export function normalizeHex(input: string): string {
  const v = input.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^[0-9a-f]{6}$/.test(v)) return `#${v}`;
  if (/^#[0-9a-f]{3}$/.test(v)) {
    return (
      "#" +
      v
        .slice(1)
        .split("")
        .map((c) => c + c)
        .join("")
    );
  }
  throw new Error(`非法颜色值: ${input}`);
}

/** 从原图指定归一化坐标吸取像素颜色（直接取源像素 RGB） */
export function pickSourceColor(
  image: HTMLImageElement,
  nx: number,
  ny: number,
): string {
  const c = document.createElement("canvas");
  c.width = 1;
  c.height = 1;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  const sx = Math.max(
    0,
    Math.min(image.naturalWidth - 1, Math.floor(nx * image.naturalWidth)),
  );
  const sy = Math.max(
    0,
    Math.min(image.naturalHeight - 1, Math.floor(ny * image.naturalHeight)),
  );
  g.drawImage(image, sx, sy, 1, 1, 0, 0, 1, 1);
  const [r, gg, b] = g.getImageData(0, 0, 1, 1).data;
  return rgbToHex(r!, gg!, b!);
}

export function contrastText(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#1a1d18" : "#eef2e6";
}
