import type {
  LockedColor,
  PaletteConflict,
  PaletteEntry,
  PaletteState,
  Settings,
  DroppedLock,
} from "../../../shared/document";
import {
  deltaE,
  glyphCoverage,
  hexToLab,
  hexToRgb,
  kendallTau,
  rgbToHex,
  rgbToLab,
  type Lab,
} from "./color";

export interface QuantInput {
  samples: import("../../../shared/document").GridSamples;
  glyphs: string[];
  settings: Settings;
  locks: LockedColor[];
}
export interface QuantResult {
  palette: PaletteState;
  /** 每个单元对应的色板条目 index（同时也是 cell.paletteId） */
  assignments: number[];
  /** 每个单元对应的显示色 hex */
  colors: string[];
}

const TRANSPARENT_ALPHA = 16;
const EDGE_ALPHA = 250;
const NEAR_LOCK_DELTA = 8;
const KMEANS_ITERS = 14;

interface Centroid {
  lab: Lab;
  fixed: boolean;
  lockId?: string;
}

function weightedMeanLab(
  labs: Lab[],
  weights: Float64Array,
  idx: number[],
): Lab {
  let l = 0,
    a = 0,
    b = 0,
    w = 0;
  for (const i of idx) {
    const wi = weights[i]!;
    l += labs[i]!.l * wi;
    a += labs[i]!.a * wi;
    b += labs[i]!.b * wi;
    w += wi;
  }
  return w === 0 ? { l: 0, a: 0, b: 0 } : { l: l / w, a: a / w, b: b / w };
}

/** 加权保序回归（PAVA），dir=1 单调递增，dir=-1 单调递减，输出与输入等长 */
function isotonicPerItem(
  values: number[],
  weights: number[],
  dir: 1 | -1,
): number[] {
  const blocks: { v: number; w: number; members: number[] }[] = [];
  for (let i = 0; i < values.length; i++) {
    blocks.push({
      v: values[i]! * dir,
      w: Math.max(1e-6, weights[i]!),
      members: [i],
    });
    while (
      blocks.length >= 2 &&
      blocks[blocks.length - 2]!.v > blocks[blocks.length - 1]!.v
    ) {
      const x = blocks.pop()!;
      const y = blocks.pop()!;
      const w = x.w + y.w;
      blocks.push({
        v: (x.v * x.w + y.v * y.w) / w,
        w,
        members: [...y.members, ...x.members],
      });
    }
  }
  const out = new Array<number>(values.length);
  for (const blk of blocks) {
    const v = blk.v * dir;
    for (const m of blk.members) out[m] = v;
  }
  return out;
}

/** OKLab -> sRGB 8bit，标准逆变换 */
function labToRgb(lab: Lab): { r: number; g: number; b: number } {
  const l2 = lab.l + 0.3963377774 * lab.a + 0.2158037573 * lab.b;
  const m2 = lab.l - 0.1055613458 * lab.a - 0.0638541728 * lab.b;
  const s2 = lab.l - 0.0894841775 * lab.a - 1.291485548 * lab.b;
  const l3 = l2 ** 3;
  const m3 = m2 ** 3;
  const s3 = s2 ** 3;
  const lr = +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  const lg = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  const lb = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3;
  const enc = (v: number) => {
    const c = Math.max(0, Math.min(1, v));
    const x = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return Math.round(x * 255);
  };
  return { r: enc(lr), g: enc(lg), b: enc(lb) };
}

function toneRank(lum01: number, s: Settings): number {
  let t = Math.max(0, Math.min(1, (lum01 - 0.5) * s.contrast + 0.5));
  t = Math.pow(t, 1 / s.gamma);
  return s.invert ? 1 - t : t;
}

