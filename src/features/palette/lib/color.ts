/**
 * 颜色科学工具：sRGB 线性化、OKLab 感知均匀色空间、ΔE 距离。
 * 归并在 OKLab 中进行，避免 RGB 欧氏距离与肉眼感知不一致的问题。
 */

export interface Lab {
  l: number;
  a: number;
  b: number;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`非法颜色值: ${hex}`);
  const n = parseInt(m[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b]
      .map((v) =>
        Math.round(Math.max(0, Math.min(255, v)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** sRGB 8bit -> OKLab（L 约 0..1，a/b 约 -0.4..0.4） */
export function rgbToLab(r: number, g: number, b: number): Lab {
  const lr = srgbToLinear(r),
    lg = srgbToLinear(g),
    lb = srgbToLinear(b);
  const l_ = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m_ = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s_ = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return {
    l: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
}

export function hexToLab(hex: string): Lab {
  const { r, g, b } = hexToRgb(hex);
  return rgbToLab(r, g, b);
}

/** OKLab 欧氏距离，约等于 CIE ΔE（<1 不可察觉，>5 明显） */
export function deltaE(x: Lab, y: Lab): number {
  const dl = x.l - y.l,
    da = x.a - y.a,
    db = x.b - y.b;
  return Math.sqrt(dl * dl + da * da + db * db) * 100;
}

export function deltaEHex(a: string, b: string): number {
  return deltaE(hexToLab(a), hexToLab(b));
}

/** 相对亮度（WCAG 定义，线性空间） */
export function luminance(r: number, g: number, b: number): number {
  return (
    0.2126 * srgbToLinear(r) +
    0.7152 * srgbToLinear(g) +
    0.0722 * srgbToLinear(b)
  );
}

/**
 * 字符覆盖率：字符密度越高（# @）墨色覆盖越多，空格为 0。
 * 用于归并权重 —— 空格格只露出背景，颜色差异几乎不可见。
 */
const COVERAGE: Record<string, number> = {
  " ": 0,
  "`": 0.09,
  ".": 0.12,
  ",": 0.15,
  ":": 0.18,
  "'": 0.16,
  "^": 0.2,
  "-": 0.22,
  "_": 0.24,
  "=": 0.32,
  "+": 0.36,
  "*": 0.42,
  "?": 0.46,
  "/": 0.3,
  "\\": 0.3,
  "|": 0.28,
  "(": 0.34,
  ")": 0.34,
  "[": 0.34,
  "]": 0.34,
  "{": 0.38,
  "}": 0.38,
  ";": 0.3,
  '"': 0.28,
  "!": 0.32,
  "i": 0.3,
  "l": 0.3,
  "1": 0.34,
  "I": 0.36,
  "~": 0.34,
  "t": 0.4,
  "f": 0.4,
  "j": 0.36,
  "r": 0.42,
  "x": 0.46,
  "n": 0.48,
  "u": 0.5,
  "v": 0.5,
  "c": 0.48,
  "z": 0.5,
  "X": 0.56,
  "Y": 0.56,
  "J": 0.54,
  "C": 0.58,
  "L": 0.56,
  "Q": 0.66,
  "0": 0.6,
  "O": 0.62,
  "Z": 0.62,
  "m": 0.66,
  "w": 0.66,
  "q": 0.62,
  "p": 0.62,
  "d": 0.62,
  "b": 0.62,
  "k": 0.58,
  "h": 0.6,
  "a": 0.6,
  "o": 0.62,
  "s": 0.56,
  "e": 0.6,
  "g": 0.64,
  "*2": 0.7,
  "#": 0.78,
  "M": 0.76,
  "W": 0.8,
  "&": 0.74,
  "8": 0.72,
  "%": 0.74,
  "B": 0.72,
  "@": 0.88,
  "$": 0.76,
  "░": 0.25,
  "▒": 0.5,
  "▓": 0.75,
  "█": 1,
};

export function glyphCoverage(glyph: string): number {
  if (glyph in COVERAGE) return COVERAGE[glyph]!;
  // 未登记字符按笔画数粗略估计，限制在 0.35..0.7
  return Math.max(0.35, Math.min(0.7, Array.from(glyph).length * 0.45));
}

/** 计算两个同长度数组的 Kendall 等级相关 τ（-1..1），用于核对明度层次 */
export function kendallTau(x: Float32Array, y: Float32Array): number {
  const n = x.length;
  if (n < 2) return 1;
  let concordant = 0,
    discordant = 0,
    ties = 0;
  // 大数组用 O(n log n) 较重；单元数通常 <= 220*165 ≈ 3.6 万，采样后比较
  const step = Math.max(1, Math.floor(n / 4000));
  let pairs = 0;
  for (let i = 0; i < n; i += step) {
    for (let j = i + step; j < n; j += step) {
      const dx = x[i]! - x[j]!;
      const dy = y[i]! - y[j]!;
      if (dx === 0 || dy === 0) {
        ties++;
      } else if (dx > 0 === dy > 0) {
        concordant++;
      } else {
        discordant++;
      }
      pairs++;
    }
  }
  if (pairs === 0) return 1;
  return (concordant - discordant) / (pairs - ties || pairs);
}
