import type { Asset, Crop, GridSamples } from "../../../shared/document";
import { luminance } from "./color";

/**
 * 按字符网格尺寸对原图做区域采样，保留原始 alpha（不与背景合成），
 * 这样透明项与半透明边缘可以被识别并计入核对指标。
 */
export function sampleGrid(
  asset: Asset,
  crop: Crop,
  columns: number,
  rows: number,
): GridSamples {
  const c = document.createElement("canvas");
  c.width = columns;
  c.height = rows;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.clearRect(0, 0, columns, rows);
  g.drawImage(
    asset.image,
    crop.x * asset.width,
    crop.y * asset.height,
    crop.width * asset.width,
    crop.height * asset.height,
    0,
    0,
    columns,
    rows,
  );
  const data = g.getImageData(0, 0, columns, rows).data;
  const n = columns * rows;
  const r = new Uint8ClampedArray(n);
  const gg = new Uint8ClampedArray(n);
  const b = new Uint8ClampedArray(n);
  const a = new Uint8ClampedArray(n);
  const lum = new Float32Array(n);
  const cover = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    r[i] = data[p]!;
    gg[i] = data[p + 1]!;
    b[i] = data[p + 2]!;
    a[i] = data[p + 3]!;
    // 半透明像素的有效明度按 alpha 折减，全透明记 0
    lum[i] = (luminance(data[p]!, data[p + 1]!, data[p + 2]!) * data[p + 3]!) / 255;
  }
  return { r, g: gg, b, a, lum, cover };
}

/** 背景合成后的显示色（与画布 fillRect+drawImage 的结果一致） */
export function compositeColor(
  samples: GridSamples,
  i: number,
  bg: { r: number; g: number; b: number },
): { r: number; g: number; b: number } {
  const alpha = samples.a[i]! / 255;
  return {
    r: samples.r[i]! * alpha + bg.r * (1 - alpha),
    g: samples.g[i]! * alpha + bg.g * (1 - alpha),
    b: samples.b[i]! * alpha + bg.b * (1 - alpha),
  };
}