export function quantize(input: QuantInput): QuantResult {
  const { samples, glyphs, settings, locks } = input;
  const n = samples.r.length;
  const bg = hexToRgb(settings.background);

  // ---- 1. 每单元的合成色、OKLab、权重与分类 ----
  const labs: Lab[] = new Array(n);
  const weights = new Float64Array(n);
  const isSpace = new Uint8Array(n);
  const isTransparent = new Uint8Array(n);
  const isEdge = new Uint8Array(n);
  const ranks = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const alpha = samples.a[i]! / 255;
    const r = samples.r[i]! * alpha + bg.r * (1 - alpha);
    const g = samples.g[i]! * alpha + bg.g * (1 - alpha);
    const b = samples.b[i]! * alpha + bg.b * (1 - alpha);
    labs[i] = rgbToLab(r, g, b);
    const coverage = glyphCoverage(glyphs[i] ?? " ");
    isSpace[i] = coverage <= 0.02 ? 1 : 0;
    isTransparent[i] = samples.a[i]! < TRANSPARENT_ALPHA ? 1 : 0;
    isEdge[i] =
      samples.a[i]! >= TRANSPARENT_ALPHA && samples.a[i]! < EDGE_ALPHA ? 1 : 0;
    // 字符覆盖率主导权重：空格几乎不显色，半透明再折减
    weights[i] = Math.max(0.12, coverage) * (0.25 + 0.75 * alpha);
    ranks[i] = toneRank(samples.lum[i]!, settings);
  }

  const active: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!isSpace[i] && !isTransparent[i]) active.push(i);
  }
  const hasTransparent = isTransparent.some(Boolean);

  // ---- 2. 锁色去重与冲突检测 ----
  const uniqueLocks: LockedColor[] = [];
  const seen = new Map<string, number>();
  const dupCount = new Map<string, number>();
  for (const lock of locks) {
    const key = lock.color.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, uniqueLocks.length);
      uniqueLocks.push(lock);
      dupCount.set(key, 1);
    } else {
      dupCount.set(key, (dupCount.get(key) ?? 1) + 1);
    }
  }
  const duplicateGroups = [...dupCount.entries()]
    .filter(([, c]) => c > 1)
    .map(([color, count]) => ({ color, count }));
  const nearPairs: { a: string; b: string; deltaE: number }[] = [];
  for (let i = 0; i < uniqueLocks.length; i++) {
    for (let j = i + 1; j < uniqueLocks.length; j++) {
      const d = deltaE(
        hexToLab(uniqueLocks[i]!.color),
        hexToLab(uniqueLocks[j]!.color),
      );
      if (d < NEAR_LOCK_DELTA)
        nearPairs.push({
          a: uniqueLocks[i]!.color,
          b: uniqueLocks[j]!.color,
          deltaE: Math.round(d * 10) / 10,
        });
    }
  }

  const maxColors = Math.max(2, Math.min(256, settings.maxColors));
  const fixedSlots = 1 + (hasTransparent ? 1 : 0);
  const lockCapacity = Math.max(0, maxColors - fixedSlots);

  // ---- 3. 锁色超额：两种策略各自求解并比较 ----
  const salience = new Float64Array(uniqueLocks.length);
  const SIGMA = 14;
  for (let k = 0; k < uniqueLocks.length; k++) {
    const lk = hexToLab(uniqueLocks[k]!.color);
    let s = 0;
    for (const i of active) {
      const d = deltaE(labs[i]!, lk);
      s += weights[i]! * Math.exp(-((d / SIGMA) * (d / SIGMA)));
    }
    salience[k] = s;
  }

  /** 显眼小区域优先：带覆盖折扣的贪心，保护未被其他锁色覆盖的小簇 */
  function salientPick(cap: number): Set<number> {
    const picked = new Set<number>();
    const covered = new Float64Array(n);
    while (picked.size < Math.min(cap, uniqueLocks.length)) {
      let best = -1;
      let bestGain = -1;
      for (let k = 0; k < uniqueLocks.length; k++) {
        if (picked.has(k)) continue;
        const lk = hexToLab(uniqueLocks[k]!.color);
        let gain = 0;
        for (const i of active) {
          const d = deltaE(labs[i]!, lk);
          if (d < 10) gain += weights[i]! * Math.max(0, 1 - covered[i]!);
        }
        gain += salience[k]! * 1e-6;
        if (gain > bestGain) {
          bestGain = gain;
          best = k;
        }
      }
      if (best < 0) break;
      picked.add(best);
      const lk = hexToLab(uniqueLocks[best]!.color);
      for (const i of active) {
        const d = deltaE(labs[i]!, lk);
        if (d < 10)
          covered[i] = Math.min(1, covered[i]! + Math.exp(-((d / 10) ** 2)));
      }
    }
    return picked;
  }

  /** 整体色差优先：设施选址贪心，最小化全部单元到最近锁色的加权 ΔE */
  function fidelityPick(cap: number): Set<number> {
    const picked = new Set<number>();
    const nearest = new Float64Array(n).fill(Infinity);
    while (picked.size < Math.min(cap, uniqueLocks.length)) {
      let best = -1;
      let bestCost = Infinity;
      for (let k = 0; k < uniqueLocks.length; k++) {
        if (picked.has(k)) continue;
        const lk = hexToLab(uniqueLocks[k]!.color);
        let cost = 0;
        for (const i of active) {
          const d = deltaE(labs[i]!, lk);
          cost += weights[i]! * Math.min(nearest[i]!, d);
        }
        if (cost < bestCost) {
          bestCost = cost;
          best = k;
        }
      }
      if (best < 0) break;
      picked.add(best);
      const lk = hexToLab(uniqueLocks[best]!.color);
      for (const i of active) {
        nearest[i] = Math.min(nearest[i]!, deltaE(labs[i]!, lk));
      }
    }
    return picked;
  }

  let conflict: PaletteConflict | null = null;
  let kept: Set<number>;
  if (uniqueLocks.length > lockCapacity) {
    const salientSet = salientPick(lockCapacity);
    const fidelitySet = fidelityPick(lockCapacity);
    const lockOnlyCost = (set: Set<number>) => {
      const lockLabs = [...set].map((k) => hexToLab(uniqueLocks[k]!.color));
      let sum = 0,
        wsum = 0;
      for (const i of active) {
        let best = Infinity;
        for (const lk of lockLabs) best = Math.min(best, deltaE(labs[i]!, lk));
        sum += weights[i]! * best;
        wsum += weights[i]!;
      }
      return wsum ? sum / wsum : 0;
    };
    const droppedSalience = (set: Set<number>) => {
      let s = 0;
      uniqueLocks.forEach((_, k) => {
        if (!set.has(k)) s += salience[k]!;
      });
      return Math.round(s * 100) / 100;
    };
    const chosen =
      settings.strategy === "fidelity" ? fidelitySet : salientSet;
    const dropped: DroppedLock[] = [];
    uniqueLocks.forEach((lock, k) => {
      if (!chosen.has(k)) {
        dropped.push({
          color: lock.color,
          score: Math.round(salience[k]! * 100) / 100,
          reason:
            settings.strategy === "fidelity"
              ? "超出色数上限，整体色差策略下舍弃"
              : "超出色数上限，显眼区域策略下舍弃",
        });
      }
    });
    conflict = {
      requested: locks.length,
      unique: uniqueLocks.length,
      capacity: lockCapacity,
      duplicateGroups,
      nearPairs,
      dropped,
      compare: {
        salient: {
          meanDeltaE: Math.round(lockOnlyCost(salientSet) * 100) / 100,
          droppedSalience: droppedSalience(salientSet),
        },
        fidelity: {
          meanDeltaE: Math.round(lockOnlyCost(fidelitySet) * 100) / 100,
          droppedSalience: droppedSalience(fidelitySet),
        },
      },
    };
    kept = chosen;
  } else {
    kept = new Set(uniqueLocks.map((_, k) => k));
    if (duplicateGroups.length || nearPairs.length) {
      conflict = {
        requested: locks.length,
        unique: uniqueLocks.length,
        capacity: lockCapacity,
        duplicateGroups,
        nearPairs,
        dropped: [],
        compare: {
          salient: { meanDeltaE: 0, droppedSalience: 0 },
          fidelity: { meanDeltaE: 0, droppedSalience: 0 },
        },
      };
    }
  }

  // ---- 4. 质心：锁定种子 + 加权 k-means++ 自动种子 ----
  const centroids: Centroid[] = [];
  uniqueLocks.forEach((lock, k) => {
    if (!kept.has(k)) return;
    centroids.push({ lab: hexToLab(lock.color), fixed: true, lockId: lock.id });
  });
  const autoSlots = Math.max(0, maxColors - fixedSlots - centroids.length);
  const minDist = new Float64Array(active.length).fill(Infinity);
  for (let s = 0; s < autoSlots; s++) {
    for (let p = 0; p < active.length; p++) {
      let d = Infinity;
      for (const c of centroids) d = Math.min(d, deltaE(labs[active[p]!]!, c.lab));
      minDist[p] = Math.min(minDist[p]!, d);
    }
    let total = 0;
    const wheel: number[] = [];
    for (let p = 0; p < active.length; p++) {
      const chance = weights[active[p]!]! * minDist[p]! * minDist[p]!;
      wheel.push(chance);
      total += chance;
    }
    if (total === 0) break;
    let roll = Math.random() * total;
    let pick = active.length - 1;
    for (let p = 0; p < wheel.length; p++) {
      roll -= wheel[p]!;
      if (roll <= 0) {
        pick = p;
        break;
      }
    }
    centroids.push({ lab: { ...labs[active[pick]!]! }, fixed: false });
  }

  // ---- 5. 加权 k-means 迭代 ----
  const assign = new Int32Array(n).fill(-1);
  for (let iter = 0; iter < KMEANS_ITERS; iter++) {
    for (const i of active) {
      let best = 0;
      let bestD = Infinity;
      for (let k = 0; k < centroids.length; k++) {
        const d = deltaE(labs[i]!, centroids[k]!.lab);
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      }
      assign[i] = best;
    }
    if (iter === KMEANS_ITERS - 1) break;
    const groups: number[][] = centroids.map(() => []);
    for (const i of active) groups[assign[i]!]!.push(i);
    for (let k = 0; k < centroids.length; k++) {
      if (centroids[k]!.fixed) continue;
      if (groups[k]!.length === 0) {
        let worst = active[0]!;
        let worstD = -1;
        for (const i of active) {
          const d = deltaE(labs[i]!, centroids[assign[i]!]!.lab);
          if (d > worstD) {
            worstD = d;
            worst = i;
          }
        }
        centroids[k]!.lab = { ...labs[worst]! };
        continue;
      }
      centroids[k]!.lab = weightedMeanLab(labs, weights, groups[k]!);
    }
  }

  // ---- 6. 明度层次保序修正，防止接近色造成层级倒置 ----
  const groupOf = centroids.map(() => [] as number[]);
  for (const i of active) groupOf[assign[i]!]!.push(i);
  const orderStats = centroids.map((c, k) => {
    const members = groupOf[k]!;
    let rSum = 0,
      wSum = 0;
    for (const i of members) {
      rSum += ranks[i]! * weights[i]!;
      wSum += weights[i]!;
    }
    return { k, meanRank: wSum ? rSum / wSum : 0, L: c.lab.l, members };
  });
  const movable = orderStats.filter((o) => !centroids[o.k]!.fixed);
  if (movable.length >= 2) {
    movable.sort((x, y) => x.meanRank - y.meanRank);
    const dir: 1 | -1 = settings.invert ? -1 : 1;
    const corrected = isotonicPerItem(
      movable.map((o) => o.L),
      movable.map((o) => Math.max(1, o.members.length)),
      dir,
    );
    const tauBefore = kendallTau(
      Float32Array.from(active.map((i) => labs[i]!.l)),
      Float32Array.from(active.map((i) => centroids[assign[i]!]!.lab.l)),
    );
    movable.forEach((o, idx) => {
      const target = corrected[idx]!;
      const cur = centroids[o.k]!.lab.l;
      // 限制单次修正幅度，避免为保序牺牲过多色相
      centroids[o.k]!.lab.l = Math.max(cur - 0.1, Math.min(cur + 0.1, target));
    });
    if (tauBefore < 0.92) {
      for (const i of active) {
        let best = 0;
        let bestD = Infinity;
        for (let k = 0; k < centroids.length; k++) {
          const d = deltaE(labs[i]!, centroids[k]!.lab);
          if (d < bestD) {
            bestD = d;
            best = k;
          }
        }
        assign[i] = best;
      }
    }
  }

  // ---- 7. 组装色板条目（导出索引即数组顺序） ----
  const entries: PaletteEntry[] = [
    {
      id: 0,
      index: 0,
      color: settings.background.toLowerCase(),
      alpha: 255,
      kind: "background",
      count: 0,
      edgeCells: 0,
    },
  ];
  let transparentIndex = -1;
  if (hasTransparent) {
    transparentIndex = entries.length;
    entries.push({
      id: transparentIndex,
      index: transparentIndex,
      color: "#000000",
      alpha: 0,
      kind: "transparent",
      count: 0,
      edgeCells: 0,
    });
  }
  const centroidIndexByK = new Map<number, number>();
  uniqueLocks.forEach((lock, k) => {
    if (!kept.has(k)) return;
    const ck = centroids.findIndex((c) => c.lockId === lock.id);
    const idx = entries.length;
    entries.push({
      id: idx,
      index: idx,
      color: lock.color.toLowerCase(),
      alpha: 255,
      kind: "locked",
      lockId: lock.id,
      count: 0,
      edgeCells: 0,
    });
    centroidIndexByK.set(ck, idx);
  });
  // 自动条目按占用量降序，导出索引稳定可核对
  const autoGroups = centroids
    .map((c, k) => ({ c, k, members: groupOf[k]! }))
    .filter((g) => !g.c.fixed)
    .map((g) => ({
      ...g,
      weight: g.members.reduce((s, i) => s + weights[i]!, 0),
    }))
    .sort((x, y) => y.weight - x.weight);
  for (const g of autoGroups) {
    const idx = entries.length;
    const rgb = labToRgb(g.c.lab);
    entries.push({
      id: idx,
      index: idx,
      color: rgbToHex(rgb.r, rgb.g, rgb.b),
      alpha: 255,
      kind: "auto",
      count: 0,
      edgeCells: 0,
    });
    centroidIndexByK.set(g.k, idx);
  }

  // ---- 8. 单元分配与占用统计 ----
  const assignments = new Array<number>(n);
  const colors = new Array<string>(n);
  let transparentCells = 0;
  let edgeTotal = 0;
  for (let i = 0; i < n; i++) {
    let entryIndex: number;
    if (isTransparent[i]) {
      entryIndex = transparentIndex;
      transparentCells++;
    } else if (isSpace[i]) {
      entryIndex = 0;
    } else {
      entryIndex = centroidIndexByK.get(assign[i]!)!;
    }
    const entry = entries[entryIndex]!;
    entry.count++;
    if (isEdge[i]) {
      entry.edgeCells++;
      edgeTotal++;
    }
    assignments[i] = entryIndex;
    colors[i] = entry.color;
  }

  // ---- 9. 核对指标 ----
  let dSum = 0,
    dMax = 0,
    wSum = 0;
  const entryLumAfter = new Float32Array(active.length);
  const sourceLum = new Float32Array(active.length);
  for (let p = 0; p < active.length; p++) {
    const i = active[p]!;
    const entry = entries[assignments[i]!]!;
    const d = deltaE(labs[i]!, hexToLab(entry.color));
    dSum += d * weights[i]!;
    wSum += weights[i]!;
    dMax = Math.max(dMax, d);
    entryLumAfter[p] = hexToLab(entry.color).l;
    sourceLum[p] = labs[i]!.l;
  }
  const orderTau =
    active.length >= 2 ? kendallTau(sourceLum, entryLumAfter) : 1;
  const metrics = {
    meanDeltaE: wSum ? Math.round((dSum / wSum) * 100) / 100 : 0,
    maxDeltaE: Math.round(dMax * 100) / 100,
    orderTau: Math.round(orderTau * 1000) / 1000,
    totalCells: n,
    usedEntries: entries.filter((e) => e.count > 0).length,
    transparentCells,
    edgeCells: edgeTotal,
  };

  return {
    palette: { entries, metrics, conflict },
    assignments,
    colors,
  };
}
